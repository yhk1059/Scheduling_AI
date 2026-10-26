"""hard 템플릿 1~9. 모든 식은 OnlyEnforceIf(lit)로 건다(step 3 unsat core용).

연속 계열(2, 3, 4, 6)은 이월 구간(day <= 0, 상수)과 대상 월을 이어서 검사하되,
대상 월 날짜를 하나 이상 포함하는 구간만 검사한다.
"""

from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from backend.solver.model import Cell, ModelContext


def _clause(ctx: "ModelContext", lit, neg: list["Cell"], pos: list["Cell"]) -> None:
    """lit → (¬neg[0] ∨ … ∨ pos[0] ∨ …). 이월 상수는 미리 정리한다."""
    terms = []
    for v in neg:
        if v is False:
            return
        if v is not True:
            terms.append(v.Not())
    for v in pos:
        if v is True:
            return
        if v is not False:
            terms.append(v)
    ctx.model.add_bool_or(terms).only_enforce_if(lit)


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


def add_forbidden_sequence(ctx: "ModelContext", c: Any, lit) -> None:
    p = c.params
    for nid in _nurse_ids(ctx):
        for d in range(max(_first_day(ctx, nid), 0), ctx.days):
            _clause(ctx, lit, [ctx.cell(nid, d, p.first), ctx.cell(nid, d + 1, p.second)], [])


def _max_run(ctx: "ModelContext", lit, nurse_id: str, k: int, breaker: Callable[[int], tuple[list, list]]) -> None:
    """길이 k+1 구간마다 breaker(day)가 하나 이상 참이어야 한다."""
    for start in range(_first_day(ctx, nurse_id), ctx.days - k + 1):
        if start + k < 1:
            continue
        neg, pos = [], []
        for d in range(start, start + k + 1):
            n, p = breaker(d)
            neg += n
            pos += p
        _clause(ctx, lit, neg, pos)


def add_max_consecutive_work(ctx: "ModelContext", c: Any, lit) -> None:
    for nid in _nurse_ids(ctx):
        _max_run(ctx, lit, nid, c.params.days, lambda d, nid=nid: ([], [ctx.cell(nid, d, "O")]))


def add_max_consecutive_nights(ctx: "ModelContext", c: Any, lit) -> None:
    for nid in _nurse_ids(ctx):
        _max_run(ctx, lit, nid, c.params.days, lambda d, nid=nid: ([ctx.cell(nid, d, "N")], []))


def add_min_days_off(ctx: "ModelContext", c: Any, lit) -> None:
    for nid in _nurse_ids(ctx):
        offs = sum(ctx.x[nid, d, "O"] for d in range(1, ctx.days + 1))
        ctx.model.add(offs >= c.params.days).only_enforce_if(lit)


def add_off_after_night_block(ctx: "ModelContext", c: Any, lit) -> None:
    for nid in _nurse_ids(ctx):
        for d in range(max(_first_day(ctx, nid), 0), ctx.days):
            night, next_night = ctx.cell(nid, d, "N"), ctx.cell(nid, d + 1, "N")
            for k in range(1, min(c.params.days, ctx.days - d) + 1):
                # d가 N이고 d+1이 N이 아니면(블록 끝) d+k는 O
                _clause(ctx, lit, [night], [next_night, ctx.cell(nid, d + k, "O")])


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
    ctx.model.add_implication(lit, ctx.x[p.nurse_id, p.day, p.shift])


ADDERS: dict[str, Callable[["ModelContext", Any, Any], None]] = {
    "daily_coverage": add_daily_coverage,
    "forbidden_sequence": add_forbidden_sequence,
    "max_consecutive_work": add_max_consecutive_work,
    "max_consecutive_nights": add_max_consecutive_nights,
    "min_days_off": add_min_days_off,
    "off_after_night_block": add_off_after_night_block,
    "skill_mix": add_skill_mix,
    "leave": add_leave,
    "fixed_assignment": add_fixed_assignment,
}
