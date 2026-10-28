"""도메인 모델. tool input_schema, 입력 검증, 솔버 입력, TS 타입의 단일 기준이다(ADR-003)."""

from datetime import date, timedelta
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.domain.constants import (
    CARRY_OVER_DAYS,
    DEFAULT_SOFT_WEIGHTS,
    DEFAULT_WEIGHT,
    HISTORY_DAYS,
    MAX_PERIOD_DAYS,
)

ShiftCode = Literal["D", "E", "N", "O"]
WorkShift = Literal["D", "E", "N"]
Scope = Literal["ward", "period"]
Hardness = Literal["hard", "soft"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- 병동 ---


class Nurse(_Strict):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    years: int = Field(ge=0)
    night_only: bool = False


class Period(_Strict):
    """시작일 + 길이(ADR-015). 날짜는 기간 안의 1..length 인덱스로 다룬다."""

    start_date: date
    length: int = Field(ge=1, le=MAX_PERIOD_DAYS)

    @property
    def days(self) -> int:
        return self.length

    def date_of(self, day: int) -> date:
        return self.start_date + timedelta(days=day - 1)

    def weekday(self, day: int) -> int:
        """0=월 … 6=일."""
        return self.date_of(day).weekday()


# --- 제약 템플릿 params ---


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
    first: ShiftCode
    second: ShiftCode


class DaysParams(_Strict):
    days: int = Field(ge=1)


class SkillMixParams(_Strict):
    shift: WorkShift
    min_years: int = Field(ge=0)
    min_count: int = Field(ge=1)


class LeaveParams(_Strict):
    nurse_id: str
    days: list[int] = Field(min_length=1)


class FixedAssignmentParams(_Strict):
    nurse_id: str
    day: int
    shift: ShiftCode


class ShiftPreferenceParams(_Strict):
    nurse_id: str
    shift: ShiftCode
    prefer: bool
    days: list[int] | None = None
    weekends_only: bool = False


class EmptyParams(_Strict):
    pass


# --- 제약 (type 기반 discriminated union) ---


class _ConstraintBase(_Strict):
    id: str = Field(min_length=1)
    scope: Scope
    hardness: Hardness = "hard"
    weight: int = Field(default=DEFAULT_WEIGHT, gt=0)
    source_text: str
    enabled: bool = True


class _AlwaysHard(_ConstraintBase):
    @field_validator("hardness")
    @classmethod
    def _force_hard(cls, _: str) -> str:
        return "hard"


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


class FixedAssignment(_AlwaysHard):
    type: Literal["fixed_assignment"]
    params: FixedAssignmentParams


class ShiftPreference(_ConstraintBase):
    type: Literal["shift_preference"]
    hardness: Hardness = "soft"
    weight: int = Field(default=DEFAULT_SOFT_WEIGHTS["shift_preference"], gt=0)
    params: ShiftPreferenceParams


class NightFairness(_ConstraintBase):
    type: Literal["night_fairness"]
    hardness: Hardness = "soft"
    weight: int = Field(default=DEFAULT_SOFT_WEIGHTS["night_fairness"], gt=0)
    params: EmptyParams = Field(default_factory=EmptyParams)


class WeekendFairness(_ConstraintBase):
    type: Literal["weekend_fairness"]
    hardness: Hardness = "soft"
    weight: int = Field(default=DEFAULT_SOFT_WEIGHTS["weekend_fairness"], gt=0)
    params: EmptyParams = Field(default_factory=EmptyParams)


ConstraintSpec = Annotated[
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


class CarryOverRow(_Strict):
    nurse_id: str
    shifts: list[ShiftCode] = Field(max_length=CARRY_OVER_DAYS)


class HistoryLoad(_Strict):
    """최근 4주 누적 부담. 클라이언트가 지난 확정본에서 계산해 보낸다(ADR-015)."""

    nurse_id: str
    nights: int = Field(ge=0, le=HISTORY_DAYS)  # 최근 28일 N 수
    weekends: int = Field(ge=0, le=HISTORY_DAYS)  # 최근 28일 주말·공휴일 근무(D/E/N) 수


Assignments = dict[str, list[ShiftCode]]


def _check_roster(nurses: list[Nurse]) -> None:
    for attr in ("id", "name"):
        values = [getattr(n, attr) for n in nurses]
        dups = sorted({v for v in values if values.count(v) > 1})
        if dups:
            raise ValueError(f"명단의 {attr}가 중복됩니다: {dups}")


def _constraint_refs(c: Any) -> tuple[str | None, list[int]]:
    """제약이 참조하는 (nurse_id, days)."""
    p = c.params
    if isinstance(p, LeaveParams):
        return p.nurse_id, p.days
    if isinstance(p, FixedAssignmentParams):
        return p.nurse_id, [p.day]
    if isinstance(p, ShiftPreferenceParams):
        return p.nurse_id, p.days or []
    return None, []


class ScheduleRequest(_Strict):
    nurses: list[Nurse] = Field(min_length=1)
    period: Period
    holidays: list[int] = []
    constraints: list[ConstraintSpec] = []
    carry_over: list[CarryOverRow] = []
    previous: Assignments | None = None
    history_load: list[HistoryLoad] = []
    input_version: int

    @model_validator(mode="after")
    def _referential_integrity(self):
        _check_roster(self.nurses)
        ids = {n.id for n in self.nurses}
        days = self.period.days
        errors: list[str] = []

        bad = [d for d in self.holidays if not 1 <= d <= days]
        if bad:
            errors.append(f"holidays: 1..{days} 범위 밖 {bad}")

        seen: set[str] = set()
        for c in self.constraints:
            if c.id in seen:
                errors.append(f"제약 {c.id}: id 중복")
            seen.add(c.id)
            nurse_id, cdays = _constraint_refs(c)
            if nurse_id is not None and nurse_id not in ids:
                errors.append(f"제약 {c.id}: 명단에 없는 nurse_id {nurse_id}")
            out = [d for d in cdays if not 1 <= d <= days]
            if out:
                errors.append(f"제약 {c.id}: 1..{days} 범위 밖 day {out}")

        for row in self.carry_over:
            if row.nurse_id not in ids:
                errors.append(f"carry_over: 명단에 없는 nurse_id {row.nurse_id}")

        loaded: set[str] = set()
        for h in self.history_load:
            if h.nurse_id not in ids:
                errors.append(f"history_load: 명단에 없는 nurse_id {h.nurse_id}")
            elif h.nurse_id in loaded:
                errors.append(f"history_load: nurse_id {h.nurse_id} 중복")
            loaded.add(h.nurse_id)

        for nurse_id, shifts in (self.previous or {}).items():
            if nurse_id not in ids:
                errors.append(f"previous: 명단에 없는 nurse_id {nurse_id}")
            elif len(shifts) != days:
                errors.append(f"previous: {nurse_id} 근무 {len(shifts)}일, {days}일이어야 함")

        if errors:
            raise ValueError("; ".join(errors))
        return self


# --- 결과 ---


class NurseStats(_Strict):
    D: int
    E: int
    N: int
    O: int
    weekend_holiday_work: int
    max_consecutive_work: int
    preference_rate: float | None
    deviation: float


class Summary(_Strict):
    preferences_total: int
    preferences_met: int
    soft_violation_count: int


class SoftViolation(_Strict):
    constraint_id: str
    nurse_id: str | None = None
    day: int | None = None
    detail: str


class DiffCell(_Strict):
    nurse_id: str
    day: int
    before: ShiftCode
    after: ShiftCode


class ScheduleResult(_Strict):
    assignments: Assignments
    summary: Summary
    stats: dict[str, NurseStats]
    soft_violations: list[SoftViolation]
    diff: list[DiffCell] | None = None
    optimal: bool


class Conflict(_Strict):
    constraint_id: str
    type: str
    source_text: str


# --- /solve 응답 ---


class SolveOk(_Strict):
    status: Literal["ok"]
    input_version: int
    result: ScheduleResult


class SolveInfeasible(_Strict):
    status: Literal["infeasible"]
    input_version: int
    conflicts: list[Conflict]


class SolveTimeout(_Strict):
    status: Literal["timeout"]
    input_version: int


SolveResponse = Annotated[Union[SolveOk, SolveInfeasible, SolveTimeout], Field(discriminator="status")]


# --- /translate ---


class TranslateContext(_Strict):
    nurses: list[Nurse]
    period: Period
    holidays: list[int] = []
    today: date

    @model_validator(mode="after")
    def _roster(self):
        _check_roster(self.nurses)
        return self


class TranslateRequest(_Strict):
    text: str
    scope: Scope
    context: TranslateContext
    input_version: int


class TranslateOk(_Strict):
    status: Literal["ok"]
    input_version: int
    constraints: list[ConstraintSpec]


class TranslateClarify(_Strict):
    status: Literal["clarify"]
    input_version: int
    question: str


class TranslateUnsupported(_Strict):
    status: Literal["unsupported"]
    input_version: int
    reason: str


TranslateResponse = Annotated[
    Union[TranslateOk, TranslateClarify, TranslateUnsupported], Field(discriminator="status")
]


# --- /explain ---


class ConstraintChange(_Strict):
    action: Literal["disable", "update"]
    constraint_id: str
    params: dict[str, Any] | None = None
    hardness: Hardness | None = None


class RelaxationProposal(_Strict):
    title: str
    description: str
    changes: list[ConstraintChange]
    verified_summary: Summary | None = None


class ExplainRequest(_Strict):
    request: ScheduleRequest
    conflicts: list[Conflict]


class ExplainResponse(_Strict):
    text: str
    proposals: list[RelaxationProposal]
    fallback: bool
    input_version: int


# --- 오류 ---


class ErrorDetail(_Strict):
    code: str
    message: str
    request_id: str


class ErrorBody(_Strict):
    error: ErrorDetail
