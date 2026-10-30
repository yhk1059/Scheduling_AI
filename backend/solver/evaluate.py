"""규칙 식을 근무표 위에서 평가한다(ADR-019, 설계 §2.2~§2.4). 식 의미의 단일 기준이다.

결과 통계(stats), eval 판정기, 예시 판정이 이 함수를 쓰고, CP-SAT 컴파일은 이 함수와 같은 답을 내야 한다.
순수 함수다(CP-SAT 미사용). 날짜는 기간 안 인덱스(1..length)이고, 0 이하는 이월 칸(0이 시작 전날)이다.

- 모르는 날(기간 뒤, 이월로도 모르는 기간 앞)의 칸은 세지 않는다(0).
- day·person_day 인스턴스는 세는 날 구간(offset) 중 하나라도 기간과 겹칠 때만 평가한다. 이월 날(d <= 0)도
  기간 칸을 세면 인스턴스가 된다(이월 N → 1일 D 같은 경계). 이월만 세는 인스턴스는 바꿀 수 없어 평가하지 않는다.
- week·window 경계는 세기 블록과 같다(select.count_groups).
"""

import math
from dataclasses import dataclass

from backend.domain.constants import FAIRNESS_TOLERANCE
from backend.domain.models import (
    All,
    Any,
    Assignments,
    Balance,
    Cmp,
    Cond,
    Count,
    Require,
    Rule,
    ScheduleRequest,
    ValueRef,
    rule_counts,
)
from backend.solver import select

_EPS = 1e-9


@dataclass(frozen=True)
class Instance:
    nurse_id: str | None  # 사람이 묶인 범위면 그 사람
    days: tuple[int, ...]  # day·person_day는 (d,), week·window는 그 날들, person·period는 비움


@dataclass(frozen=True)
class RuleViolation:
    instance: Instance
    amount: int  # soft 위반량: then이 비교 하나면 벗어난 양(시간은 기본 근무 단위로 올림), 그리고/또는이면 1


def _offset(c: Count) -> tuple[int, int]:
    return c.offset or (0, 0)


def _touches(request: ScheduleRequest, body: Require, d: int) -> bool:
    length = request.period.days
    return any(d + b >= 1 and d + a <= length for a, b in map(_offset, rule_counts(body)))


def instances(request: ScheduleRequest, rule: Rule) -> list[Instance]:
    body = rule.body
    if isinstance(body, Balance):
        return [Instance(None, ())]
    fe = body.for_each
    length = request.period.days
    if fe.per == "period":
        return [Instance(None, ())]
    ids = select.people(request, fe.people)
    if fe.per == "person":
        return [Instance(nid, ()) for nid in ids]

    def anchors(first: int) -> list[int]:
        return [d for d in range(first, length + 1) if select.day_matches(request, fe.days, d) and _touches(request, body, d)]

    if fe.per == "day":
        first = min((select.first_day(request, n.id) for n in request.nurses), default=1)
        return [Instance(None, (d,)) for d in anchors(first)]
    if fe.per == "person_day":
        return [Instance(nid, (d,)) for nid in ids for d in anchors(select.first_day(request, nid))]
    out = []
    for nid in ids:
        first = select.first_day(request, nid)
        if fe.per == "person_week":
            weeks: dict[int, list[int]] = {}
            for d in range(first, length + 1):
                weeks.setdefault(d - request.period.weekday(d), []).append(d)
            out += [Instance(nid, tuple(w)) for w in weeks.values() if w[-1] >= 1]
        else:
            window = fe.window or 0
            for start in range(first, length - window + 2):
                if start + window - 1 >= 1:
                    out.append(Instance(nid, tuple(range(start, start + window))))
    return out


def code_at(request: ScheduleRequest, assignments: Assignments, nurse_id: str, day: int) -> str | None:
    """칸 코드. 모르는 날이면 None."""
    if 1 <= day <= request.period.days:
        return assignments[nurse_id][day - 1]
    row = select.carry(request).get(nurse_id, [])
    i = len(row) - 1 + day
    return row[i] if day <= 0 and i >= 0 else None


