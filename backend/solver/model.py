"""CP-SAT 모델 골격. 기본 제약과 hard 제약(리터럴 + OnlyEnforceIf), soft 페널티를 건다.

solve()는 hard 리터럴을 참으로 고정해 푼다. assumptions로 두면 presolve가 리터럴을 고정하지 못해
LP 하한이 약해지고(공정성 최적 증명이 시간 제한까지 감) 느려진다. INFEASIBLE이면 conflicts.find_conflicts가
assumptions로 unsat core를 따로 구한다.
"""

from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from backend.domain.constants import CONFLICT_TIME_LIMIT_S, DIFF_WEIGHT, SOLVE_TIME_LIMIT_S
from backend.domain.models import ScheduleRequest, SolveInfeasible, SolveOk, SolveTimeout
from backend.solver import hard, soft, stats
from backend.solver.conflicts import find_conflicts
from backend.solver.stats import TOGGLEABLE  # hard → soft 토글이 가능한 템플릿 1~7

SHIFTS = ("D", "E", "N", "O")

Cell = cp_model.IntVar | bool | None


@dataclass
class ModelContext:
    model: cp_model.CpModel
    request: ScheduleRequest
    x: dict[tuple[str, int, str], cp_model.IntVar]
    hard_literals: dict[str, cp_model.IntVar] = field(default_factory=dict)
    objective_terms: list = field(default_factory=list)

    @property
    def days(self) -> int:
        return self.request.period.days

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


def build_model(request: ScheduleRequest) -> ModelContext:
    model = cp_model.CpModel()
    days = request.period.days
    x = {
        (n.id, d, s): model.new_bool_var(f"x_{n.id}_{d}_{s}")
        for n in request.nurses
        for d in range(1, days + 1)
        for s in SHIFTS
    }
    ctx = ModelContext(model=model, request=request, x=x)

    for n in request.nurses:
        for d in range(1, days + 1):
            model.add_exactly_one(x[n.id, d, s] for s in SHIFTS)
            if n.night_only:
                model.add(x[n.id, d, "D"] == 0)
                model.add(x[n.id, d, "E"] == 0)

    for c in request.constraints:
        if not c.enabled:
            continue
        if c.type not in hard.ADDERS or (c.hardness == "soft" and c.type in TOGGLEABLE):
            soft.ADDERS[c.type](ctx, c)
            continue
        lit = model.new_bool_var(f"hard_{c.id}")
        ctx.hard_literals[c.id] = lit
        hard.ADDERS[c.type](ctx, c, lit)

    for nid, d, before in stats.common_cells(request):
        ctx.objective_terms.append(DIFF_WEIGHT * x[nid, d, before].Not())
    return ctx


def solve(
    request: ScheduleRequest, time_limit_s: float = SOLVE_TIME_LIMIT_S, analyze_conflicts: bool = True
) -> SolveOk | SolveInfeasible | SolveTimeout:
    ctx = build_model(request)
    ctx.model.add_bool_and(list(ctx.hard_literals.values()))
    if ctx.objective_terms:
        ctx.model.minimize(sum(ctx.objective_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    status = solver.solve(ctx.model)
    version = request.input_version

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assignments = {
            n.id: [
                next(s for s in SHIFTS if solver.boolean_value(ctx.x[n.id, d, s]))
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
