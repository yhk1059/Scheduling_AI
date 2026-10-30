"""규칙 식 → CP-SAT(ADR-019, 설계 §3). 의미는 evaluate.py와 같다: 인스턴스(evaluate.instances)와
세는 칸(evaluate.count_scope)을 그대로 쓴다.

- Count는 칸 값의 합이다(이월 칸은 상수, 모르는 날은 빠짐, 시간은 분, ctx.value).
- Cmp는 정수 범위 lo ≤ 식 ≤ hi로 바꾼다(숫자·값은 왼쪽 단위로 바꾸고 min은 올림, max는 내림).
  세기끼리 비교는 왼쪽 − 오른쪽을 0과 비교한다. 상수끼리면 미리 판정한다.
- 칸 하나를 세는 개수 비교는 칸 리터럴(ctx.literal 캐시)이다. 그 밖은 필요한 곳(when, 또는)에서만 bool로 reify한다.
- hard: lit ∧ when → then. soft: when이 참일 때 then을 벗어난 양(비교 하나, 시간은 기본 근무 단위로 올림)
  또는 1(그리고/또는) × weight.
- 고르게는 내장 함수다(hard.balance_exprs·spread_vars, soft.add_balance).
"""

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ortools.sat.python import cp_model

from backend.domain.models import All, Any, Balance, Cmp, Cond, Count, Rule
from backend.solver import evaluate, hard, select, soft

if TYPE_CHECKING:
    from backend.solver.model import ModelContext

_EPS = 1e-9


@dataclass
class _Bound:
    """lo ≤ expr ≤ hi. expr가 int면 상수, cell이 있으면 칸 하나의 개수(0/1)다."""

    expr: object
    lo: int | None
    hi: int | None
    span: int  # |expr|의 상한
    cell: tuple[str, int, object] | None = None  # (nurse_id, 날, 셀렉터)

    def holds(self, v: int) -> bool:
        return (self.lo is None or v >= self.lo) and (self.hi is None or v <= self.hi)


def _count(ctx: "ModelContext", rule: Rule, inst: evaluate.Instance, c: Count):
    cells = evaluate.count_scope(ctx.request, rule, inst, c)
    expr = sum(ctx.value(nid, d, c.shifts, c.measure) for nid, d in cells)
    span = len(cells) * ctx.max_value(c.shifts, c.measure)
    return cells, expr, span


def _bound(ctx: "ModelContext", rule: Rule, inst: evaluate.Instance, c: Cmp) -> _Bound:
    cells, left, span = _count(ctx, rule, inst, c.left)
    if isinstance(c.right, Count):
        _, right, right_span = _count(ctx, rule, inst, c.right)
        lo = hi = 0
        b = _Bound(left - right, lo, hi, span + right_span)
    else:
        r = evaluate.resolve(rule, c.right) * select.measure_scale(c.left.measure)
        lo, hi = math.ceil(r - _EPS), math.floor(r + _EPS)
        cell = None
        if len(cells) == 1 and c.left.measure == "count":
            cell = (*cells[0], c.left.shifts)
        b = _Bound(left, lo, hi, span, cell)
    if c.op == "ge":
        b.hi = None
    elif c.op == "le":
        b.lo = None
    return b


def _linear(ctx: "ModelContext", b: _Bound):
    lo = b.lo if b.lo is not None else -cp_model.INT_MAX
    hi = b.hi if b.hi is not None else cp_model.INT_MAX
    return ctx.model.add_linear_constraint(b.expr, lo, hi)


def _holds_lit(ctx: "ModelContext", b: _Bound, both: bool):
    """비교가 참인 리터럴(상수면 bool). both면 참 ↔ 리터럴, 아니면 리터럴 → 참만 건다."""
    if isinstance(b.expr, int):
        return b.holds(b.expr)
    if b.cell is not None:
        lit = ctx.literal(*b.cell)
        if isinstance(lit, bool):
            return b.holds(int(lit))
        one, zero = b.holds(1), b.holds(0)
        if one == zero:
            return one
        return lit if one else lit.Not()
    if b.lo is not None and b.hi is not None and b.lo > b.hi:
        return False
    v = ctx.model.new_bool_var("")
    _linear(ctx, b).only_enforce_if(v)
    if both:
        lo = b.lo if b.lo is not None else -cp_model.INT_MAX
        hi = b.hi if b.hi is not None else cp_model.INT_MAX
        ctx.model.add_linear_expression_in_domain(b.expr, cp_model.Domain(lo, hi).complement()).only_enforce_if(v.Not())
    return v