def count_cells(
    request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, count: Count
) -> list[tuple[str, int, str]]:
    """세는 칸 (nurse_id, 날, 코드): 사람 집합 × 날 집합을 Count.days로 거른 것 중 아는 칸."""
    body = rule.body
    assert isinstance(body, Require)
    fe = body.for_each
    if count.who is not None:
        ids = select.people(request, count.who)
    elif inst.nurse_id is not None:
        ids = [inst.nurse_id]
    else:
        ids = [n.id for n in request.nurses]
    if fe.per in ("day", "person_day"):
        a, b = _offset(count)
        days = range(inst.days[0] + a, inst.days[0] + b + 1)
    else:
        span = inst.days if fe.per in ("person_week", "person_window") else range(1, request.period.days + 1)
        days = [d for d in span if select.day_matches(request, fe.days, d)]
    out = []
    for d in days:
        if not select.day_matches(request, count.days, d):
            continue
        for nid in ids:
            code = code_at(request, assignments, nid, d)
            if code is not None:
                out.append((nid, d, code))
    return out


def count_total(request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, count: Count) -> int:
    """세기 값: 개수 또는 분."""
    cells = count_cells(request, assignments, rule, inst, count)
    return sum(select.value(request.config, code, count.shifts, count.measure) for _, _, code in cells)


def resolve(rule: Rule, v: float | ValueRef) -> float:
    return rule.values[v.value].value if isinstance(v, ValueRef) else v


def cmp_sides(request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, c: Cmp) -> tuple[int, float]:
    """(왼쪽, 오른쪽) 계산 단위 값. 숫자·값은 왼쪽 세기의 단위(개수·분)로 바꾼다."""
    left = count_total(request, assignments, rule, inst, c.left)
    if isinstance(c.right, Count):
        return left, count_total(request, assignments, rule, inst, c.right)
    return left, resolve(rule, c.right) * select.measure_scale(c.left.measure)


def _distance(left: int, op: str, right: float) -> float:
    if op == "ge":
        return max(right - left, 0)
    if op == "le":
        return max(left - right, 0)
    return abs(left - right)


def cmp_holds(request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, c: Cmp) -> bool:
    left, right = cmp_sides(request, assignments, rule, inst, c)
    return _distance(left, c.op, right) <= _EPS


def cond_holds(request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, cond: Cond) -> bool:
    if isinstance(cond, All):
        return all(cmp_holds(request, assignments, rule, inst, c) for c in cond.all)
    if isinstance(cond, Any):
        return any(cmp_holds(request, assignments, rule, inst, c) for c in cond.any)
    return cmp_holds(request, assignments, rule, inst, cond)


def balance_values(request: ScheduleRequest, assignments: Assignments, body: Balance) -> list[int]:
    """사람마다 (최근 28일 이력 + 기간 안) 값. 고르게 블록과 같다."""
    out = []
    for nid, days in select.balance_cells(request, body).items():
        past = select.history_count(request, nid, body.days, body.shifts, body.measure) if body.with_history else 0
        out.append(past + sum(select.value(request.config, assignments[nid][d - 1], body.shifts, body.measure) for d in days))
    return out


def _evaluate_balance(request: ScheduleRequest, assignments: Assignments, rule: Rule, body: Balance) -> list[RuleViolation]:
    values = balance_values(request, assignments, body)
    if len(values) < 2:
        return []
    gap = max(values) - min(values)
    unit = select.measure_unit(body.measure)
    if rule.hardness == "hard":
        limit = resolve(rule, body.max_gap) * select.measure_scale(body.measure)
    else:
        limit = FAIRNESS_TOLERANCE * unit
    if gap <= limit + _EPS:
        return []
    return [RuleViolation(Instance(None, ()), math.ceil(gap / unit))]


def evaluate_rule(request: ScheduleRequest, assignments: Assignments, rule: Rule) -> list[RuleViolation]:
    """규칙 하나의 위반(hardness와 관계없이 센다. 고르게만 hard·soft 기준이 다르다)."""
    body = rule.body
    if isinstance(body, Balance):
        return _evaluate_balance(request, assignments, rule, body)
    out = []
    for inst in instances(request, rule):
        if body.when is not None and not cond_holds(request, assignments, rule, inst, body.when):
            continue
        if cond_holds(request, assignments, rule, inst, body.then):
            continue
        amount = 1
        if isinstance(body.then, Cmp):
            left, right = cmp_sides(request, assignments, rule, inst, body.then)
            over = math.ceil(_distance(left, body.then.op, right) - _EPS)
            amount = math.ceil(over / select.measure_unit(body.then.left.measure))
        out.append(RuleViolation(inst, amount))
    return out
