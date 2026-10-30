"""옛 형식: ADR-018 이전의 제약 템플릿 12종·Nurse.night_only·history_load와, ADR-019 이전의 블록 3종(count·sequence·balance).

변환(convert.py), 골든 생성, eval 데이터셋 변환, 샘플 변환에서만 쓴다. 솔버·LLM·routes는 import하지 않는다.
"""

from typing import Annotated, Literal, Union

from pydantic import Field, model_validator

from backend.domain.constants import (
    HISTORY_DAYS,
    MAX_PATTERN_LEN,
    MAX_PATTERNS,
    MAX_WINDOW_DAYS,
    MIN_PATTERN_LEN,
    MIN_WINDOW_DAYS,
    PRIORITY_WEIGHTS,
)
from backend.domain.models import (
    DEFAULT_CONFIG,
    Assignments,
    CarryOverRow,
    Days,
    FixedAssignment,
    Hardness,
    History,
    Nurse,
    People,
    Period,
    Priority,
    Rule,
    Shifts,
    WardConfig,
    _AlwaysHard,
    _BlockBase,
    _ConstraintBase,
    _Strict,
)

LegacyShift = Literal["D", "E", "N", "O"]
WorkShift = Literal["D", "E", "N"]


# --- 템플릿 params ---


class DailyCoverageParams(_Strict):
    shift: WorkShift
    day_kind: Literal["weekday", "weekend"]
    min: int = Field(ge=0)
    max: int = Field(ge=0)

    @model_validator(mode="after")
    def _min_le_max(self):
        if self.min > self.max:
            raise ValueError(f"min({self.min})이 max({self.max})보다 큽니다")
        return self


class ForbiddenSequenceParams(_Strict):
    first: LegacyShift
    second: LegacyShift


class DaysParams(_Strict):
    days: int = Field(ge=1)


class SkillMixParams(_Strict):
    shift: WorkShift
    min_years: int = Field(ge=0)
    min_count: int = Field(ge=1)


class LeaveParams(_Strict):
    nurse_id: str
    days: list[int] = Field(min_length=1)


class ShiftPreferenceParams(_Strict):
    nurse_id: str
    shift: LegacyShift
    prefer: bool
    days: list[int] | None = None
    weekends_only: bool = False


class EmptyParams(_Strict):
    pass


# --- 템플릿 ---


class DailyCoverage(_ConstraintBase):
    type: Literal["daily_coverage"]
    params: DailyCoverageParams


class ForbiddenSequence(_ConstraintBase):
    type: Literal["forbidden_sequence"]
    params: ForbiddenSequenceParams


class MaxConsecutiveWork(_ConstraintBase):
    type: Literal["max_consecutive_work"]
    params: DaysParams


class MaxConsecutiveNights(_ConstraintBase):
    type: Literal["max_consecutive_nights"]
    params: DaysParams


class MinDaysOff(_ConstraintBase):
    type: Literal["min_days_off"]
    params: DaysParams


class OffAfterNightBlock(_ConstraintBase):
    type: Literal["off_after_night_block"]
    params: DaysParams


class SkillMix(_ConstraintBase):
    type: Literal["skill_mix"]
    params: SkillMixParams


class Leave(_AlwaysHard):
    type: Literal["leave"]
    params: LeaveParams


class ShiftPreference(_ConstraintBase):
    type: Literal["shift_preference"]
    hardness: Hardness = "soft"
    params: ShiftPreferenceParams


class NightFairness(_ConstraintBase):
    type: Literal["night_fairness"]
    hardness: Hardness = "soft"
    weight: int = Field(default=PRIORITY_WEIGHTS["low"], gt=0)
    params: EmptyParams = Field(default_factory=EmptyParams)


class WeekendFairness(_ConstraintBase):
    type: Literal["weekend_fairness"]
    hardness: Hardness = "soft"
    weight: int = Field(default=PRIORITY_WEIGHTS["low"], gt=0)
    params: EmptyParams = Field(default_factory=EmptyParams)


LegacySpec = Annotated[
    Union[
        DailyCoverage,
        ForbiddenSequence,
        MaxConsecutiveWork,
        MaxConsecutiveNights,
        MinDaysOff,
        OffAfterNightBlock,
        SkillMix,
        Leave,
        FixedAssignment,
        ShiftPreference,
        NightFairness,
        WeekendFairness,
    ],
    Field(discriminator="type"),
]


# --- 요청 ---


