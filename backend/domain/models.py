"""도메인 모델. tool input_schema, 입력 검증, 솔버 입력, TS 타입의 단일 기준이다(ADR-003)."""

from datetime import date, timedelta
import typing
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.domain.constants import (
    CARRY_OVER_DAYS,
    DEFAULT_SHIFTS,
    HISTORY_DAYS,
    MAX_PATTERN_LEN,
    MAX_PATTERNS,
    MAX_COND_CMPS,
    MAX_OFFSET,
    MAX_OFFSET_SPAN,
    MAX_PERIOD_DAYS,
    MAX_RULE_CMPS,
    MAX_RULE_VALUES,
    MAX_SHIFT_CODES,
    MAX_TAG_CHARS,
    MAX_TAGS_PER_NURSE,
    MAX_WINDOW_DAYS,
    MIN_COND_CMPS,
    MIN_OFFSET,
    MIN_PATTERN_LEN,
    MIN_WINDOW_DAYS,
    OFF_CODE,
    PRIORITY_WEIGHTS,
)

# 근무 코드는 병동 구조(config)가 정한다. 형식만 여기서 보고, 있는 코드인지는 요청 단위로 검사한다.
ShiftCode = Annotated[str, Field(pattern=r"^[A-Z0-9]{1,3}$")]
Scope = Literal["ward", "period"]
Hardness = Literal["hard", "soft"]
Priority = Literal["high", "normal", "low"]
Tag = Annotated[str, Field(min_length=1, max_length=MAX_TAG_CHARS)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- 병동 구조 ---


class ShiftDef(_Strict):
    code: ShiftCode  # "O"는 휴무(필수)
    name: str = Field(min_length=1)
    hours: float = Field(ge=0, le=24, multiple_of=0.5)
    parts: list[ShiftCode] = []  # 복합 코드면 세는 근무조. 예: DE → ["D", "E"]
    start: str | None = None  # "07:00" 표시용
    active: bool = True  # 한 번이라도 쓰인 코드는 지우지 않고 끈다


class WardConfig(_Strict):
    shifts: list[ShiftDef] = Field(min_length=1, max_length=MAX_SHIFT_CODES)

    @model_validator(mode="after")
    def _check(self):
        codes = [s.code for s in self.shifts]
        dups = sorted({c for c in codes if codes.count(c) > 1})
        if dups:
            raise ValueError(f"근무 코드가 중복됩니다: {dups}")
        by_code = {s.code: s for s in self.shifts}
        off = by_code.get(OFF_CODE)
        if off is None or off.hours != 0 or off.parts or not off.active:
            raise ValueError(f"{OFF_CODE}(휴무)는 활성이고 0시간이며 세는 근무조가 없어야 합니다")
        for s in self.shifts:
            if s.code != OFF_CODE and s.hours <= 0:
                raise ValueError(f"{s.code}: 근무 시간은 0보다 커야 합니다")
            if not s.parts:
                continue
            if len(s.parts) < 2 or len(set(s.parts)) != len(s.parts) or s.code in s.parts:
                raise ValueError(f"{s.code}: 세는 근무조는 서로 다른 코드 2개 이상이어야 합니다")
            for part in s.parts:
                p = by_code.get(part)
                if p is None or part == OFF_CODE or p.parts or not p.active:
                    raise ValueError(f"{s.code}: {part}는 복합이 아닌 활성 근무 코드가 아닙니다")
        return self

    @property
    def codes(self) -> set[str]:
        return {s.code for s in self.shifts}


DEFAULT_CONFIG = WardConfig(shifts=[ShiftDef(code=c, name=name, hours=h) for c, name, h in DEFAULT_SHIFTS])


def covers(config: WardConfig, code: str) -> set[str]:
    """코드가 세는 근무조: 자신 ∪ parts."""
    shift = next(s for s in config.shifts if s.code == code)
    return {code, *shift.parts}


# --- 병동 ---


class Nurse(_Strict):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    years: int = Field(ge=0)
    tags: list[Tag] = Field(default=[], max_length=MAX_TAGS_PER_NURSE)


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


# --- 제약 공통 필드와 칸 고정 ---


class FixedAssignmentParams(_Strict):
    nurse_id: str
    day: int
    shift: ShiftCode


class _ConstraintBase(_Strict):
    id: str = Field(min_length=1)
    scope: Scope
    hardness: Hardness = "hard"
    weight: int = Field(default=PRIORITY_WEIGHTS["normal"], gt=0)
    source_text: str
    enabled: bool = True


class _AlwaysHard(_ConstraintBase):
    @field_validator("hardness")
    @classmethod
    def _force_hard(cls, _: str) -> str:
        return "hard"


class FixedAssignment(_AlwaysHard):
    """칸 고정(수동 고정, 지난 날짜 잠금). 규칙이 아니라 데이터라서 항상 hard다."""

    type: Literal["fixed_assignment"]
    params: FixedAssignmentParams


# --- 셀렉터(ADR-018). 조건은 모두 AND, 비어 있으면 전체 ---


class People(_Strict):
    ids: list[str] | None = None
    tags: list[Tag] | None = None  # 이 태그 중 하나라도
    exclude_tags: list[Tag] = []
    min_years: int | None = Field(default=None, ge=0)
    max_years: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _years(self):
        if self.min_years is not None and self.max_years is not None and self.min_years > self.max_years:
            raise ValueError(f"min_years({self.min_years})가 max_years({self.max_years})보다 큽니다")
        return self


class Days(_Strict):
    kind: Literal["all", "weekday", "weekend", "holiday"] = "all"  # weekend = 토·일 ∪ 공휴일
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] | None = None  # 0=월 … 6=일
    days: list[int] | None = None  # 기간 안 날짜 인덱스(1..length)


