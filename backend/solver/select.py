"""규칙의 대상 고르기(사람·날짜·근무). 솔버(model·compile)와 평가(evaluate·stats)가 같은 함수를 쓴다.

순수 함수다. 날짜는 기간 안 인덱스(1..length)이고, 0 이하는 이월 칸(0이 시작 전날)이다.
"""

from datetime import date, timedelta
from backend.domain.constants import BASE_SHIFT_HOURS, MINUTES_PER_HOUR
from backend.domain.models import Balance, Days, People, ScheduleRequest, Shifts, ShopConfig, covers

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
    for n in request.employees:
        if sel.ids is not None and n.id not in sel.ids:
            continue
        if sel.tags is not None and not set(sel.tags) & set(n.tags):
            continue
        if set(sel.exclude_tags) & set(n.tags):
            continue
        out.append(n.id)
    return out


def matches(config: ShopConfig, code: str, sel: Shifts) -> bool:
    """칸 코드의 세는 근무조가 in과 겹치거나(not_in과 겹치지 않거나)."""
    c = covers(config, code)
    return bool(c & set(sel.in_)) if sel.in_ is not None else not c & set(sel.not_in or [])


def codes_matching(config: ShopConfig, sel: Shifts) -> list[str]:
    """맞는 코드(config 순서, 비활성 포함)."""
    return [s.code for s in config.shifts if matches(config, s.code, sel)]


def minutes_of(config: ShopConfig, code: str) -> int:
    return round(next(s.hours for s in config.shifts if s.code == code) * MINUTES_PER_HOUR)


def value(config: ShopConfig, code: str, sel: Shifts, measure: str) -> int:
    """칸 하나의 값: 개수(0/1) 또는 분."""
    if not matches(config, code, sel):
        return 0
    return 1 if measure == "count" else minutes_of(config, code)


def first_day(request: ScheduleRequest, employee_id: str) -> int:
    """이월을 포함해 근무를 아는 가장 이른 날."""
    return 1 - len(carry(request).get(employee_id, []))


def carry(request: ScheduleRequest) -> dict[str, list[str]]:
    return {r.employee_id: list(r.shifts) for r in request.carry_over}


def history_count(request: ScheduleRequest, employee_id: str, days_sel: Days, shifts_sel: Shifts, measure: str) -> int:
    """최근 28일 원본(history)에서 같은 셀렉터로 센 값. 요일·공휴일은 history.start_date·holidays로 판정한다.

    Days.days(기간 날짜 인덱스)를 지정한 셀렉터는 이력 날짜를 고르지 않는다.
    """
    h = request.history
    if h is None or days_sel.days is not None:
        return 0
    holidays = set(h.holidays)
    total = 0
    for i, code in enumerate(h.rows.get(employee_id, [])):
        dt: date = h.start_date + timedelta(days=i)
        holiday = dt in holidays
        if _date_matches(days_sel, dt.weekday(), dt.weekday() >= 5 or holiday, holiday):
            total += value(request.config, code, shifts_sel, measure)
    return total


def balance_cells(request: ScheduleRequest, p: Balance) -> dict[str, list[int]]:
    """고르게: 대상 사람마다 기간 안 대상 날짜."""
    sel = days(request, p.days)
    return {nid: sel for nid in people(request, p.people)}


def measure_scale(measure: str) -> int:
    """입력 숫자(개수·시간) → 계산 단위(개수·분)."""
    return 1 if measure == "count" else MINUTES_PER_HOUR


def measure_unit(measure: str) -> int:
    """soft 위반량 1단위(개수 1개 또는 기본 근무 하나의 분)."""
    return 1 if measure == "count" else BASE_SHIFT_HOURS * MINUTES_PER_HOUR


def max_cell_value(config: ShopConfig, sel: Shifts, measure: str) -> int:
    """칸 하나가 가질 수 있는 가장 큰 값."""
    return max((value(config, c, sel, measure) for c in codes_matching(config, sel)), default=0)
