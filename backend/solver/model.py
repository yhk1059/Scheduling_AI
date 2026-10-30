"""CP-SAT 모델 골격. 기본 제약과 hard 제약(리터럴 + OnlyEnforceIf), soft 페널티를 건다.

solve()는 hard 리터럴을 참으로 고정해 푼다. assumptions로 두면 presolve가 리터럴을 고정하지 못해
LP 하한이 약해지고(공정성 최적 증명이 시간 제한까지 감) 느려진다. INFEASIBLE이면 conflicts.find_conflicts가
assumptions로 unsat core를 따로 구한다.
"""

from dataclasses import dataclass, field
from functools import cached_property

from ortools.sat.python import cp_model

from backend.domain.constants import CONFLICT_TIME_LIMIT_S, DIFF_WEIGHT, SOLVE_TIME_LIMIT_S
from backend.domain.models import ScheduleRequest, Shifts, SolveInfeasible, SolveOk, SolveTimeout
from backend.solver import compile, hard, select, soft, stats
from backend.solver.conflicts import find_conflicts

Cell = cp_model.IntVar | bool | None

HARD_ADDERS = {**hard.ADDERS, "rule": compile.add_rule_hard}
SOFT_ADDERS = {**soft.ADDERS, "rule": compile.add_rule_soft}


@dataclass
class ModelContext:
    model: cp_model.CpModel
    request: ScheduleRequest
    x: dict[tuple[str, int, str], cp_model.IntVar]
    hard_literals: dict[str, cp_model.IntVar] = field(default_factory=dict)
    objective_terms: list = field(default_factory=list)
    _literals: dict[tuple[str, int, tuple[str, ...]], cp_model.IntVar] = field(default_factory=dict)

    @property
    def days(self) -> int:
        return self.request.period.days

    @cached_property
    def codes(self) -> list[str]:
        """변수를 만드는 활성 근무 코드(config 순서)."""
        return active_codes(self.request)

    def is_weekend(self, day: int) -> bool:
        return stats.is_weekend(self.request, day)

    def carry_len(self, nurse_id: str) -> int:
        return len(self._carry().get(nurse_id, []))

    def cell(self, nurse_id: str, day: int, shift: str) -> Cell:
        """day >= 1이면 변수, day <= 0이면 이월 상수(0이 전월 말일), 이월이 없는 날이면 None."""
        if day >= 1:
            return self.x[nurse_id, day, shift]
        carry = self._carry().get(nurse_id, [])
        idx = len(carry) - 1 + day
        return carry[idx] == shift if idx >= 0 else None

    def _carry(self) -> dict[str, list[str]]:
        return {r.nurse_id: r.shifts for r in self.request.carry_over}

    def _carry_code(self, nurse_id: str, day: int) -> str | None:
        carry = self._carry().get(nurse_id, [])
        idx = len(carry) - 1 + day
        return carry[idx] if idx >= 0 else None

    def value(self, nurse_id: str, day: int, sel: Shifts, measure: str):
        """칸 하나의 값(개수 또는 분): 변수 합, 이월이면 상수, 이월이 없는 날이면 None."""
        config = self.request.config
        if day >= 1:
            return sum(
                select.value(config, c, sel, measure) * self.x[nurse_id, day, c]
                for c in self.codes
                if select.matches(config, c, sel)
            )
        code = self._carry_code(nurse_id, day)
        return None if code is None else select.value(config, code, sel, measure)

    def match(self, nurse_id: str, day: int, sel: Shifts):
        """칸이 셀렉터에 맞으면 1: 맞는 코드 변수의 합(하루 하나라 0/1), 이월이면 상수."""
        return self.value(nurse_id, day, sel, "count")

    def minutes(self, nurse_id: str, day: int, sel: Shifts):
        """칸이 셀렉터에 맞으면 그 코드의 근무 시간(분)."""
        return self.value(nurse_id, day, sel, "hours")

    def literal(self, nurse_id: str, day: int, sel: Shifts) -> Cell:
        """match를 리터럴로(절에 쓴다). 코드 하나면 그 변수, 나머지가 하나면 그 부정, 그 밖은 보조 변수."""
        if day < 1:
            m = self.match(nurse_id, day, sel)
            return None if m is None else bool(m)
        config = self.request.config
        hit = [c for c in self.codes if select.matches(config, c, sel)]
        miss = [c for c in self.codes if c not in hit]
        if not hit:
            return False
        if not miss:
            return True
        if len(hit) == 1:
            return self.x[nurse_id, day, hit[0]]
        if len(miss) == 1:
            return self.x[nurse_id, day, miss[0]].Not()
        key = (nurse_id, day, tuple(hit))
        if key not in self._literals:
            b = self.model.new_bool_var("")
            self.model.add(b == sum(self.x[nurse_id, day, c] for c in hit))
            self._literals[key] = b
        return self._literals[key]


