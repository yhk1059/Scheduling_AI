"""ADR-018 이전 형식: 제약 템플릿 12종, Nurse.night_only, history_load.

변환(convert.py), 골든 생성, eval 데이터셋 변환, 샘플 변환에서만 쓴다. 솔버·LLM·routes는 import하지 않는다.
"""

from typing import Annotated, Literal, Union

from pydantic import Field, model_validator

from backend.domain.constants import HISTORY_DAYS, PRIORITY_WEIGHTS
from backend.domain.models import (
    Assignments,
    CarryOverRow,
    FixedAssignment,
    Hardness,
    Nurse,
    Period,
    _AlwaysHard,
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

