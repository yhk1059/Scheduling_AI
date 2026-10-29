"""블록의 대상 고르기(사람·날짜·근무)와 묶음 나누기. 솔버(model·hard·soft)와 위반 계산(stats)이 같은 함수를 쓴다.

순수 함수다. 날짜는 기간 안 인덱스(1..length)이고, 0 이하는 이월 칸(0이 시작 전날)이다.
"""

import math
from datetime import date, timedelta
from typing import Any

from backend.domain.constants import BASE_SHIFT_HOURS, MINUTES_PER_HOUR
from backend.domain.models import CountParams, Days, People, ScheduleRequest, Shifts, WardConfig, covers

Cells = list[tuple[str, int]]  # (nurse_id, 날짜)


def is_weekend(request: ScheduleRequest, day: int) -> bool:
    """토·일 또는 체크한 공휴일. 이월 칸(day <= 0)은 요일만 본다."""
    return request.period.weekday(day) >= 5 or day in request.holidays


def _date_matches(sel: Days, weekday: int, weekend: bool, holiday: bool) -> bool:
    if sel.kind == "weekday" and weekend:
        return False
    if sel.kind == "weekend" and not weekend:
        return False
    if sel.kind == "holiday" and not holiday:
        return False
    return sel.weekdays is None or weekday in sel.weekdays


def day_matches(request: ScheduleRequest, sel: Days, day: int) -> bool:
    if sel.days is not None and day not in sel.days:
        return False
    return _date_matches(sel, request.period.weekday(day), is_weekend(request, day), day in request.holidays)


def days(request: ScheduleRequest, sel: Days) -> list[int]:
    return [d for d in range(1, request.period.days + 1) if day_matches(request, sel, d)]


def people(request: ScheduleRequest, sel: People) -> list[str]:
    out = []
    for n in request.nurses:
        if sel.ids is not None and n.id not in sel.ids:
            continue
        if sel.tags is not None and not set(sel.tags) & set(n.tags):
            continue
        if set(sel.exclude_tags) & set(n.tags):
            continue
        if sel.min_years is not None and n.years < sel.min_years:
            continue
        if sel.max_years is not None and n.years > sel.max_years:
            continue
        out.append(n.id)
    return out


def matches(config: WardConfig, code: str, sel: Shifts) -> bool:
    """칸 코드의 세는 근무조가 in과 겹치거나(not_in과 겹치지 않거나)."""
    c = covers(config, code)
    return bool(c & set(sel.in_)) if sel.in_ is not None else not c & set(sel.not_in or [])


def codes_matching(config: WardConfig, sel: Shifts) -> list[str]:
    """맞는 코드(config 순서, 비활성 포함)."""
    return [s.code for s in config.shifts if matches(config, s.code, sel)]


def minutes_of(config: WardConfig, code: str) -> int:
    return round(next(s.hours for s in config.shifts if s.code == code) * MINUTES_PER_HOUR)


def value(config: WardConfig, code: str, sel: Shifts, measure: str) -> int:
    """칸 하나의 값: 개수(0/1) 또는 분."""
    if not matches(config, code, sel):
        return 0
    return 1 if measure == "count" else minutes_of(config, code)


def first_day(request: ScheduleRequest, nurse_id: str) -> int:
    """이월을 포함해 근무를 아는 가장 이른 날."""
    return 1 - len(carry(request).get(nurse_id, []))


def carry(request: ScheduleRequest) -> dict[str, list[str]]:
    return {r.nurse_id: list(r.shifts) for r in request.carry_over}


def history_count(request: ScheduleRequest, nurse_id: str, days_sel: Days, shifts_sel: Shifts, measure: str) -> int:
    """최근 28일 원본(history)에서 같은 셀렉터로 센 값. 요일·공휴일은 history.start_date·holidays로 판정한다.

    Days.days(기간 날짜 인덱스)를 지정한 셀렉터는 이력 날짜를 고르지 않는다.
    """
    h = request.history
    if h is None or days_sel.days is not None:
        return 0
    holidays = set(h.holidays)
    total = 0
    for i, code in enumerate(h.rows.get(nurse_id, [])):
        dt: date = h.start_date + timedelta(days=i)
        holiday = dt in holidays
        if _date_matches(days_sel, dt.weekday(), dt.weekday() >= 5 or holiday, holiday):
            total += value(request.config, code, shifts_sel, measure)
    return total


def count_groups(request: ScheduleRequest, p: CountParams) -> list[tuple[str | None, int | None, Cells]]:
    """세기 블록의 묶음: (nurse_id, 대표 날짜, 칸 목록).

    - day: 날마다 대상 사람들의 칸. 대표 날짜는 그날
    - person: 사람마다 기간 안 대상 날짜. 대표 날짜 없음
    - person_week: 사람마다 달력 주(월~일). 기간 첫 주는 이월 칸을 포함하고, 잘린 끝 주는 기간 안 날짜만.
      대표 날짜는 그 주의 기간 안 첫날
    - person_window: 사람마다 연속 window일(이월 포함, 기간 날짜를 하나 이상 포함하는 창만). 대표 날짜는 창의 끝날
    """
    ids = people(request, p.people)
    length = request.period.days
    if p.per == "day":
        return [(None, d, [(nid, d) for nid in ids]) for d in days(request, p.days)]
    if p.per == "person":
        sel = days(request, p.days)
        return [(nid, None, [(nid, d) for d in sel]) for nid in ids]
    out: list[tuple[str | None, int | None, Cells]] = []
    for nid in ids:
        first = first_day(request, nid)
        if p.per == "person_week":
            # 기간 날짜를 주(월요일 기준)로 묶고, 첫 주는 앞쪽 이월 칸까지 넓힌다
            weeks: dict[int, list[int]] = {}
            for d in range(first, length + 1):
                monday = d - request.period.weekday(d)
                weeks.setdefault(monday, []).append(d)
            for week in weeks.values():
                if week[-1] < 1:
                    continue
                cells = [(nid, d) for d in week if day_matches(request, p.days, d)]
                out.append((nid, max(week[0], 1), cells))
        else:
            window = p.window or 0
            for start in range(first, length - window + 2):
                end = start + window - 1
                if end < 1:
                    continue
                cells = [(nid, d) for d in range(start, end + 1) if day_matches(request, p.days, d)]
                out.append((nid, end, cells))
    return out


def balance_cells(request: ScheduleRequest, p: Any) -> dict[str, list[int]]:
    """고르게 블록: 대상 사람마다 기간 안 대상 날짜."""
    sel = days(request, p.days)
    return {nid: sel for nid in people(request, p.people)}


def measure_scale(measure: str) -> int:
    """입력 숫자(개수·시간) → 계산 단위(개수·분)."""
    return 1 if measure == "count" else MINUTES_PER_HOUR


def measure_unit(measure: str) -> int:
    """soft 위반량 1단위(개수 1개 또는 기본 근무 하나의 분)."""
    return 1 if measure == "count" else BASE_SHIFT_HOURS * MINUTES_PER_HOUR


def count_bounds(p: CountParams) -> tuple[int | None, int | None]:
    """세기 블록 범위를 계산 단위 정수로(min은 올림, max는 내림)."""
    scale = measure_scale(p.measure)
    lo = None if p.min is None else math.ceil(p.min * scale - 1e-9)
    hi = None if p.max is None else math.floor(p.max * scale + 1e-9)
    return lo, hi


def max_cell_value(config: WardConfig, sel: Shifts, measure: str) -> int:
    """칸 하나가 가질 수 있는 가장 큰 값."""
    return max((value(config, c, sel, measure) for c in codes_matching(config, sel)), default=0)
