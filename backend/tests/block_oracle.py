"""옛 블록 3종의 위반 계산(ADR-019 이전 stats·select의 블록 경로). 블록 → 식 변환의 기준(오라클)으로 테스트에서만 쓴다.

솔버와 stats는 이제 식 규칙만 평가한다. test_evaluate가 expr-convert-cases의 (블록, 식) 쌍에서 이 함수의 위반과
evaluate.py의 위반이 같은지 본다. 코드는 지우기 전 그대로다(이름만 공개 함수로).
"""

import math
from typing import Any

from backend.domain.constants import FAIRNESS_TOLERANCE, OFF_CODE
from backend.domain.legacy import CountParams
from backend.domain.models import Assignments, ScheduleRequest
from backend.solver import select
from backend.solver.stats import _balance_detail, _num, _runs, _shift_label

Cells = list[tuple[str, int]]  # (nurse_id, 날짜)


def count_groups(request: ScheduleRequest, p: CountParams) -> list[tuple[str | None, int | None, Cells]]:
    """세기 블록의 묶음: (nurse_id, 대표 날짜, 칸 목록).

    - day: 날마다 대상 사람들의 칸. 대표 날짜는 그날
    - person: 사람마다 기간 안 대상 날짜. 대표 날짜 없음
    - person_week: 사람마다 달력 주(월~일). 기간 첫 주는 이월 칸을 포함하고, 잘린 끝 주는 기간 안 날짜만.
      대표 날짜는 그 주의 기간 안 첫날
    - person_window: 사람마다 연속 window일(이월 포함, 기간 날짜를 하나 이상 포함하는 창만). 대표 날짜는 창의 끝날
    """
    ids = select.people(request, p.people)
    length = request.period.days
    if p.per == "day":
        return [(None, d, [(nid, d) for nid in ids]) for d in select.days(request, p.days)]
    if p.per == "person":
        sel = select.days(request, p.days)
        return [(nid, None, [(nid, d) for d in sel]) for nid in ids]
    out: list[tuple[str | None, int | None, Cells]] = []
    for nid in ids:
        first = select.first_day(request, nid)
        if p.per == "person_week":
            # 기간 날짜를 주(월요일 기준)로 묶고, 첫 주는 앞쪽 이월 칸까지 넓힌다
            weeks: dict[int, list[int]] = {}
            for d in range(first, length + 1):
                monday = d - request.period.weekday(d)
                weeks.setdefault(monday, []).append(d)
            for week in weeks.values():
                if week[-1] < 1:
                    continue
                cells = [(nid, d) for d in week if select.day_matches(request, p.days, d)]
                out.append((nid, max(week[0], 1), cells))
        else:
            window = p.window or 0
            for start in range(first, length - window + 2):
                end = start + window - 1
                if end < 1:
                    continue
                cells = [(nid, d) for d in range(start, end + 1) if select.day_matches(request, p.days, d)]
                out.append((nid, end, cells))
    return out


def count_bounds(p: CountParams) -> tuple[int | None, int | None]:
    """세기 블록 범위를 계산 단위 정수로(min은 올림, max는 내림)."""
    scale = select.measure_scale(p.measure)
    lo = None if p.min is None else math.ceil(p.min * scale - 1e-9)
    hi = None if p.max is None else math.floor(p.max * scale + 1e-9)
    return lo, hi


def _with_carry(request: ScheduleRequest, assignments: Assignments, nid: str) -> tuple[list[str], int]:
    carry = next((list(r.shifts) for r in request.carry_over if r.nurse_id == nid), [])
    return carry + list(assignments[nid]), len(carry)


def _cell(request: ScheduleRequest, a: Assignments, nurse_id: str, day: int) -> str:
    if day >= 1:
        return a[nurse_id][day - 1]
    row = select.carry(request)[nurse_id]
    return row[len(row) - 1 + day]


def _range_text(lo: float | None, hi: float | None, unit: str) -> str:
    if lo is not None and hi is not None:
        return f"{_num(lo)}{unit}" if lo == hi else f"{_num(lo)}~{_num(hi)}{unit}"
    return f"{_num(lo)}{unit} 이상" if lo is not None else f"{_num(hi)}{unit} 이하"  # type: ignore[arg-type]


def _count_violations(request: ScheduleRequest, a: Assignments, c: Any) -> list[tuple[str, str | None, int | None]]:
    """세기 블록. 사람마다 대상 날짜 전부를 맞추거나(min = 날짜 수) 피하는(max = 0) 모양은 어긴 날마다 하나."""
    p = c.params
    config = request.config
    label = _shift_label(config, p.shifts)
    lo, hi = count_bounds(p)
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
    for nid, day, cells in count_groups(request, p):
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
    return [(_balance_detail(request, p, gap), None, None)]


_VIOLATIONS = {"count": _count_violations, "sequence": _sequence_block_violations, "balance": _balance_violations}


def violations(request: ScheduleRequest, assignments: Assignments, block: Any) -> list[tuple[str, str | None, int | None]]:
    """블록 하나의 위반 (detail, nurse_id, day) 목록(hardness와 관계없이 센다)."""
    return _VIOLATIONS[block.type](request, assignments, block)


def preference_cells(request: ScheduleRequest, c: Any) -> list[tuple[str, int, Any, bool]]:
    """희망·기피로 세는 칸 (nurse_id, 날짜, 근무, 희망 여부). 한 사람·기간 범위·soft 세기 블록(per=person, 개수).
    max=0이면 기피, 아니면 희망."""
    if c.hardness != "soft" or c.scope != "period" or c.type != "count":
        return []
    p = c.params
    if p.per == "person" and p.measure == "count" and p.people.ids is not None and len(p.people.ids) == 1:
        prefer = p.max != 0
        return [(p.people.ids[0], d, p.shifts, prefer) for d in select.days(request, p.days)]
    return []