class LegacyNurse(Nurse):
    night_only: bool = False


class HistoryLoad(_Strict):
    """최근 4주 누적 부담(나이트 수, 주말·공휴일 근무 수). 블록 형식에서는 history 원본으로 바뀌었다."""

    nurse_id: str
    nights: int = Field(ge=0, le=HISTORY_DAYS)
    weekends: int = Field(ge=0, le=HISTORY_DAYS)


class LegacyScheduleRequest(_Strict):
    """옛 /solve 요청(골든 케이스, 샘플 병동). 참조 검사는 변환한 ScheduleRequest가 한다."""

    nurses: list[LegacyNurse] = Field(min_length=1)
    period: Period
    holidays: list[int] = []
    constraints: list[LegacySpec] = []
    carry_over: list[CarryOverRow] = []
    previous: Assignments | None = None
    history_load: list[HistoryLoad] = []
    input_version: int


# --- 블록 3종(ADR-018) params ---


class CountParams(_Strict):
    people: People = People()
    days: Days = Days()
    shifts: Shifts
    per: Literal["day", "person", "person_week", "person_window"]
    window: int | None = Field(default=None, ge=MIN_WINDOW_DAYS, le=MAX_WINDOW_DAYS)
    measure: Literal["count", "hours"] = "count"
    min: float | None = Field(default=None, ge=0)
    max: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check(self):
        if self.min is None and self.max is None:
            raise ValueError("min과 max 중 하나 이상이 있어야 합니다")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError(f"min({self.min})이 max({self.max})보다 큽니다")
        if (self.per == "person_window") != (self.window is not None):
            raise ValueError("window는 per=person_window일 때만, 그리고 반드시 있어야 합니다")
        return self


ForbidPattern = Annotated[list[Shifts], Field(min_length=MIN_PATTERN_LEN, max_length=MAX_PATTERN_LEN)]


class SequenceParams(_Strict):
    people: People = People()
    forbid: list[ForbidPattern] | None = Field(default=None, min_length=1, max_length=MAX_PATTERNS)
    run: Shifts | None = None
    min_len: int | None = Field(default=None, ge=1)
    max_len: int | None = Field(default=None, ge=1)
    after: Shifts | None = None
    then_off: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _check(self):
        modes = [m for m in ("forbid", "run", "after") if getattr(self, m) is not None]
        if len(modes) != 1:
            raise ValueError("forbid, run, after 중 하나만 있어야 합니다")
        if self.run is not None:
            if self.min_len is None and self.max_len is None:
                raise ValueError("run에는 min_len과 max_len 중 하나 이상이 있어야 합니다")
            if self.min_len is not None and self.max_len is not None and self.min_len > self.max_len:
                raise ValueError(f"min_len({self.min_len})이 max_len({self.max_len})보다 큽니다")
        elif self.min_len is not None or self.max_len is not None:
            raise ValueError("min_len과 max_len은 run에만 씁니다")
        if (self.after is not None) != (self.then_off is not None):
            raise ValueError("after와 then_off는 함께 있어야 합니다")
        return self


class BalanceParams(_Strict):
    people: People = People()
    days: Days = Days()
    shifts: Shifts
    measure: Literal["count", "hours"] = "count"
    with_history: bool = True  # 최근 28일 근무를 더해서 센다
    max_gap: int = Field(default=1, ge=0)  # hard일 때만: (최대 − 최소) ≤ max_gap


# --- 블록 제약 ---


class CountRule(_BlockBase):
    type: Literal["count"]
    params: CountParams


class SequenceRule(_BlockBase):
    type: Literal["sequence"]
    params: SequenceParams


class BalanceRule(_BlockBase):
    type: Literal["balance"]
    hardness: Hardness = "soft"
    priority: Priority = "low"
    params: BalanceParams


BlockSpec = Annotated[
    Union[CountRule, SequenceRule, BalanceRule, Rule, FixedAssignment], Field(discriminator="type")
]


class BlockScheduleRequest(_Strict):
    """블록 형식 /solve 요청(blocks-cases.json, 샘플 병동). 참조 검사는 식으로 바꾼 ScheduleRequest가 한다."""

    config: WardConfig = DEFAULT_CONFIG
    nurses: list[Nurse] = Field(min_length=1)
    period: Period
    holidays: list[int] = []
    constraints: list[BlockSpec] = []
    carry_over: list[CarryOverRow] = []
    previous: Assignments | None = None
    history: History | None = None
    input_version: int
