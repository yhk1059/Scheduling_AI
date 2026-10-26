"""배정 결과 → 요약·통계·soft 위반. 솔버 변수를 쓰지 않는 결정적 순수 함수다."""

import calendar
from typing import Any

from backend.domain.constants import FAIRNESS_TOLERANCE
from backend.domain.models import (
    Assignments,
    NurseStats,
    ScheduleRequest,
    ScheduleResult,
    SoftViolation,
    Summary,
)

TOGGLEABLE = {
    "daily_coverage",
    "forbidden_sequence",
    "max_consecutive_work",
    "max_consecutive_nights",
    "min_days_off",
    "off_after_night_block",
    "skill_mix",
}


def is_weekend(request: ScheduleRequest, day: int) -> bool:
    """토·일 또는 체크한 공휴일."""
    p = request.period
    return calendar.weekday(p.year, p.month, day) >= 5 or day in request.holidays


def preference_days(request: ScheduleRequest, c: Any) -> list[int]:
    """shift_preference의 대상 날짜. days=None이면 기간 전체, weekends_only면 주말·공휴일만."""
    p = c.params
    days = p.days if p.days is not None else range(1, request.period.days + 1)
    return sorted({d for d in days if not p.weekends_only or is_weekend(request, d)})


def _runs(seq: list[str], pred, offset: int) -> list[tuple[int, int]]:
    """pred 연속 구간 (길이, 끝 날짜). seq[offset]이 1일이고, 대상 월 날짜를 포함하는 구간만."""
    out, length = [], 0
    for i, s in enumerate(seq):
        length = length + 1 if pred(s) else 0
        ends = i + 1 == len(seq) or not pred(seq[i + 1])
        if length and ends and i >= offset:
            out.append((length, i - offset + 1))
    return out


def _with_carry(request: ScheduleRequest, assignments: Assignments, nid: str) -> tuple[list[str], int]:
    carry = next((list(r.shifts) for r in request.carry_over if r.nurse_id == nid), [])
    return carry + list(assignments[nid]), len(carry)


def _violations(request: ScheduleRequest, a: Assignments, c: Any) -> list[SoftViolation]:
    """soft 제약 하나의 위반 목록."""
    p = c.params
    days = request.period.days
    nurses = request.nurses
    v = lambda detail, nurse_id=None, day=None: SoftViolation(  # noqa: E731
        constraint_id=c.id, nurse_id=nurse_id, day=day, detail=detail)
    out: list[SoftViolation] = []

    if c.type == "shift_preference":
        for d in preference_days(request, c):
            if (a[p.nurse_id][d - 1] == p.shift) != p.prefer:
                out.append(v(f"{'희망' if p.prefer else '기피'} {p.shift} 미반영", p.nurse_id, d))
    elif c.type in ("night_fairness", "weekend_fairness"):
        if c.type == "night_fairness":
            counts = [a[n.id].count("N") for n in nurses if not n.night_only]
            label = "나이트"
        else:
            counts = [sum(a[n.id][d - 1] != "O" for d in range(1, days + 1) if is_weekend(request, d))
                      for n in nurses]
            label = "주말·공휴일 근무"
        if len(counts) >= 2 and max(counts) - min(counts) > FAIRNESS_TOLERANCE:
            out.append(v(f"{label} 개수 편차 {max(counts) - min(counts)}"))
    elif c.type == "daily_coverage":
        for d in range(1, days + 1):
            if is_weekend(request, d) != (p.day_kind == "weekend"):
                continue
            total = sum(a[n.id][d - 1] == p.shift for n in nurses)
            if not p.min <= total <= p.max:
                out.append(v(f"{p.shift} {total}명 (기준 {p.min}~{p.max}명)", day=d))
    elif c.type == "skill_mix":
        for d in range(1, days + 1):
            total = sum(a[n.id][d - 1] == p.shift for n in nurses if n.years >= p.min_years)
            if total < p.min_count:
                out.append(v(f"{p.shift} {p.min_years}년차 이상 {total}명 (기준 {p.min_count}명)", day=d))
    elif c.type == "min_days_off":
        for n in nurses:
            offs = a[n.id].count("O")
            if offs < p.days:
                out.append(v(f"오프 {offs}일 (기준 {p.days}일)", n.id))
    else:
        for n in nurses:
            seq, off = _with_carry(request, a, n.id)
            out += [v(detail, n.id, day) for detail, day in _sequence_violations(c, seq, off)]
    return out


