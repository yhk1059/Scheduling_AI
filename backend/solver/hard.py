"""hard 템플릿 1~9와 블록 3종(count·sequence·balance). 모든 식은 OnlyEnforceIf(lit)로 건다(step 3 unsat core용).

연속 계열(2, 3, 4, 6, sequence)은 이월 구간(day <= 0, 상수)과 대상 월을 이어서 검사하되,
대상 월 날짜를 하나 이상 포함하는 구간만 검사한다.
"""

from typing import TYPE_CHECKING, Any, Callable, Iterator

from ortools.sat.python import cp_model

from backend.domain.constants import HISTORY_DAYS, OFF_CODE
from backend.solver import select

if TYPE_CHECKING:
    from backend.solver.model import Cell, ModelContext


def _clause(ctx: "ModelContext", lit, neg: list["Cell"], pos: list["Cell"]) -> bool:
    """lit → (¬neg[0] ∨ … ∨ pos[0] ∨ …). 이월 상수는 미리 정리한다. 식을 걸었으면 True."""
    terms = []
    for v in neg:
        if v is False:
            return False
        if v is not True:
            terms.append(v.Not())
    for v in pos:
        if v is True:
            return False
        if v is not False:
            terms.append(v)
    ctx.model.add_bool_or(terms).only_enforce_if(lit)
    return True


def _first_day(ctx: "ModelContext", nurse_id: str) -> int:
    """이월을 포함해 근무를 아는 가장 이른 날."""
    return 1 - ctx.carry_len(nurse_id)


def _nurse_ids(ctx: "ModelContext") -> list[str]:
    return [n.id for n in ctx.request.nurses]


def add_daily_coverage(ctx: "ModelContext", c: Any, lit) -> None:
    p = c.params
    for d in range(1, ctx.days + 1):
        if ctx.is_weekend(d) != (p.day_kind == "weekend"):
            continue
        total = sum(ctx.x[nid, d, p.shift] for nid in _nurse_ids(ctx))
        ctx.model.add_linear_constraint(total, p.min, p.max).only_enforce_if(lit)


Clauses = Iterator[tuple[list["Cell"], list["Cell"]]]


def forbidden_sequence_clauses(ctx: "ModelContext", c: Any) -> Clauses:
    p = c.params
    for nid in _nurse_ids(ctx):
        for d in range(max(_first_day(ctx, nid), 0), ctx.days):
            yield [ctx.cell(nid, d, p.first), ctx.cell(nid, d + 1, p.second)], []


def _max_run(ctx: "ModelContext", nurse_id: str, k: int, breaker: Callable[[int], tuple[list, list]]) -> Clauses:
    """길이 k+1 구간마다 breaker(day)가 하나 이상 참이어야 한다."""
    for start in range(_first_day(ctx, nurse_id), ctx.days - k + 1):
        if start + k < 1:
            continue
        neg, pos = [], []
        for d in range(start, start + k + 1):
            n, p = breaker(d)
            neg += n
            pos += p
        yield neg, pos


def max_consecutive_work_clauses(ctx: "ModelContext", c: Any) -> Clauses:
    for nid in _nurse_ids(ctx):
        yield from _max_run(ctx, nid, c.params.days, lambda d, nid=nid: ([], [ctx.cell(nid, d, "O")]))


def max_consecutive_nights_clauses(ctx: "ModelContext", c: Any) -> Clauses:
    for nid in _nurse_ids(ctx):
        yield from _max_run(ctx, nid, c.params.days, lambda d, nid=nid: ([ctx.cell(nid, d, "N")], []))


def add_min_days_off(ctx: "ModelContext", c: Any, lit) -> None:
    for nid in _nurse_ids(ctx):
        offs = sum(ctx.x[nid, d, "O"] for d in range(1, ctx.days + 1))
        ctx.model.add(offs >= c.params.days).only_enforce_if(lit)


def off_after_night_block_clauses(ctx: "ModelContext", c: Any) -> Clauses:
    for nid in _nurse_ids(ctx):
        for d in range(max(_first_day(ctx, nid), 0), ctx.days):
            night, next_night = ctx.cell(nid, d, "N"), ctx.cell(nid, d + 1, "N")
            for k in range(1, min(c.params.days, ctx.days - d) + 1):
                # d가 N이고 d+1이 N이 아니면(블록 끝) d+k는 O
                yield [night], [next_night, ctx.cell(nid, d + k, "O")]


def sequence_clauses(ctx: "ModelContext", c: Any) -> Clauses:
    """순서 블록. S(d) = 칸 d가 셀렉터에 맞음.

    - forbid: 패턴·시작일마다 패턴 칸이 모두 맞으면 안 된다
    - run.max_len: _max_run과 같은 식(길이 max_len+1 구간마다 ¬S가 하나 이상)
    - run.min_len: 길이 L < min_len인 구간 [¬S][S×L][¬S] 금지. 양쪽 경계를 아는 구간만(기간 끝에 닿거나
      이월 앞으로 이어질 수 있는 구간은 제외)
    - after: d가 S이고 d+1이 S가 아니면(구간 끝) d+1..d+then_off는 O
    """
    p = c.params
    for nid in select.people(ctx.request, p.people):
        first = _first_day(ctx, nid)
        lit = lambda d, sel, nid=nid: ctx.literal(nid, d, sel)  # noqa: E731
        if p.forbid is not None:
            for pattern in p.forbid:
                k = len(pattern)
                for s in range(max(first, 2 - k), ctx.days - k + 2):
                    yield [lit(s + i, sel) for i, sel in enumerate(pattern)], []
        elif p.run is not None:
            if p.max_len is not None:
                yield from _max_run(ctx, nid, p.max_len, lambda d, lit=lit: ([lit(d, p.run)], []))
            for length in range(1, p.min_len or 1):
                for s in range(first + 1, ctx.days - length + 1):
                    if s + length - 1 < 1:
                        continue
                    yield [lit(d, p.run) for d in range(s, s + length)], [lit(s - 1, p.run), lit(s + length, p.run)]
        else:
            for d in range(max(first, 0), ctx.days):
                for k in range(1, min(p.then_off, ctx.days - d) + 1):
                    yield [lit(d, p.after)], [lit(d + 1, p.after), ctx.cell(nid, d + k, OFF_CODE)]


