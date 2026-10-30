"""도메인 모델: 식 규칙·칸 고정 직렬화, hardness·중요도 기본값, 검증, 옛 형식 거부, 참조 무결성, 샘플."""

import json
from datetime import date
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.domain import constants
from backend.domain.models import (
    DEFAULT_CONFIG,
    ConstraintChange,
    ConstraintSpec,
    ErrorBody,
    ExplainRequest,
    Period,
    ScheduleRequest,
    ShiftDef,
    SolveResponse,
    TranslateRequest,
    TranslateResponse,
)
from backend.tests import rules

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "lib" / "samples" / "shop-12.json"
spec_adapter = TypeAdapter(ConstraintSpec)

# 템플릿 12종이 바뀐 식 규칙 모양(설계 §2.5)
RULES = [
    rules.coverage("D", "weekday", 3, 4),
    rules.forbid("c2", "N", "D"),
    rules.max_work("c3", 5),
    rules.max_nights("c4", 3),
    rules.min_off("c5", 8),
    rules.off_after_night("c6", 1),
    rules.leave("c8", "e01", [15, 16, 17]),
    rules.fixed("c9", "e02", 3, "E"),
    rules.preference("c10", "e03", "O", 9, weekends_only=True),
    rules.night_fair("c11"),
    rules.weekend_fair("c12"),
]


def _is_balance(raw: dict) -> bool:
    return raw.get("body", {}).get("kind") == "balance"


def _block(cid: str, type_: str, params: dict) -> dict:
    return {"id": cid, "type": type_, "scope": "shop", "hardness": "hard", "source_text": "원문", "params": params}


def employees(n: int = 3) -> list[dict]:
    return [{"id": f"e{i:02d}", "name": f"직원{i}", "tags": []} for i in range(1, n + 1)]


def request(constraints: list[dict], **extra) -> dict:
    return {
        "config": rules.DEN_CONFIG,
        "employees": employees(),
        "period": {"start_date": "2026-11-01", "length": 30},
        "holidays": [],
        "constraints": constraints,
        "input_version": 0,
        **extra,
    }


# --- 제약 ---


def test_constraint_types_are_rules_and_fixed():
    assert {r["type"] for r in RULES} == {"rule", "fixed_assignment"}


@pytest.mark.parametrize("raw", RULES, ids=[r["id"] for r in RULES])
def test_constraint_roundtrip(raw):
    spec = spec_adapter.validate_python(raw)
    assert spec.type == raw["type"]
    dumped = spec_adapter.dump_python(spec, mode="json")
    assert spec_adapter.validate_json(json.dumps(dumped)) == spec
    assert isinstance(dumped["params" if raw["type"] == "fixed_assignment" else "body"], dict)
    assert dumped["enabled"] is True


def test_fixed_assignment_is_always_hard():
    raw = next(r for r in RULES if r["type"] == "fixed_assignment")
    assert spec_adapter.validate_python({**raw, "hardness": "soft"}).hardness == "hard"


def test_default_hardness_and_weight_per_type():
    for raw in RULES:
        without = {k: v for k, v in raw.items() if k not in ("hardness", "priority", "weight")}
        spec = spec_adapter.validate_python(without)
        assert spec.hardness == ("soft" if _is_balance(raw) else "hard")
        assert spec.weight == constants.PRIORITY_WEIGHTS["low" if _is_balance(raw) else "normal"]


@pytest.mark.parametrize("type_", ["daily_coverage", "leave", "shift_preference", "night_fairness", "unknown"])
def test_template_types_rejected(type_):
    with pytest.raises(ValidationError):
        spec_adapter.validate_python(_block("x", type_, {}))


OLD_BLOCKS = [
    _block("x", "count", {"shifts": {"in": ["D"]}, "per": "day", "min": 3}),
    _block("x", "sequence", {"forbid": [[{"in": ["N"]}, {"in": ["D"]}]]}),
    {**_block("x", "balance", {"shifts": {"in": ["N"]}}), "hardness": "soft"},
]


@pytest.mark.parametrize("raw", OLD_BLOCKS, ids=[b["type"] for b in OLD_BLOCKS])
def test_block_types_rejected(raw):
    """블록 3종은 옛 형식이다(ADR-019 ★2). 요청은 식 규칙만 받는다."""
    with pytest.raises(ValidationError, match="does not match any of the expected tags"):
        spec_adapter.validate_python(raw)


