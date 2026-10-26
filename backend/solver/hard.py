"""hard 템플릿 1~9. 모든 식은 OnlyEnforceIf(lit)로 건다(step 3 unsat core용).

연속 계열(2, 3, 4, 6)은 이월 구간(day <= 0, 상수)과 대상 월을 이어서 검사하되,
대상 월 날짜를 하나 이상 포함하는 구간만 검사한다.
"""

from typing import TYPE_CHECKING, Any, Callable, Iterator

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


# 연속 계열(2, 3, 4, 6)은 절 목록으로 표현하고, hard/soft가 같은 절을 쓴다.
CLAUSE_TEMPLATES: dict[str, Callable[["ModelContext", Any], Clauses]] = {
    "forbidden_sequence": forbidden_sequence_clauses,
    "max_consecutive_work": max_consecutive_work_clauses,
    "max_consecutive_nights": max_consecutive_nights_clauses,
    "off_after_night_block": off_after_night_block_clauses,
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
    ctx.model.add_implication(lit, ctx.x[p.nurse_id, p.day, p.shift])


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
}
