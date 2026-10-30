"""규칙 식을 근무표 위에서 평가한다(ADR-019, 설계 §2.2~§2.4). 식 의미의 단일 기준이다.

결과 통계(stats), eval 판정기, 예시 판정(sample_schedules·pick_examples)이 이 함수를 쓰고, CP-SAT 컴파일은 이 함수와 같은 답을 내야 한다.
순수 함수다(CP-SAT 미사용). 날짜는 기간 안 인덱스(1..length)이고, 0 이하는 이월 칸(0이 시작 전날)이다.

- 모르는 날(기간 뒤, 이월로도 모르는 기간 앞)의 칸은 세지 않는다(0).
- day·person_day 인스턴스는 세는 날 구간(offset) 중 하나라도 기간과 겹칠 때만 평가한다. 이월 날(d <= 0)도
  기간 칸을 세면 인스턴스가 된다(이월 N → 1일 D 같은 경계). 이월만 세는 인스턴스는 바꿀 수 없어 평가하지 않는다.
- week·window 경계는 세기 블록과 같다(select.count_groups).
"""

import math
import random
from dataclasses import dataclass
from time import monotonic

from backend.domain.constants import (
    EXAMPLES_MAX_DAYS,
    EXAMPLES_MAX_NURSES,
    EXAMPLES_MIN_DAYS,
    EXAMPLES_OFF_RATIO,
    FAIRNESS_TOLERANCE,
    OFF_CODE,
)
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
    RuleExample,
    ScheduleRequest,
    ValueRef,
    cond_cmps,
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


def count_scope(request: ScheduleRequest, rule: Rule, inst: Instance, count: Count) -> list[tuple[str, int]]:
    """세는 칸 (nurse_id, 날): 사람 집합 × 날 집합을 Count.days로 거른 것 중 아는 칸. 컴파일도 이 목록을 쓴다."""
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
    length = request.period.days
    carry = select.carry(request)
    first = {nid: 1 - len(carry.get(nid, [])) for nid in ids}  # select.first_day를 사람마다 다시 만들지 않는다
    return [
        (nid, d)
        for d in days
        if d <= length and select.day_matches(request, count.days, d)
        for nid in ids
        if d >= first[nid]
    ]


def count_cells(
    request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, count: Count
) -> list[tuple[str, int, str]]:
    """세는 칸 (nurse_id, 날, 코드)."""
    return [(nid, d, code_at(request, assignments, nid, d)) for nid, d in count_scope(request, rule, inst, count)]


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


# --- 예시 판정(설계 §4.2, 결정 ★6): LLM 없이 샘플 근무표에서 위반 사례를 고른다 ---

_FLIPS = (("all", True), ("all", False), ("half", True), ("half", False))  # (뒤집는 방식, 세는 코드로인지)


def _flipped(base: Assignments, cells: list[tuple[str, int]], pool: list[str], rng: random.Random, mode: str) -> Assignments:
    out = {nid: list(row) for nid, row in base.items()}
    for nid, d in cells:
        if mode == "half" and rng.random() < 0.5:
            continue
        out[nid][d - 1] = rng.choice(pool)
    return out


def sample_schedules(request: ScheduleRequest, seed: int, count: int) -> list[Assignments]:
    """샘플 근무표: 활성 코드 무작위 count개(휴무 약 EXAMPLES_OFF_RATIO) + 요청의 규칙이 세는 칸을 뒤집은 변형.

    뒤집기는 eval 판정기와 같은 생각이다: 특정 사람·특정 날만 고르는 규칙도 위반이 나오게, 세기마다 그 칸을
    맞는 코드 전부/맞지 않는 코드 전부/절반씩으로 바꾼다. 이월은 넣지 않는다(띠는 기간 안 날만 보인다).
    """
    rng = random.Random(seed)
    config = request.config
    active = [s.code for s in config.shifts if s.active]
    work = [c for c in active if c != OFF_CODE]
    ids = [n.id for n in request.nurses]
    length = request.period.days

    def cell() -> str:
        return OFF_CODE if not work or rng.random() < EXAMPLES_OFF_RATIO else rng.choice(work)

    base = [{nid: [cell() for _ in range(length)] for nid in ids} for _ in range(count)]
    out = list(base)
    flips = 0
    for rule in request.constraints:
        if not isinstance(rule, Rule) or isinstance(rule.body, Balance):
            continue
        insts = instances(request, rule)
        for c in rule_counts(rule.body):
            cells = sorted({cell for inst in insts for cell in count_scope(request, rule, inst, c) if cell[1] >= 1})
            match = [code for code in active if select.matches(config, code, c.shifts)]
            other = [code for code in active if code not in match]
            for mode, to_match in _FLIPS:
                pool = match if to_match else other
                if cells and pool and base:
                    out.append(_flipped(base[flips % len(base)], cells, pool, rng, mode))
                    flips += 1
    return out


def _sides(c: Cmp) -> list[Count]:
    return [c.left, c.right] if isinstance(c.right, Count) else [c.left]