@pytest.mark.parametrize(
    "raw",
    [
        {**rules.min_off("x", 8), "values": {"min": {"value": 8, "label": "최소"}, "max": {"value": 9, "label": "최대"}}},
        rules.max_work("x", 0),
        rules.min_off("x", -1),
        rules.off_after_night("x", 0),
        {**rules.min_off("x", 8), "values": {}},
        {**rules.max_work("x", 5), "weight": 0},
        {**rules.max_work("x", 5), "body": {**rules.max_work("x", 5)["body"], "extra": 1}},
        {**rules.night_fair("x"), "scope": "year"},
        {**rules.night_fair("x"), "priority": "urgent"},
    ],
    ids=["unused-value", "run-0", "min-negative", "then-off-0", "no-value", "weight-0", "extra-key", "bad-scope", "bad-priority"],
)
def test_invalid_params_rejected(raw):
    with pytest.raises(ValidationError):
        spec_adapter.validate_python(raw)


# --- Period ---


def test_period_days_is_length():
    assert Period(start_date=date(2026, 11, 1), length=30).days == 30
    assert Period(start_date=date(2026, 11, 2), length=7).days == 7


def test_period_date_of_crosses_month():
    p = Period(start_date=date(2026, 11, 23), length=14)
    assert p.date_of(1) == date(2026, 11, 23)
    assert p.date_of(8) == date(2026, 11, 30)
    assert p.date_of(9) == date(2026, 12, 1)
    assert p.date_of(14) == date(2026, 12, 6)


def test_period_weekday():
    p = Period(start_date=date(2026, 11, 1), length=30)  # 11/1 일요일
    assert p.weekday(1) == 6
    assert p.weekday(2) == 0
    assert p.weekday(7) == 5


def test_period_accepts_iso_string():
    p = Period.model_validate({"start_date": "2026-11-01", "length": 30})
    assert p.start_date == date(2026, 11, 1)


@pytest.mark.parametrize("length", [0, constants.MAX_PERIOD_DAYS + 1])
def test_period_rejects_bad_length(length):
    with pytest.raises(ValidationError):
        Period(start_date=date(2026, 11, 1), length=length)


def test_period_rejects_old_shape():
    with pytest.raises(ValidationError):
        Period.model_validate({"year": 2026, "month": 11})


# --- ScheduleRequest 참조 무결성 ---


def test_schedule_request_accepts_all_rules():
    req = ScheduleRequest.model_validate(request(RULES))
    assert len(req.constraints) == 11
    assert req.carry_over == []
    assert req.previous is None
    assert req.history is None


def test_unknown_employee_id_reports_constraint_id():
    bad = rules.leave("bad-leave", "e99", [1])
    with pytest.raises(ValidationError, match="bad-leave"):
        ScheduleRequest.model_validate(request([bad]))


@pytest.mark.parametrize(
    "raw",
    [
        rules.leave("bad-day", "e01", [31]),
        rules.fixed("bad-day", "e01", 0, "D"),
        rules.preference("bad-day", "e01", "N", None, [40]),
    ],
)
def test_day_out_of_range_reports_constraint_id(raw):
    with pytest.raises(ValidationError, match="bad-day"):
        ScheduleRequest.model_validate(request([raw]))


def test_holiday_out_of_range_rejected():
    with pytest.raises(ValidationError, match="holidays"):
        ScheduleRequest.model_validate(request([], holidays=[31]))


def test_carry_over_unknown_employee_rejected():
    with pytest.raises(ValidationError, match="e99"):
        ScheduleRequest.model_validate(request([], carry_over=[{"employee_id": "e99", "shifts": ["N"]}]))


def test_carry_over_longer_than_limit_rejected():
    shifts = ["D"] * (constants.CARRY_OVER_DAYS + 1)
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request([], carry_over=[{"employee_id": "e01", "shifts": shifts}]))


def test_previous_must_match_roster_and_period():
    good = {n["id"]: ["O"] * 30 for n in employees()}
    assert ScheduleRequest.model_validate(request([], previous=good)).previous == good
    with pytest.raises(ValidationError, match="e99"):
        ScheduleRequest.model_validate(request([], previous={**good, "e99": ["O"] * 30}))
    with pytest.raises(ValidationError, match="e01"):
        ScheduleRequest.model_validate(request([], previous={**good, "e01": ["O"] * 29}))


def test_duplicate_employee_ids_or_names_rejected():
    dup_id = employees() + [{"id": "e01", "name": "다른이름"}]
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "employees": dup_id})
    dup_name = employees() + [{"id": "e09", "name": "직원1"}]
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "employees": dup_name})