class Shifts(BaseModel):
    """칸이 맞는다 = 그 칸 코드의 covers가 in과 겹친다(또는 not_in과 겹치지 않는다)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    in_: list[ShiftCode] | None = Field(default=None, alias="in", min_length=1)
    not_in: list[ShiftCode] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.in_ is None) == (self.not_in is None):
            raise ValueError("in과 not_in 중 하나만 있어야 합니다")
        return self

    @property
    def codes(self) -> list[str]:
        return self.in_ if self.in_ is not None else self.not_in  # type: ignore[return-value]


# --- 블록 params ---


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


class _BlockBase(_ConstraintBase):
    priority: Priority = "normal"

    @model_validator(mode="after")
    def _weight_from_priority(self):
        self.weight = PRIORITY_WEIGHTS[self.priority]  # 입력 weight는 무시한다
        return self


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


# --- 규칙 식(ADR-019). 재귀하지 않는다: 조건은 비교 하나, 또는 비교 2~4개의 그리고/또는 ---

ValueName = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,23}$")]


class Value(_Strict):
    """조정 가능한 값. 카드 [수정]과 완화 제안은 이 값만 바꾼다."""

    value: float = Field(ge=0)
    label: str = Field(min_length=1)


class ValueRef(_Strict):
    value: ValueName  # Rule.values에 있어야 한다


class ForEach(_Strict):
    per: Literal["period", "day", "person", "person_day", "person_week", "person_window"]
    people: People = People()
    days: Days = Days()
    window: int | None = Field(default=None, ge=MIN_WINDOW_DAYS, le=MAX_WINDOW_DAYS)

    @model_validator(mode="after")
    def _window(self):
        if (self.per == "person_window") != (self.window is not None):
            raise ValueError("window는 per=person_window일 때만, 그리고 반드시 있어야 합니다")
        return self


OffsetDay = Annotated[int, Field(ge=MIN_OFFSET, le=MAX_OFFSET)]


class Count(_Strict):
    """세는 칸: (who 또는 묶인 사람) × (묶인 날을 days로 거른 것) 중 shifts에 맞는 칸의 수(또는 근무 시간)."""

    who: People | None = None
    days: Days = Days()
    offset: tuple[OffsetDay, OffsetDay] | None = None  # 날이 묶인 범위(day, person_day)에서만. d+a..d+b
    shifts: Shifts
    measure: Literal["count", "hours"] = "count"

    @model_validator(mode="after")
    def _offset(self):
        if self.offset is not None:
            a, b = self.offset
            if a > b:
                raise ValueError(f"offset ({a}, {b}): 앞이 뒤보다 큽니다")
            if b - a + 1 > MAX_OFFSET_SPAN:
                raise ValueError(f"offset ({a}, {b}): 폭이 {MAX_OFFSET_SPAN}일을 넘습니다")
        return self


class Cmp(_Strict):
    left: Count
    op: Literal["ge", "le", "eq"]
    right: float | ValueRef | Count


CondList = Annotated[list[Cmp], Field(min_length=MIN_COND_CMPS, max_length=MAX_COND_CMPS)]


class All(_Strict):
    all: CondList


class Any(_Strict):
    any: CondList


Cond = Cmp | All | Any


class Require(_Strict):
    kind: Literal["require"]
    for_each: ForEach
    when: Cond | None = None  # 이 조건이 참인 인스턴스에서만
    then: Cond


class Balance(_Strict):
    """내장 함수 고르게: 고른 사람 사이 차이를 줄인다(고르게 블록과 같다)."""

    kind: Literal["balance"]
    people: People = People()
    days: Days = Days()
    shifts: Shifts
    measure: Literal["count", "hours"] = "count"
    with_history: bool = True
    max_gap: Annotated[float, Field(ge=0)] | ValueRef = 1  # hard일 때만: (최대 − 최소) ≤ max_gap


def cond_cmps(cond: Cond | None) -> list[Cmp]:
    if cond is None:
        return []
    if isinstance(cond, All):
        return cond.all
    if isinstance(cond, Any):
        return cond.any
    return [cond]


def rule_counts(body: "Require | Balance") -> list[Count]:
    """본문의 모든 세기(비교 양쪽)."""
    if isinstance(body, Balance):
        return []
    cmps = cond_cmps(body.when) + cond_cmps(body.then)
    return [c.left for c in cmps] + [c.right for c in cmps if isinstance(c.right, Count)]


def _value_refs(body: "Require | Balance") -> list[str]:
    if isinstance(body, Balance):
        return [body.max_gap.value] if isinstance(body.max_gap, ValueRef) else []
    cmps = cond_cmps(body.when) + cond_cmps(body.then)
    return [c.right.value for c in cmps if isinstance(c.right, ValueRef)]


class Rule(_BlockBase):
    """규칙 = 범위 + 본문. 기본 hardness는 require가 hard, balance가 soft·낮음(블록과 같다)."""

    type: Literal["rule"]
    default: bool = False  # 기본 규칙(필요 인원·나이트전담)
    values: dict[ValueName, Value] = Field(default={}, max_length=MAX_RULE_VALUES)
    body: Annotated[Require | Balance, Field(discriminator="kind")]

    @model_validator(mode="before")
    @classmethod
    def _balance_defaults(cls, data: typing.Any):
        if isinstance(data, dict):
            body = data.get("body")
            kind = body.get("kind") if isinstance(body, dict) else getattr(body, "kind", None)
            if kind == "balance":
                return {"hardness": "soft", "priority": "low", **data}
        return data

    @model_validator(mode="after")
    def _check_expr(self):
        body = self.body
        if isinstance(body, Require):
            cmps = len(cond_cmps(body.when)) + len(cond_cmps(body.then))
            if cmps > MAX_RULE_CMPS:
                raise ValueError(f"비교가 {cmps}개, {MAX_RULE_CMPS}개까지입니다")
            if body.for_each.per not in ("day", "person_day") and any(c.offset for c in rule_counts(body)):
                raise ValueError(f"offset은 날이 묶인 범위(day, person_day)에서만 씁니다(지금 {body.for_each.per})")
        refs = set(_value_refs(body))
        missing = sorted(refs - set(self.values))
        if missing:
            raise ValueError(f"values에 없는 값 {missing}")
        unused = sorted(set(self.values) - refs)
        if unused:
            raise ValueError(f"식에서 쓰지 않는 값 {unused}")
        return self


ConstraintSpec = Annotated[
    Union[CountRule, SequenceRule, BalanceRule, Rule, FixedAssignment], Field(discriminator="type")
]


# --- 요청 ---


class CarryOverRow(_Strict):
    nurse_id: str
    shifts: list[ShiftCode] = Field(max_length=CARRY_OVER_DAYS)


class History(_Strict):
    """최근 28일 확정 배정 원본. 고르게 블록마다 세는 일은 백엔드가 한다(ADR-018)."""

    start_date: date
    rows: dict[str, Annotated[list[ShiftCode], Field(max_length=HISTORY_DAYS)]]
    holidays: list[date] = []


Assignments = dict[str, list[ShiftCode]]


def _check_roster(nurses: list[Nurse]) -> None:
    for attr in ("id", "name"):
        values = [getattr(n, attr) for n in nurses]
        dups = sorted({v for v in values if values.count(v) > 1})
        if dups:
            raise ValueError(f"명단의 {attr}가 중복됩니다: {dups}")


def _constraint_refs(c: typing.Any) -> tuple[list[str], list[int]]:
    """제약이 참조하는 (nurse_ids, days)."""
    if isinstance(c, Rule):
        b = c.body
        if isinstance(b, Balance):
            people, days = [b.people], [b.days]
        else:
            counts = rule_counts(b)
            people = [b.for_each.people, *(n.who for n in counts if n.who)]
            days = [b.for_each.days, *(n.days for n in counts)]
        return [i for p in people for i in p.ids or []], [d for s in days for d in s.days or []]
    p = c.params
    if isinstance(p, FixedAssignmentParams):
        return [p.nurse_id], [p.day]
    days = getattr(p, "days", None)
    return p.people.ids or [], (days.days if days else None) or []


def _constraint_codes(c: typing.Any) -> list[str]:
    """제약이 직접 적은 근무 코드."""
    if isinstance(c, Rule):
        selectors = [c.body.shifts] if isinstance(c.body, Balance) else [n.shifts for n in rule_counts(c.body)]
        return [code for s in selectors for code in s.codes]
    p = c.params
    if isinstance(p, FixedAssignmentParams):
        return [p.shift]
    if isinstance(p, SequenceParams):
        selectors = [s for pattern in p.forbid or [] for s in pattern] + [s for s in (p.run, p.after) if s]
        return [code for s in selectors for code in s.codes]
    return p.shifts.codes


class ScheduleRequest(_Strict):
    config: WardConfig = DEFAULT_CONFIG
    nurses: list[Nurse] = Field(min_length=1)
    period: Period
    holidays: list[int] = []
    constraints: list[ConstraintSpec] = []
    carry_over: list[CarryOverRow] = []
    previous: Assignments | None = None
    history: History | None = None
    input_version: int

    @model_validator(mode="after")
    def _referential_integrity(self):
        _check_roster(self.nurses)
        ids = {n.id for n in self.nurses}
        codes = self.config.codes
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
            nurse_ids, cdays = _constraint_refs(c)
            for nurse_id in nurse_ids:
                if nurse_id not in ids:
                    errors.append(f"제약 {c.id}: 명단에 없는 nurse_id {nurse_id}")
            out = [d for d in cdays if not 1 <= d <= days]
            if out:
                errors.append(f"제약 {c.id}: 1..{days} 범위 밖 day {out}")
            unknown = sorted(set(_constraint_codes(c)) - codes)
            if unknown:
                errors.append(f"제약 {c.id}: 근무 형태에 없는 코드 {unknown}")

        for row in self.carry_over:
            if row.nurse_id not in ids:
                errors.append(f"carry_over: 명단에 없는 nurse_id {row.nurse_id}")
            unknown = sorted(set(row.shifts) - codes)
            if unknown:
                errors.append(f"carry_over: {row.nurse_id} 근무 형태에 없는 코드 {unknown}")

        for nurse_id, shifts in (self.previous or {}).items():
            if nurse_id not in ids:
                errors.append(f"previous: 명단에 없는 nurse_id {nurse_id}")
            elif len(shifts) != days:
                errors.append(f"previous: {nurse_id} 근무 {len(shifts)}일, {days}일이어야 함")
            unknown = sorted(set(shifts) - codes)
            if unknown:
                errors.append(f"previous: {nurse_id} 근무 형태에 없는 코드 {unknown}")

        for nurse_id, shifts in (self.history.rows if self.history else {}).items():
            if nurse_id not in ids:
                errors.append(f"history: 명단에 없는 nurse_id {nurse_id}")
            unknown = sorted(set(shifts) - codes)
            if unknown:
                errors.append(f"history: {nurse_id} 근무 형태에 없는 코드 {unknown}")

        if errors:
            raise ValueError("; ".join(errors))
        return self


# --- 결과 ---


class NurseStats(_Strict):
    counts: dict[str, int]  # 근무 코드별 개수(활성 코드 + 배정된 코드)
    hours: float  # 근무 시간 합
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
    config: WardConfig = DEFAULT_CONFIG
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


class ShiftChange(_Strict):
    """설정 변경 카드(ADR-018): 근무 코드 추가·수정. 삭제는 설정 화면에서만 한다."""

    action: Literal["add", "update"]
    shift: ShiftDef


class TranslateOk(_Strict):
    status: Literal["ok"]
    input_version: int
    constraints: list[ConstraintSpec]
    config_changes: list[ShiftChange] = []


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
    params: dict[str, typing.Any] | None = None
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