def _sequence_violations(c: Any, seq: list[str], off: int) -> list[tuple[str, int]]:
    """연속 계열(이월 포함). (설명, 날짜) 목록."""
    p = c.params
    day = lambda i: i - off + 1  # noqa: E731
    if c.type == "forbidden_sequence":
        return [(f"{p.first}→{p.second}", day(i + 1))
                for i in range(max(off - 1, 0), len(seq) - 1)
                if seq[i] == p.first and seq[i + 1] == p.second]
    if c.type in ("max_consecutive_work", "max_consecutive_nights"):
        pred = (lambda s: s != "O") if c.type == "max_consecutive_work" else (lambda s: s == "N")
        label = "근무" if c.type == "max_consecutive_work" else "나이트"
        return [(f"연속 {label} {length}일 (상한 {p.days}일)", end)
                for length, end in _runs(seq, pred, off) if length > p.days]
    if c.type == "off_after_night_block":
        out = []
        for i in range(max(off - 1, 0), len(seq) - 1):
            if seq[i] == "N" and seq[i + 1] != "N":
                for k in range(1, p.days + 1):
                    if i + k < len(seq) and seq[i + k] != "O":
                        out.append((f"나이트 후 {k}일째 오프 아님", day(i + k)))
        return out
    raise ValueError(f"알 수 없는 soft 템플릿 {c.type}")


def _is_soft(c: Any) -> bool:
    if c.type in ("shift_preference", "night_fairness", "weekend_fairness"):
        return True
    return c.hardness == "soft" and c.type in TOGGLEABLE


def compute_result(request: ScheduleRequest, assignments: Assignments, optimal: bool) -> ScheduleResult:
    days = request.period.days
    active = [c for c in request.constraints if c.enabled]

    pref_total: dict[str, int] = {n.id: 0 for n in request.nurses}
    pref_met: dict[str, int] = {n.id: 0 for n in request.nurses}
    for c in active:
        if c.type != "shift_preference":
            continue
        row = assignments[c.params.nurse_id]
        for d in preference_days(request, c):
            pref_total[c.params.nurse_id] += 1
            pref_met[c.params.nurse_id] += (row[d - 1] == c.params.shift) == c.params.prefer

    work = {n.id: days - assignments[n.id].count("O") for n in request.nurses}
    mean = sum(work.values()) / len(work)
    stats = {}
    for n in request.nurses:
        row = assignments[n.id]
        stats[n.id] = NurseStats(
            D=row.count("D"),
            E=row.count("E"),
            N=row.count("N"),
            O=row.count("O"),
            weekend_holiday_work=sum(row[d - 1] != "O" for d in range(1, days + 1) if is_weekend(request, d)),
            max_consecutive_work=max((length for length, _ in _runs(row, lambda s: s != "O", 0)), default=0),
            preference_rate=pref_met[n.id] / pref_total[n.id] if pref_total[n.id] else None,
            deviation=round(work[n.id] - mean, 2),
        )

    violations = [x for c in active if _is_soft(c) for x in _violations(request, assignments, c)]
    summary = Summary(
        preferences_total=sum(pref_total.values()),
        preferences_met=sum(pref_met.values()),
        soft_violation_count=len(violations),
    )
    return ScheduleResult(
        assignments=assignments,
        summary=summary,
        stats=stats,
        soft_violations=violations,
        optimal=optimal,
    )
