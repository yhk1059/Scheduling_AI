"""배정 결과 → 요약·통계·soft 위반. 솔버 변수를 쓰지 않는 결정적 순수 함수다."""

from typing import Any

from backend.domain.constants import FAIRNESS_TOLERANCE, MINUTES_PER_HOUR, OFF_CODE
from backend.domain.models import (
    Assignments,
    DiffCell,
    NurseStats,
    ScheduleRequest,
    ScheduleResult,
    Shifts,
    SoftViolation,
    Summary,
    WardConfig,
)
from backend.solver import select
from backend.solver.select import is_weekend  # noqa: F401  토·일 ∪ 공휴일(솔버와 같은 정의)


def common_cells(request: ScheduleRequest) -> list[tuple[str, int, str]]:
    """previous와 현재 요청에 공통인 (nurse_id, 날짜, 이전 근무). 새/빠진 간호사, 범위 밖 날짜는 무시."""
    ids = {n.id for n in request.nurses}
    return [
        (nid, d, before)
        for nid, row in (request.previous or {}).items()
        if nid in ids
        for d, before in enumerate(row[: request.period.days], start=1)
    ]


def _diff(request: ScheduleRequest, assignments: Assignments) -> list[DiffCell] | None:
    if request.previous is None:
        return None
    return [
        DiffCell(nurse_id=nid, day=d, before=before, after=assignments[nid][d - 1])
        for nid, d, before in common_cells(request)
        if assignments[nid][d - 1] != before
    ]


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


def _cell(request: ScheduleRequest, a: Assignments, nurse_id: str, day: int) -> str:
    if day >= 1:
        return a[nurse_id][day - 1]
    row = select.carry(request)[nurse_id]
    return row[len(row) - 1 + day]


def _shift_label(config: WardConfig, sel: Shifts) -> str:
    names = {s.code: s.name for s in config.shifts}
    if sel.in_ is not None:
        return "·".join(names[c] for c in sel.in_)
    if sel.not_in == [OFF_CODE]:
        return "근무"
    return "·".join(names[c] for c in sel.not_in or []) + " 말고 근무"


_DAY_KIND_LABEL = {"all": "", "weekday": "평일 ", "weekend": "주말·공휴일 ", "holiday": "공휴일 "}


def _num(v: float) -> str:
    return f"{v:g}"


def _range_text(lo: float | None, hi: float | None, unit: str) -> str:
    if lo is not None and hi is not None:
        return f"{_num(lo)}{unit}" if lo == hi else f"{_num(lo)}~{_num(hi)}{unit}"
    return f"{_num(lo)}{unit} 이상" if lo is not None else f"{_num(hi)}{unit} 이하"  # type: ignore[arg-type]


def _count_violations(request: ScheduleRequest, a: Assignments, c: Any) -> list[tuple[str, str | None, int | None]]:
    """세기 블록. 사람마다 대상 날짜 전부를 맞추거나(min = 날짜 수) 피하는(max = 0) 모양은 어긴 날마다 하나."""
    p = c.params
    config = request.config
    label = _shift_label(config, p.shifts)
    lo, hi = select.count_bounds(p)
    if p.per == "person" and p.measure == "count":
        target = select.days(request, p.days)
        avoid = hi == 0
        if avoid or (lo is not None and lo == len(target) > 0):
            return [
                (f"{label} {'배정' if avoid else '아님'} (기준 {'배정 안 함' if avoid else label})", nid, d)
                for nid in select.people(request, p.people)
                for d in target
                if select.matches(config, a[nid][d - 1], p.shifts) == avoid
            ]
    scale = select.measure_scale(p.measure)
    unit = "시간" if p.measure == "hours" else ("명" if p.per == "day" else "일")
    prefix = {"person_week": "주 ", "person_window": f"{p.window}일 중 "}.get(p.per, "")
    out = []
    for nid, day, cells in select.count_groups(request, p):
        total = sum(select.value(config, _cell(request, a, n, d), p.shifts, p.measure) for n, d in cells)
        if (lo is not None and total < lo) or (hi is not None and total > hi):
            detail = f"{prefix}{label} {_num(total / scale)}{unit} (기준 {_range_text(p.min, p.max, unit)})"
            out.append((detail, nid, day))
    return out


def _sequence_block_violations(request: ScheduleRequest, a: Assignments, c: Any) -> list[tuple[str, str | None, int | None]]:
    p = c.params
    config = request.config
    m = lambda code, sel: select.matches(config, code, sel)  # noqa: E731
    out = []
    for nid in select.people(request, p.people):
        seq, off = _with_carry(request, a, nid)
        day = lambda i: i - off + 1  # noqa: E731
        if p.forbid is not None:
            for pattern in p.forbid:
                k = len(pattern)
                text = "→".join(_shift_label(config, sel) for sel in pattern)
                for i in range(max(off - (k - 1), 0), len(seq) - k + 1):
                    if all(m(seq[i + j], sel) for j, sel in enumerate(pattern)):
                        out.append((f"금지 순서 {text}", nid, day(i + k - 1)))
        elif p.run is not None:
            label = _shift_label(config, p.run)
            for length, end in _runs(seq, lambda s: m(s, p.run), off):
                end_idx = end + off - 1
                if p.max_len is not None and length > p.max_len:
                    out.append((f"연속 {label} {length}일 (기준 {p.max_len}일 이하)", nid, end))
                known = end_idx - length + 1 > 0 and end_idx < len(seq) - 1  # 양쪽 경계를 아는 구간만
                if p.min_len is not None and length < p.min_len and known:
                    out.append((f"연속 {label} {length}일 (기준 {p.min_len}일 이상)", nid, end))
        else:
            label = _shift_label(config, p.after)
            for i in range(max(off - 1, 0), len(seq) - 1):
                if m(seq[i], p.after) and not m(seq[i + 1], p.after):
                    for k in range(1, p.then_off + 1):
                        if i + k < len(seq) and seq[i + k] != OFF_CODE:
                            out.append((f"{label} 후 {k}일째 휴무 아님", nid, day(i + k)))
    return out