def test_duplicate_constraint_ids_rejected():
    raw = rules.night_fair("same")
    with pytest.raises(ValidationError, match="same"):
        ScheduleRequest.model_validate(request([raw, raw]))


# --- 근무조 시각 ---


def _shift(**over) -> dict:
    return {"code": "A", "name": "오픈", "hours": 6, "start": "09:00", "end": "15:00", **over}


@pytest.mark.parametrize("start,end", [("09:00", "15:00"), ("00:00", "00:30"), ("17:30", "24:00")])
def test_shift_times_accept_half_hours_up_to_midnight(start, end):
    assert ShiftDef.model_validate(_shift(start=start, end=end)).end == end


@pytest.mark.parametrize(
    "start,end",
    [
        ("09:15", "15:00"),  # 30분 단위가 아님
        ("9:00", "15:00"),
        ("09:00", "24:30"),
        ("09:00", "25:00"),
        ("22:00", "02:00"),  # 자정을 넘김
        ("09:00", "09:00"),
        ("24:00", "24:00"),
        (None, "15:00"),  # 둘 다 필수
        ("09:00", None),
        (None, None),
    ],
)
def test_shift_times_rejected(start, end):
    with pytest.raises(ValidationError):
        ShiftDef.model_validate(_shift(start=start, end=end))


def test_off_and_double_have_no_times():
    assert ShiftDef(code="O", name="휴무", hours=0).start is None
    assert ShiftDef(code="AC", name="더블", hours=12, parts=["A", "C"]).end is None
    for bad in ({"code": "O", "name": "휴무", "hours": 0}, {"code": "AC", "name": "더블", "hours": 12, "parts": ["A", "C"]}):
        with pytest.raises(ValidationError):
            ShiftDef.model_validate({**bad, "start": "09:00", "end": "15:00"})
        with pytest.raises(ValidationError):
            ShiftDef.model_validate({**bad, "end": "15:00"})


def test_default_config_is_shop_shifts():
    assert [(s.code, s.name, s.start, s.end, s.hours) for s in DEFAULT_CONFIG.shifts] == [
        ("A", "오픈", "09:00", "15:00", 6),
        ("M", "미들", "12:00", "18:00", 6),
        ("C", "마감", "17:00", "23:00", 6),
        ("O", "휴무", None, None, 0),
    ]
    assert constants.OFF_CODE == "O"


# --- 샘플 ---


def test_sample_shop_is_rule_format():
    """샘플 매장(lib/samples)은 식 규칙이다. 파일이 그대로 요청이 된다."""
    raw = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    assert raw.pop("name") == "샘플 매장"
    next_requests = TypeAdapter(list[ConstraintSpec]).validate_python(raw.pop("next_requests"))
    assert next_requests and all(c.scope == "period" and c.type == "rule" for c in next_requests)
    req = ScheduleRequest.model_validate(raw)
    assert req.model_dump(mode="json", by_alias=True) == raw  # Pydantic dump 그대로(손으로 고친 흔적 없음)
    coverage = [c for c in req.constraints if c.id.startswith("cov-")]
    assert {c.id for c in coverage} == {f"cov-{k}-{s}" for s in "AMC" for k in ("weekday", "weekend")}
    assert all(c.scope == "shop" and c.hardness == "hard" for c in coverage)
    assert {c.type for c in req.constraints} == {"rule"}
    assert req.config == DEFAULT_CONFIG
    assert req.input_version == 0
    assert req.period == Period(start_date=date(2026, 11, 2), length=28)
    assert req.holidays == []
    assert len(req.employees) == 12
    names = {n.name for n in req.employees}
    assert {"이영희", "박민수", "김철수", "정유진", "최지훈"} <= names
    assert all(c.default for c in req.constraints if c.id.startswith("cov-"))


# --- 응답/요청 모델 ---


def test_solve_response_discriminates_by_status():
    adapter = TypeAdapter(SolveResponse)
    assert type(adapter.validate_python({"status": "timeout", "input_version": 3})).__name__ == "SolveTimeout"
    infeasible = adapter.validate_python(
        {
            "status": "infeasible",
            "input_version": 1,
            "conflicts": [{"constraint_id": "c1", "type": "rule", "source_text": "휴가"}],
        }
    )
    assert infeasible.conflicts[0].constraint_id == "c1"
    stats = {
        "counts": {"D": 1, "E": 0, "N": 0, "O": 1},
        "hours": 8,
        "weekend_holiday_work": 0,
        "max_consecutive_work": 1,
        "preference_rate": None,
        "deviation": 0.0,
    }
    result = {
        "assignments": {"e01": ["D", "O"]},
        "summary": {"preferences_total": 1, "preferences_met": 1, "soft_violation_count": 0},
        "stats": {"e01": stats},
        "soft_violations": [],
        "diff": None,
        "optimal": True,
    }
    ok = adapter.validate_python({"status": "ok", "input_version": 2, "result": result})
    assert ok.result.optimal is True
    assert ok.result.stats["e01"].counts["D"] == 1
    old = {**result, "stats": {"e01": {**stats, "D": 1, "E": 0, "N": 0, "O": 1}}}
    with pytest.raises(ValidationError):  # D/E/N/O 필드는 counts로 바뀌었다
        adapter.validate_python({"status": "ok", "input_version": 2, "result": old})