def active_codes(request: ScheduleRequest) -> list[str]:
    return [s.code for s in request.config.shifts if s.active]


def build_model(request: ScheduleRequest) -> ModelContext:
    model = cp_model.CpModel()
    days = request.period.days
    codes = active_codes(request)
    x = {
        (n.id, d, s): model.new_bool_var(f"x_{n.id}_{d}_{s}")
        for n in request.nurses
        for d in range(1, days + 1)
        for s in codes
    }
    ctx = ModelContext(model=model, request=request, x=x)

    for n in request.nurses:
        for d in range(1, days + 1):
            model.add_exactly_one(x[n.id, d, s] for s in codes)

    for c in request.constraints:
        if not c.enabled:
            continue
        if c.hardness == "soft":  # 칸 고정은 항상 hard다
            SOFT_ADDERS[c.type](ctx, c)
            continue
        lit = model.new_bool_var(f"hard_{c.id}")
        ctx.hard_literals[c.id] = lit
        HARD_ADDERS[c.type](ctx, c, lit)

    for nid, d, before in stats.common_cells(request):
        # 끈 코드는 다시 배정할 수 없어 반드시 바뀐다
        ctx.objective_terms.append(DIFF_WEIGHT * x[nid, d, before].Not() if before in codes else DIFF_WEIGHT)
    return ctx


def solve(
    request: ScheduleRequest,
    time_limit_s: float = SOLVE_TIME_LIMIT_S,
    analyze_conflicts: bool = True,
    deterministic: bool = False,
) -> SolveOk | SolveInfeasible | SolveTimeout:
    """deterministic이면 단일 워커·고정 시드로 푼다. 최적해를 시간 안에 찾으면 다시 풀어도 같은 해가 나온다."""
    ctx = build_model(request)
    ctx.model.add_bool_and(list(ctx.hard_literals.values()))
    if ctx.objective_terms:
        ctx.model.minimize(sum(ctx.objective_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    if deterministic:
        solver.parameters.num_workers = 1
        solver.parameters.random_seed = 0
    status = solver.solve(ctx.model)
    version = request.input_version

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assignments = {
            n.id: [
                next(s for s in ctx.codes if solver.boolean_value(ctx.x[n.id, d, s]))
                for d in range(1, ctx.days + 1)
            ]
            for n in request.nurses
        }
        result = stats.compute_result(request, assignments, optimal=status == cp_model.OPTIMAL)
        return SolveOk(status="ok", input_version=version, result=result)
    if status == cp_model.INFEASIBLE:
        conflicts = find_conflicts(request, CONFLICT_TIME_LIMIT_S) if analyze_conflicts else None
        return SolveInfeasible(status="infeasible", input_version=version, conflicts=conflicts or [])
    if status == cp_model.UNKNOWN:
        return SolveTimeout(status="timeout", input_version=version)
    raise RuntimeError(f"CP-SAT 상태 {solver.status_name(status)}")