# 연속 계열(2, 3, 4, 6, sequence)은 절 목록으로 표현하고, hard/soft가 같은 절을 쓴다.
CLAUSE_TEMPLATES: dict[str, Callable[["ModelContext", Any], Clauses]] = {
    "forbidden_sequence": forbidden_sequence_clauses,
    "max_consecutive_work": max_consecutive_work_clauses,
    "max_consecutive_nights": max_consecutive_nights_clauses,
    "off_after_night_block": off_after_night_block_clauses,
    "sequence": sequence_clauses,
}


def _add_clauses(ctx: "ModelContext", c: Any, lit) -> None:
    for neg, pos in CLAUSE_TEMPLATES[c.type](ctx, c):
        _clause(ctx, lit, neg, pos)


def add_skill_mix(ctx: "ModelContext", c: Any, lit) -> None:
    p = c.params
    seniors = [n.id for n in ctx.request.nurses if n.years >= p.min_years]
    for d in range(1, ctx.days + 1):
        ctx.model.add(sum(ctx.x[nid, d, p.shift] for nid in seniors) >= p.min_count).only_enforce_if(lit)


def add_leave(ctx: "ModelContext", c: Any, lit) -> None:
    for d in c.params.days:
        ctx.model.add_implication(lit, ctx.x[c.params.nurse_id, d, "O"])


def add_fixed_assignment(ctx: "ModelContext", c: Any, lit) -> None:
    p = c.params
    var = ctx.x.get((p.nurse_id, p.day, p.shift))
    if var is None:  # 끈 코드는 배정할 수 없다
        ctx.model.add_bool_or([lit.Not()])
        return
    ctx.model.add_implication(lit, var)


# --- 블록(ADR-018) ---


def count_exprs(ctx: "ModelContext", c: Any) -> Iterator[tuple[Any, int]]:
    """세기 블록의 묶음마다 (합 식 또는 상수, 칸 수). 묶음은 select.count_groups."""
    p = c.params
    for _, _, cells in select.count_groups(ctx.request, p):
        yield sum(ctx.value(nid, d, p.shifts, p.measure) for nid, d in cells), len(cells)


def add_count(ctx: "ModelContext", c: Any, lit) -> None:
    lo, hi = select.count_bounds(c.params)
    for expr, _ in count_exprs(ctx, c):
        if isinstance(expr, int):  # 이월만으로 정해진 묶음
            if (lo is not None and expr < lo) or (hi is not None and expr > hi):
                ctx.model.add_bool_or([lit.Not()])
            continue
        lb = lo if lo is not None else -cp_model.INT_MAX
        ub = hi if hi is not None else cp_model.INT_MAX
        ctx.model.add_linear_constraint(expr, lb, ub).only_enforce_if(lit)


def balance_exprs(ctx: "ModelContext", c: Any) -> tuple[list, int]:
    """고르게 블록: 사람마다 (최근 28일 이력 + 기간 안) 값, 값의 상한."""
    p = c.params
    counts = []
    for nid, days in select.balance_cells(ctx.request, p).items():
        past = select.history_count(ctx.request, nid, p.days, p.shifts, p.measure) if p.with_history else 0
        counts.append(past + sum(ctx.value(nid, d, p.shifts, p.measure) for d in days))
    ub = (ctx.days + HISTORY_DAYS) * max(select.max_cell_value(ctx.request.config, p.shifts, p.measure), 1)
    return counts, ub


def spread_vars(ctx: "ModelContext", counts: list, ub: int):
    """(최대, 최소) 변수. 최대 ≥ 모든 값, 최소 ≤ 모든 값만 건다(차이를 줄이는 방향으로만 쓴다)."""
    hi = ctx.model.new_int_var(0, ub, "")
    lo = ctx.model.new_int_var(0, ub, "")
    for cnt in counts:
        ctx.model.add(hi >= cnt)
        ctx.model.add(lo <= cnt)
    return hi, lo


def add_balance(ctx: "ModelContext", c: Any, lit) -> None:
    counts, ub = balance_exprs(ctx, c)
    if len(counts) < 2:
        return
    hi, lo = spread_vars(ctx, counts, ub)
    ctx.model.add(hi - lo <= c.params.max_gap * select.measure_scale(c.params.measure)).only_enforce_if(lit)


ADDERS: dict[str, Callable[["ModelContext", Any, Any], None]] = {
    "daily_coverage": add_daily_coverage,
    "forbidden_sequence": _add_clauses,
    "max_consecutive_work": _add_clauses,
    "max_consecutive_nights": _add_clauses,
    "min_days_off": add_min_days_off,
    "off_after_night_block": _add_clauses,
    "skill_mix": add_skill_mix,
    "leave": add_leave,
    "fixed_assignment": add_fixed_assignment,
    "count": add_count,
    "sequence": _add_clauses,
    "balance": add_balance,
}
