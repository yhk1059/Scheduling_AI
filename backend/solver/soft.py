"""soft 블록 3종. hard와 같은 식의 위반량 × weight(중요도)를 ctx.objective_terms에 더한다(hard_literals는 만들지 않음).

시간 기준은 기본 근무 하나 분량을 1단위로 올림한다.
"""

import math
from typing import TYPE_CHECKING, Any, Callable

from backend.solver import hard, select

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


def _add_sequence(ctx: "ModelContext", c: Any) -> None:
    """절마다 위반 변수 하나(초과 연속 구간·금지 순서·빠진 휴무 1개당 페널티)."""
    for neg, pos in hard.sequence_clauses(ctx, c):
        viol = ctx.model.new_bool_var("")
        if hard._clause(ctx, viol.Not(), neg, pos):
            _penalize(ctx, c, viol)


def _units(ctx: "ModelContext", expr, lo: int | None, hi: int | None, ub: int, unit: int):
    """범위를 벗어난 양을 unit으로 나눠 올림한 정수(unit=1이면 _shortfall과 같다)."""
    if isinstance(expr, int):
        over = max((lo - expr) if lo is not None else 0, (expr - hi) if hi is not None else 0, 0)
        return math.ceil(over / unit)
    if unit == 1:
        return _shortfall(ctx, expr, lo, hi, ub)
    v = ctx.model.new_int_var(0, math.ceil(ub / unit), "")
    if lo is not None:
        ctx.model.add(unit * v >= lo - expr)
    if hi is not None:
        ctx.model.add(unit * v >= expr - hi)
    return v


def add_count(ctx: "ModelContext", c: Any) -> None:
    p = c.params
    lo, hi = select.count_bounds(p)
    per_cell = select.max_cell_value(ctx.request.config, p.shifts, p.measure)
    for expr, n_cells in hard.count_exprs(ctx, c):
        amount = _units(ctx, expr, lo, hi, max(lo or 0, n_cells * per_cell), select.measure_unit(p.measure))
        if not isinstance(amount, int) or amount:
            _penalize(ctx, c, amount)


def add_balance(ctx: "ModelContext", c: Any) -> None:
    """(최대 − 최소) × weight. 최근 28일 이력을 같은 셀렉터로 센 값을 더한다(with_history)."""
    counts, ub = hard.balance_exprs(ctx, c)
    if len(counts) < 2:
        return
    hi, lo = hard.spread_vars(ctx, counts, ub)
    unit = select.measure_unit(c.params.measure)
    _penalize(ctx, c, hi - lo if unit == 1 else _units(ctx, hi - lo, None, 0, ub, unit))


ADDERS: dict[str, Callable[["ModelContext", Any], None]] = {
    "count": add_count,
    "sequence": _add_sequence,
    "balance": add_balance,
}