def _marks(
    request: ScheduleRequest, assignments: Assignments, rule: Rule, inst: Instance, cmps: list[Cmp], violated: bool
) -> list[tuple[str, int]]:
    """비교를 그렇게 만든 기간 안 칸. 넘친 쪽은 세는 칸, 모자란 쪽은 세지 않은 칸이다.
    violated=False(when 조건)면 세는 칸만 본다."""
    out: list[tuple[str, int]] = []
    for c in cmps:
        left, right = cmp_sides(request, assignments, rule, inst, c)
        excess = left > right if violated else True
        sides = [(c.left, excess)]
        if isinstance(c.right, Count):
            sides.append((c.right, not excess if violated else True))
        for count, counted in sides:
            for nid, d, code in count_cells(request, assignments, rule, inst, count):
                if d >= 1 and select.matches(request.config, code, count.shifts) == counted:
                    out.append((nid, d))
    return list(dict.fromkeys(out))


def _strip_days(length: int, marks: list[int], tiers: list[list[int]]) -> list[int]:
    """띠의 날: 연속 3~7일(기간 안). tiers(인스턴스 날·어긋난 칸 → 조건 칸 → 세는 날)를 앞에서부터
    7일 안에 담기는 데까지 담는다. 어긋난 칸부터 7일에 담기지 않으면 첫 어긋난 칸부터 7일."""
    lo, hi = min(tiers[0]), max(tiers[0])
    if hi - lo + 1 > EXAMPLES_MAX_DAYS:
        lo = min(marks)
        hi = min(lo + EXAMPLES_MAX_DAYS - 1, length)
    else:
        for tier in tiers[1:]:
            if tier and max(hi, *tier) - min(lo, *tier) + 1 <= EXAMPLES_MAX_DAYS:
                lo, hi = min(lo, *tier), max(hi, *tier)
    left = True
    while hi - lo + 1 < EXAMPLES_MIN_DAYS and (lo > 1 or hi < length):
        if (left and lo > 1) or hi == length:
            lo -= 1
        else:
            hi += 1
        left = not left
    return list(range(lo, hi + 1))


def _example(request: ScheduleRequest, assignments: Assignments, rule: Rule, v: RuleViolation) -> RuleExample | None:
    from backend.solver.stats import describe_violation  # stats가 이 모듈을 import한다(순환 피함)

    body = rule.body
    assert isinstance(body, Require)
    inst = v.instance
    failed = [c for c in cond_cmps(body.then) if not cmp_holds(request, assignments, rule, inst, c)]
    marks = _marks(request, assignments, rule, inst, failed, violated=True)
    if not marks:
        return None
    context = _marks(request, assignments, rule, inst, cond_cmps(body.when), violated=False)
    ordered = [marks[0][0], *(n for n, _ in context[:1]), *(n for n, _ in marks), *(n for n, _ in context)]
    nurse_ids = list(dict.fromkeys(ordered))[:EXAMPLES_MAX_NURSES]
    marks = [m for m in marks if m[0] in nurse_ids]
    length = request.period.days
    anchor = [d for d in inst.days if 1 <= d <= length]
    scope = [d for c in failed for count in _sides(c) for _, d in count_scope(request, rule, inst, count) if d >= 1]
    mark_days = [d for _, d in marks]
    days = _strip_days(
        length,
        mark_days,
        [anchor + mark_days, [d for n, d in context if n in nurse_ids], sorted(set(scope))],
    )
    return RuleExample(
        nurse_ids=nurse_ids,
        days=days,
        cells={nid: [assignments[nid][d - 1] for d in days] for nid in nurse_ids},
        marks=[(n, d) for n, d in marks if d in days],
        detail=describe_violation(request, assignments, rule, v, names=False),
    )


def _overlaps(a: RuleExample, b: RuleExample) -> bool:
    return bool(set(a.nurse_ids) & set(b.nurse_ids)) and bool(set(a.days) & set(b.days))


def pick_examples(
    request: ScheduleRequest, rule: Rule, schedules: list[Assignments], limit: int, deadline: float | None = None
) -> list[RuleExample]:
    """위반 사례 ≤ limit개. 인스턴스마다 하나, 띠의 사람·날이 서로 겹치지 않는 것을 먼저 고른다.
    고르게는 사람 사이 차이라 띠로 보일 수 없어 예시가 없다. 같은 입력이면 같은 결과다.
    deadline(monotonic 시각)을 넘기면 다음 근무표를 보지 않고 그때까지 고른 것을 돌려준다."""
    if isinstance(rule.body, Balance) or limit <= 0:
        return []
    chosen: list[RuleExample] = []
    spare: list[RuleExample] = []
    seen: set[Instance] = set()
    for assignments in schedules:
        if deadline is not None and monotonic() >= deadline:
            break
        for v in evaluate_rule(request, assignments, rule):
            if v.instance in seen:
                continue
            seen.add(v.instance)
            ex = _example(request, assignments, rule, v)
            if ex is None:
                continue
            if not any(_overlaps(ex, c) for c in chosen):
                chosen.append(ex)
                if len(chosen) == limit:
                    return chosen
            elif len(spare) < limit:
                spare.append(ex)
    return (chosen + spare)[:limit]
