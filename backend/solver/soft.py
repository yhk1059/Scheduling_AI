"""soft 위반량 보조 식과 고르게(balance)의 soft 식. 위반량 × weight(중요도)를 ctx.objective_terms에 더한다.

시간 기준은 기본 근무 하나 분량을 1단위로 올림한다. 규칙 식은 compile.py가 건다.
"""

import math
from typing import TYPE_CHECKING

from backend.domain.models import Balance
from backend.solver import hard, select

if TYPE_CHECKING:
    from backend.solver.model import ModelContext


def _shortfall(ctx: "ModelContext", expr, lo: int | None, hi: int | None, ub: int):
    """lo보다 부족한 양 + hi보다 초과한 양(정수 변수)."""
    v = ctx.model.new_int_var(0, ub, "")
    if lo is not None:
        ctx.model.add(v >= lo - expr)
    if hi is not None:
        ctx.model.add(v >= expr - hi)
    return v


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


def add_balance(ctx: "ModelContext", b: Balance, weight: int) -> None:
    """(최대 − 최소) × weight. 최근 28일 이력을 같은 셀렉터로 센 값을 더한다(with_history)."""
    counts, ub = hard.balance_exprs(ctx, b)
    if len(counts) < 2:
        return
    hi, lo = hard.spread_vars(ctx, counts, ub)
    unit = select.measure_unit(b.measure)
    ctx.objective_terms.append(weight * (hi - lo if unit == 1 else _units(ctx, hi - lo, None, 0, ub, unit)))