def test_translate_models():
    req = TranslateRequest.model_validate(
        {
            "text": "나이트 다음 날은 무조건 쉬게",
            "scope": "shop",
            "context": {"employees": employees(), "period": {"start_date": "2026-11-01", "length": 30}, "holidays": [], "today": "2026-10-26"},
            "input_version": 5,
        }
    )
    assert req.context.today.isoformat() == "2026-10-26"
    adapter = TypeAdapter(TranslateResponse)
    ok = adapter.validate_python({"status": "ok", "input_version": 5, "constraints": [RULES[1]]})
    assert ok.constraints[0].type == "rule"
    with pytest.raises(ValidationError):  # 블록은 응답에도 없다
        adapter.validate_python({"status": "ok", "input_version": 5, "constraints": [OLD_BLOCKS[1]]})
    assert adapter.validate_python({"status": "clarify", "input_version": 5, "question": "누구?"}).question == "누구?"
    assert adapter.validate_python({"status": "unsupported", "input_version": 5, "reason": "x"}).reason == "x"


def test_explain_request_wraps_schedule_request():
    req = ExplainRequest.model_validate(
        {"request": request(RULES), "conflicts": [{"constraint_id": "c8", "type": "rule", "source_text": "휴가"}]}
    )
    assert req.request.input_version == 0


@pytest.mark.parametrize(
    "raw",
    [
        {"action": "update", "constraint_id": "c1", "params": {"min": 2}},
        {"action": "update", "constraint_id": "c1", "hardness": "soft"},
        {"action": "disable", "constraint_id": "c1", "params": {"min": 2}},
    ],
    ids=["update-params", "update-hardness", "params-field"],
)
def test_constraint_change_update_rejected(raw):
    """블록용 update(params 교체)는 없어졌다(ADR-019 ★7). 남는 것은 disable | set_value | set_hardness."""
    with pytest.raises(ValidationError):
        ConstraintChange.model_validate(raw)


def test_constraint_change_actions():
    assert ConstraintChange.model_validate({"action": "disable", "constraint_id": "c1"}).action == "disable"
    sv = ConstraintChange.model_validate({"action": "set_value", "constraint_id": "c1", "name": "min", "value": 2})
    assert (sv.name, sv.value) == ("min", 2)
    sh = ConstraintChange.model_validate({"action": "set_hardness", "constraint_id": "c1", "hardness": "soft"})
    assert sh.hardness == "soft"


def test_error_body():
    body = ErrorBody.model_validate({"error": {"code": "VALIDATION_ERROR", "message": "m", "request_id": "r1"}})
    assert body.error.code == "VALIDATION_ERROR"


# --- history(최근 28일 원본) ---


def test_history_load_rejected():
    load = [{"employee_id": "e01", "nights": 8, "weekends": 3}]
    with pytest.raises(ValidationError):  # 두 숫자 요약은 원본 history로 바뀌었다
        ScheduleRequest.model_validate(request([], history_load=load))


def test_history_accepted():
    history = rules.history("2026-11-01", {"e01": ["N"] * 8})
    req = ScheduleRequest.model_validate(request([], history=history))
    assert req.history.rows["e01"].count("N") == 8
    assert req.history.start_date == date(2026, 10, 4)


def test_history_unknown_employee_or_code_rejected():
    with pytest.raises(ValidationError, match="e99"):
        ScheduleRequest.model_validate(request([], history=rules.history("2026-11-01", {"e99": ["N"]})))
    with pytest.raises(ValidationError, match="M"):
        ScheduleRequest.model_validate(request([], history=rules.history("2026-11-01", {"e01": ["M"]})))


def test_history_longer_than_limit_rejected():
    history = {"start_date": "2026-10-01", "rows": {"e01": ["O"] * (constants.HISTORY_DAYS + 1)}, "holidays": []}
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request([], history=history))