def _balance_violations(request: ScheduleRequest, a: Assignments, c: Any) -> list[tuple[str, str | None, int | None]]:
    """사람 사이 차이. soft는 FAIRNESS_TOLERANCE(시간 기준은 기본 근무 단위)를, hard는 max_gap을 넘으면 하나."""
    p = c.params
    config = request.config
    counts = []
    for nid, days in select.balance_cells(request, p).items():
        past = select.history_count(request, nid, p.days, p.shifts, p.measure) if p.with_history else 0
        counts.append(past + sum(select.value(config, a[nid][d - 1], p.shifts, p.measure) for d in days))
    if len(counts) < 2:
        return []
    gap = max(counts) - min(counts)
    if c.hardness == "hard":
        limit = p.max_gap * select.measure_scale(p.measure)
    else:
        limit = FAIRNESS_TOLERANCE * select.measure_unit(p.measure)
    if gap <= limit:
        return []
    prefix = "최근 4주 포함 " if p.with_history and request.history is not None else ""
    label = _DAY_KIND_LABEL[p.days.kind] + _shift_label(config, p.shifts)
    if p.measure == "hours":
        return [(f"{prefix}{label} 근무 시간 편차 {_num(gap / MINUTES_PER_HOUR)}시간", None, None)]
    return [(f"{prefix}{label} 개수 편차 {gap}", None, None)]


_BLOCK_VIOLATIONS = {
    "count": _count_violations,
    "sequence": _sequence_block_violations,
    "balance": _balance_violations,
}


def violations(request: ScheduleRequest, assignments: Assignments, c: Any) -> list[SoftViolation]:
    """제약 하나의 위반 목록(hardness와 관계없이 센다). 블록은 솔버와 같은 select.py로 평가한다."""
    if c.type == "fixed_assignment":
        p = c.params
        if assignments[p.nurse_id][p.day - 1] == p.shift:
            return []
        return [SoftViolation(constraint_id=c.id, nurse_id=p.nurse_id, day=p.day, detail=f"고정 {p.shift} 아님")]
    return [
        SoftViolation(constraint_id=c.id, nurse_id=nid, day=day, detail=detail)
        for detail, nid, day in _BLOCK_VIOLATIONS[c.type](request, assignments, c)
    ]


def _preference_cells(request: ScheduleRequest, c: Any) -> list[tuple[str, int, Shifts, bool]]:
    """희망·기피로 세는 칸 (nurse_id, 날짜, 근무, 희망 여부).

    한 사람·기간 범위·soft 세기 블록(per=person, 개수). max=0이면 기피, 아니면 희망.
    """
    if c.type == "count" and c.hardness == "soft" and c.scope == "period":
        p = c.params
        if p.per == "person" and p.measure == "count" and p.people.ids is not None and len(p.people.ids) == 1:
            prefer = p.max != 0
            return [(p.people.ids[0], d, p.shifts, prefer) for d in select.days(request, p.days)]
    return []


def compute_result(request: ScheduleRequest, assignments: Assignments, optimal: bool) -> ScheduleResult:
    days = request.period.days
    active = [c for c in request.constraints if c.enabled]

    pref_total: dict[str, int] = {n.id: 0 for n in request.nurses}
    pref_met: dict[str, int] = {n.id: 0 for n in request.nurses}
    for c in active:
        for nid, d, sel, prefer in _preference_cells(request, c):
            pref_total[nid] += 1
            pref_met[nid] += select.matches(request.config, assignments[nid][d - 1], sel) == prefer

    work = {n.id: days - assignments[n.id].count("O") for n in request.nurses}
    mean = sum(work.values()) / len(work)
    stats = {}
    hours = {sh.code: sh.hours for sh in request.config.shifts}
    for n in request.nurses:
        row = assignments[n.id]
        stats[n.id] = NurseStats(
            counts={sh.code: row.count(sh.code) for sh in request.config.shifts if sh.active or sh.code in row},
            hours=sum(hours[code] for code in row),
            weekend_holiday_work=sum(row[d - 1] != "O" for d in range(1, days + 1) if is_weekend(request, d)),
            max_consecutive_work=max((length for length, _ in _runs(row, lambda s: s != "O", 0)), default=0),
            preference_rate=pref_met[n.id] / pref_total[n.id] if pref_total[n.id] else None,
            deviation=round(work[n.id] - mean, 2),
        )

    soft_violations = [x for c in active if c.hardness == "soft" for x in violations(request, assignments, c)]
    summary = Summary(
        preferences_total=sum(pref_total.values()),
        preferences_met=sum(pref_met.values()),
        soft_violation_count=len(soft_violations),
    )
    return ScheduleResult(
        assignments=assignments,
        summary=summary,
        stats=stats,
        soft_violations=soft_violations,
        diff=_diff(request, assignments),
        optimal=optimal,
    )
