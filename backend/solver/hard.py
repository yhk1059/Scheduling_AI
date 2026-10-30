"""칸 고정과 고르게(balance)의 hard 식. 모든 식은 OnlyEnforceIf(lit)로 건다(unsat core용). 규칙 식은 compile.py가 건다."""

from typing import TYPE_CHECKING, Any, Callable

from backend.domain.constants import HISTORY_DAYS
from backend.domain.models import Balance
from backend.solver import select

if TYPE_CHECKING:
    from backend.solver.model import ModelContext


def add_fixed_assignment(ctx: "ModelContext", c: Any, lit) -> None:
    p = c.params
    var = ctx.x.get((p.nurse_id, p.day, p.shift))
    if var is None:  # 끈 코드는 배정할 수 없다
        ctx.model.add_bool_or([lit.Not()])
        return
    ctx.model.add_implication(lit, var)


def balance_exprs(ctx: "ModelContext", b: Balance) -> tuple[list, int]:
    """고르게: 사람마다 (최근 28일 이력 + 기간 안) 값, 값의 상한."""
    counts = []
    for nid, days in select.balance_cells(ctx.request, b).items():
        past = select.history_count(ctx.request, nid, b.days, b.shifts, b.measure) if b.with_history else 0
        counts.append(past + sum(ctx.value(nid, d, b.shifts, b.measure) for d in days))
    ub = (ctx.days + HISTORY_DAYS) * max(select.max_cell_value(ctx.request.config, b.shifts, b.measure), 1)
    return counts, ub


def spread_vars(ctx: "ModelContext", counts: list, ub: int):
    """(최대, 최소) 변수. 최대 ≥ 모든 값, 최소 ≤ 모든 값만 건다(차이를 줄이는 방향으로만 쓴다)."""
    hi = ctx.model.new_int_var(0, ub, "")
    lo = ctx.model.new_int_var(0, ub, "")
    for cnt in counts:
        ctx.model.add(hi >= cnt)
        ctx.model.add(lo <= cnt)
    return hi, lo


ADDERS: dict[str, Callable[["ModelContext", Any, Any], None]] = {
    "fixed_assignment": add_fixed_assignment,
}
