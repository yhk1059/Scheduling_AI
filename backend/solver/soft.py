"""soft 제약. 위반량에 비례하는 페널티 항을 ctx.objective_terms에 더한다(hard_literals는 만들지 않음).

- 템플릿 10~12(희망/기피, 나이트 공정성, 주말 공정성)
- soft로 토글된 템플릿 1~7: hard와 같은 식의 위반량(부족 인원, 초과 연속 구간 등) × weight
"""

from typing import TYPE_CHECKING, Any, Callable

from backend.solver import hard
from backend.solver.stats import preference_days

if TYPE_CHECKING:
    from backend.solver.model import ModelContext


def _penalize(ctx: "ModelContext", c: Any, amount) -> None:
    ctx.objective_terms.append(c.weight * amount)


def _shortfall(ctx: "ModelContext", expr, lo: int | None, hi: int | None, ub: int):
    """lo보다 부족한 양 + hi보다 초과한 양(정수 변수)."""
    v = ctx.model.new_int_var(0, ub, "")
    if lo is not None:
        ctx.model.add(v >= lo - expr)
    if hi is not None:
        ctx.model.add(v >= expr - hi)
    return v


def add_shift_preference(ctx: "ModelContext", c: Any) -> None:
    p = c.params
    for d in preference_days(ctx.request, c):
        assigned = ctx.x[p.nurse_id, d, p.shift]
        _penalize(ctx, c, assigned.Not() if p.prefer else assigned)


def _spread(ctx: "ModelContext", c: Any, counts: list) -> None:
    """(최대 − 최소) × weight. 최소화 목적이라 부등식만으로 충분하다."""
    if len(counts) < 2:
        return
    hi = ctx.model.new_int_var(0, ctx.days, "")
    lo = ctx.model.new_int_var(0, ctx.days, "")
    for cnt in counts:
        ctx.model.add(hi >= cnt)
        ctx.model.add(lo <= cnt)
    _penalize(ctx, c, hi - lo)


def add_night_fairness(ctx: "ModelContext", c: Any) -> None:
    regular = [n.id for n in ctx.request.nurses if not n.night_only]
    _spread(ctx, c, [sum(ctx.x[nid, d, "N"] for d in range(1, ctx.days + 1)) for nid in regular])


def add_weekend_fairness(ctx: "ModelContext", c: Any) -> None:
    weekends = [d for d in range(1, ctx.days + 1) if ctx.is_weekend(d)]
    counts = [sum(ctx.x[n.id, d, "O"].Not() for d in weekends) for n in ctx.request.nurses]
    _spread(ctx, c, counts)


# --- soft로 토글된 템플릿 1~7 ---


def add_daily_coverage(ctx: "ModelContext", c: Any) -> None:
    p = c.params
    n = len(ctx.request.nurses)
    for d in range(1, ctx.days + 1):
        if ctx.is_weekend(d) != (p.day_kind == "weekend"):
            continue
        total = sum(ctx.x[n_.id, d, p.shift] for n_ in ctx.request.nurses)
        _penalize(ctx, c, _shortfall(ctx, total, p.min, p.max, max(n, p.min)))


def add_min_days_off(ctx: "ModelContext", c: Any) -> None:
    for n in ctx.request.nurses:
        offs = sum(ctx.x[n.id, d, "O"] for d in range(1, ctx.days + 1))
        _penalize(ctx, c, _shortfall(ctx, offs, c.params.days, None, c.params.days))


def add_skill_mix(ctx: "ModelContext", c: Any) -> None:
    p = c.params
    seniors = [n.id for n in ctx.request.nurses if n.years >= p.min_years]
    for d in range(1, ctx.days + 1):
        total = sum(ctx.x[nid, d, p.shift] for nid in seniors)
        _penalize(ctx, c, _shortfall(ctx, total, p.min_count, None, p.min_count))


def _add_clauses(ctx: "ModelContext", c: Any) -> None:
    """연속 계열: 절마다 위반 변수 하나(초과 연속 구간·빠진 오프 1개당 페널티)."""
    for neg, pos in hard.CLAUSE_TEMPLATES[c.type](ctx, c):
        viol = ctx.model.new_bool_var("")
        if hard._clause(ctx, viol.Not(), neg, pos):
            _penalize(ctx, c, viol)


ADDERS: dict[str, Callable[["ModelContext", Any], None]] = {
    "daily_coverage": add_daily_coverage,
    "forbidden_sequence": _add_clauses,
    "max_consecutive_work": _add_clauses,
    "max_consecutive_nights": _add_clauses,
    "min_days_off": add_min_days_off,
    "off_after_night_block": _add_clauses,
    "skill_mix": add_skill_mix,
    "shift_preference": add_shift_preference,
    "night_fairness": add_night_fairness,
    "weekend_fairness": add_weekend_fairness,
}