def _cmps(cond: Cond) -> list[Cmp]:
    if isinstance(cond, All):
        return cond.all
    if isinstance(cond, Any):
        return cond.any
    return [cond]


def _when_lits(ctx: "ModelContext", rule: Rule, inst: evaluate.Instance, cond: Cond | None) -> list | None:
    """when이 참이라는 리터럴 목록(모두 참이면 when 참). when이 늘 거짓이면 None."""
    if cond is None:
        return []
    lits = [_holds_lit(ctx, _bound(ctx, rule, inst, c), both=True) for c in _cmps(cond)]
    if isinstance(cond, Any):
        if any(lit is True for lit in lits):
            return []
        lits = [lit for lit in lits if lit is not False]
        if len(lits) <= 1:
            return lits or None
        w = ctx.model.new_bool_var("")
        ctx.model.add_bool_or(lits).only_enforce_if(w)
        for lit in lits:
            ctx.model.add_implication(lit, w)
        return [w]
    if any(lit is False for lit in lits):
        return None
    return [lit for lit in lits if lit is not True]


def _never(ctx: "ModelContext", enforce: list) -> None:
    """enforce가 모두 참일 수 없다."""
    ctx.model.add_bool_or([lit.Not() for lit in enforce])


def _require(ctx: "ModelContext", rule: Rule, inst: evaluate.Instance, cond: Cond, enforce: list) -> None:
    """enforce가 모두 참이면 cond를 지킨다."""
    if isinstance(cond, Any):
        lits = [_holds_lit(ctx, _bound(ctx, rule, inst, c), both=False) for c in cond.any]
        if any(lit is True for lit in lits):
            return
        lits = [lit for lit in lits if lit is not False]
        if lits:
            ctx.model.add_bool_or(lits).only_enforce_if(enforce)
        else:
            _never(ctx, enforce)
        return
    for c in _cmps(cond):
        b = _bound(ctx, rule, inst, c)
        if isinstance(b.expr, int):
            if not b.holds(b.expr):
                _never(ctx, enforce)
        else:
            _linear(ctx, b).only_enforce_if(enforce)


def add_rule_hard(ctx: "ModelContext", rule: Rule, lit) -> None:
    body = rule.body
    if isinstance(body, Balance):
        counts, ub = hard.balance_exprs(ctx, body)
        if len(counts) < 2:
            return
        hi, lo = hard.spread_vars(ctx, counts, ub)
        limit = math.floor(evaluate.resolve(rule, body.max_gap) * select.measure_scale(body.measure) + _EPS)
        ctx.model.add(hi - lo <= limit).only_enforce_if(lit)
        return
    for inst in evaluate.instances(ctx.request, rule):
        when = _when_lits(ctx, rule, inst, body.when)
        if when is not None:
            _require(ctx, rule, inst, body.then, [lit, *when])


def _amount(ctx: "ModelContext", b: _Bound, unit: int, enforce: list):
    """enforce가 모두 참일 때 범위를 벗어난 양(unit으로 나눠 올림). 아니면 0."""
    ub = b.span + max(abs(b.lo or 0), abs(b.hi or 0))
    if not enforce:
        return soft._units(ctx, b.expr, b.lo, b.hi, ub, unit)
    if isinstance(b.expr, int):
        a = soft._units(ctx, b.expr, b.lo, b.hi, ub, unit)
        if not a:
            return 0
        v = ctx.model.new_int_var(0, a, "")
        ctx.model.add(v >= a).only_enforce_if(enforce)
        return v
    v = ctx.model.new_int_var(0, math.ceil(ub / unit), "")
    if b.lo is not None:
        ctx.model.add(unit * v >= b.lo - b.expr).only_enforce_if(enforce)
    if b.hi is not None:
        ctx.model.add(unit * v >= b.expr - b.hi).only_enforce_if(enforce)
    return v


def add_rule_soft(ctx: "ModelContext", rule: Rule) -> None:
    body = rule.body
    if isinstance(body, Balance):
        soft.add_balance(ctx, body, rule.weight)
        return
    for inst in evaluate.instances(ctx.request, rule):
        when = _when_lits(ctx, rule, inst, body.when)
        if when is None:
            continue
        if isinstance(body.then, Cmp):
            unit = select.measure_unit(body.then.left.measure)
            amount = _amount(ctx, _bound(ctx, rule, inst, body.then), unit, when)
        else:
            amount = ctx.model.new_bool_var("")
            _require(ctx, rule, inst, body.then, [*when, amount.Not()])
        if not isinstance(amount, int) or amount:
            ctx.objective_terms.append(rule.weight * amount)
