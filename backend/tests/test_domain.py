"""도메인 모델: 템플릿 12개 직렬화, hardness 강제, params 검증, 참조 무결성, 샘플."""

import json
from datetime import date
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.domain import constants
from backend.domain.models import (
    ConstraintSpec,
    ErrorBody,
    ExplainRequest,
    Period,
    ScheduleRequest,
    SolveResponse,
    TranslateRequest,
    TranslateResponse,
)

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "lib" / "samples" / "ward-15.json"
spec_adapter = TypeAdapter(ConstraintSpec)


def common(cid: str, type_: str, **extra) -> dict:
    return {
        "id": cid,
        "type": type_,
        "scope": "ward",
        "hardness": "hard",
        "weight": 1,
        "source_text": "원문",
        **extra,
    }


TEMPLATES = [
    common("c1", "daily_coverage", params={"shift": "D", "day_kind": "weekday", "min": 3, "max": 4}),
    common("c2", "forbidden_sequence", params={"first": "N", "second": "D"}),
    common("c3", "max_consecutive_work", params={"days": 5}),
    common("c4", "max_consecutive_nights", params={"days": 3}),
    common("c5", "min_days_off", params={"days": 8}),
    common("c6", "off_after_night_block", params={"days": 1}),
    common("c7", "skill_mix", params={"shift": "N", "min_years": 3, "min_count": 1}),
    common("c8", "leave", scope="period", params={"nurse_id": "n01", "days": [15, 16, 17]}),
    common("c9", "fixed_assignment", scope="period", params={"nurse_id": "n02", "day": 3, "shift": "E"}),
    common(
        "c10",
        "shift_preference",
        scope="period",
        hardness="soft",
        params={"nurse_id": "n03", "shift": "O", "prefer": True, "days": None, "weekends_only": True},
    ),
    common("c11", "night_fairness", hardness="soft", params={}),
    common("c12", "weekend_fairness", hardness="soft", params={}),
]


def nurses(n: int = 3) -> list[dict]:
    return [{"id": f"n{i:02d}", "name": f"간호사{i}", "years": i, "night_only": False} for i in range(1, n + 1)]


def request(constraints: list[dict], **extra) -> dict:
    return {
        "nurses": nurses(),
        "period": {"start_date": "2026-11-01", "length": 30},
        "holidays": [],
        "constraints": constraints,
        "input_version": 0,
        **extra,
    }


# --- 템플릿 ---


def test_twelve_templates_cover_all_types():
    assert len({t["type"] for t in TEMPLATES}) == 12


@pytest.mark.parametrize("raw", TEMPLATES, ids=[t["type"] for t in TEMPLATES])
def test_template_roundtrip(raw):
    spec = spec_adapter.validate_python(raw)
    assert spec.type == raw["type"]
    dumped = spec_adapter.dump_python(spec, mode="json")
    assert spec_adapter.validate_json(json.dumps(dumped)) == spec
    assert isinstance(dumped["params"], dict)
    assert dumped["enabled"] is True


@pytest.mark.parametrize("type_", ["leave", "fixed_assignment"])
def test_leave_and_fixed_are_always_hard(type_):
    raw = next(t for t in TEMPLATES if t["type"] == type_)
    spec = spec_adapter.validate_python({**raw, "hardness": "soft"})
    assert spec.hardness == "hard"


def test_default_hardness_per_template():
    soft = {"shift_preference", "night_fairness", "weekend_fairness"}
    for raw in TEMPLATES:
        without = {k: v for k, v in raw.items() if k not in ("hardness", "weight")}
        spec = spec_adapter.validate_python(without)
        assert spec.hardness == ("soft" if raw["type"] in soft else "hard")
        assert spec.weight > 0


def test_soft_templates_default_to_constant_weights():
    for type_, weight in constants.DEFAULT_SOFT_WEIGHTS.items():
        raw = next(t for t in TEMPLATES if t["type"] == type_)
        spec = spec_adapter.validate_python({k: v for k, v in raw.items() if k != "weight"})
        assert spec.weight == weight


@pytest.mark.parametrize(
    "raw",
    [
        common("x", "daily_coverage", params={"shift": "D", "day_kind": "weekday", "min": 5, "max": 4}),
        common("x", "daily_coverage", params={"shift": "O", "day_kind": "weekday", "min": 1, "max": 2}),
        common("x", "max_consecutive_work", params={"days": 0}),
        common("x", "max_consecutive_nights", params={"days": 0}),
        common("x", "min_days_off", params={"days": 0}),
        common("x", "off_after_night_block", params={"days": 0}),
        common("x", "skill_mix", params={"shift": "D", "min_years": 3, "min_count": 0}),
        common("x", "leave", params={"nurse_id": "n01", "days": []}),
        {**common("x", "max_consecutive_work", params={"days": 5}), "weight": 0},
        common("x", "max_consecutive_work", params={"days": 5, "extra": 1}),
        common("x", "unknown_template", params={}),
        {**common("x", "night_fairness", params={}), "scope": "year"},
    ],
    ids=[
        "min>max",
        "coverage-off-shift",
        "work-days-0",
        "nights-days-0",
        "off-days-0",
        "night-block-days-0",
        "min_count-0",
        "leave-empty-days",
        "weight-0",
        "extra-param",
        "unknown-type",
        "bad-scope",
    ],
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


def test_schedule_request_accepts_all_templates():
    req = ScheduleRequest.model_validate(request(TEMPLATES))
    assert len(req.constraints) == 12
    assert req.carry_over == []
    assert req.previous is None


def test_unknown_nurse_id_reports_constraint_id():
    bad = common("bad-leave", "leave", params={"nurse_id": "n99", "days": [1]})
    with pytest.raises(ValidationError, match="bad-leave"):
        ScheduleRequest.model_validate(request([bad]))


@pytest.mark.parametrize(
    "raw",
    [
        common("bad-day", "leave", params={"nurse_id": "n01", "days": [31]}),
        common("bad-day", "fixed_assignment", params={"nurse_id": "n01", "day": 0, "shift": "D"}),
        common(
            "bad-day",
            "shift_preference",
            params={"nurse_id": "n01", "shift": "N", "prefer": False, "days": [40], "weekends_only": False},
        ),
    ],
)
def test_day_out_of_range_reports_constraint_id(raw):
    with pytest.raises(ValidationError, match="bad-day"):
        ScheduleRequest.model_validate(request([raw]))


def test_holiday_out_of_range_rejected():
    with pytest.raises(ValidationError, match="holidays"):
        ScheduleRequest.model_validate(request([], holidays=[31]))


def test_carry_over_unknown_nurse_rejected():
    with pytest.raises(ValidationError, match="n99"):
        ScheduleRequest.model_validate(request([], carry_over=[{"nurse_id": "n99", "shifts": ["N"]}]))


def test_carry_over_longer_than_limit_rejected():
    shifts = ["D"] * (constants.CARRY_OVER_DAYS + 1)
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request([], carry_over=[{"nurse_id": "n01", "shifts": shifts}]))


def test_previous_must_match_roster_and_period():
    good = {n["id"]: ["O"] * 30 for n in nurses()}
    assert ScheduleRequest.model_validate(request([], previous=good)).previous == good
    with pytest.raises(ValidationError, match="n99"):
        ScheduleRequest.model_validate(request([], previous={**good, "n99": ["O"] * 30}))
    with pytest.raises(ValidationError, match="n01"):
        ScheduleRequest.model_validate(request([], previous={**good, "n01": ["O"] * 29}))


def test_duplicate_nurse_ids_or_names_rejected():
    dup_id = nurses() + [{"id": "n01", "name": "다른이름", "years": 1, "night_only": False}]
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "nurses": dup_id})
    dup_name = nurses() + [{"id": "n09", "name": "간호사1", "years": 1, "night_only": False}]
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "nurses": dup_name})


def test_duplicate_constraint_ids_rejected():
    raw = common("same", "night_fairness", params={})
    with pytest.raises(ValidationError, match="same"):
        ScheduleRequest.model_validate(request([raw, raw]))


def test_negative_years_rejected():
    bad = nurses()
    bad[0]["years"] = -1
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "nurses": bad})


# --- 샘플 ---


def test_sample_ward_is_valid():
    raw = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    req = ScheduleRequest.model_validate(raw)
    assert req.input_version == 0
    assert req.period == Period(start_date=date(2026, 11, 1), length=30)
    assert req.holidays == []
    assert len(req.nurses) == 15
    assert sum(n.night_only for n in req.nurses) == 2
    names = {n.name for n in req.nurses}
    assert {"이영희", "박민수", "김철수", "정유진", "최지훈"} <= names
    years = [n.years for n in req.nurses]
    assert min(years) >= 1 and max(years) <= 15 and len(set(years)) >= 8
    coverage = [c for c in req.constraints if c.type == "daily_coverage"]
    assert coverage and all(c.scope == "ward" and c.hardness == "hard" for c in coverage)
    kinds = {(c.params.shift, c.params.day_kind) for c in coverage}
    assert kinds == {(s, k) for s in "DEN" for k in ("weekday", "weekend")}


# --- 응답/요청 모델 ---


def test_solve_response_discriminates_by_status():
    adapter = TypeAdapter(SolveResponse)
    assert type(adapter.validate_python({"status": "timeout", "input_version": 3})).__name__ == "SolveTimeout"
    infeasible = adapter.validate_python(
        {
            "status": "infeasible",
            "input_version": 1,
            "conflicts": [{"constraint_id": "c1", "type": "leave", "source_text": "휴가"}],
        }
    )
    assert infeasible.conflicts[0].constraint_id == "c1"
    ok = adapter.validate_python(
        {
            "status": "ok",
            "input_version": 2,
            "result": {
                "assignments": {"n01": ["D", "O"]},
                "summary": {"preferences_total": 1, "preferences_met": 1, "soft_violation_count": 0},
                "stats": {
                    "n01": {
                        "D": 1,
                        "E": 0,
                        "N": 0,
                        "O": 1,
                        "weekend_holiday_work": 0,
                        "max_consecutive_work": 1,
                        "preference_rate": None,
                        "deviation": 0.0,
                    }
                },
                "soft_violations": [],
                "diff": None,
                "optimal": True,
            },
        }
    )
    assert ok.result.optimal is True


def test_translate_models():
    req = TranslateRequest.model_validate(
        {
            "text": "나이트 다음 날은 무조건 쉬게",
            "scope": "ward",
            "context": {"nurses": nurses(), "period": {"start_date": "2026-11-01", "length": 30}, "holidays": [], "today": "2026-10-26"},
            "input_version": 5,
        }
    )
    assert req.context.today.isoformat() == "2026-10-26"
    adapter = TypeAdapter(TranslateResponse)
    ok = adapter.validate_python({"status": "ok", "input_version": 5, "constraints": [TEMPLATES[1]]})
    assert ok.constraints[0].type == "forbidden_sequence"
    assert adapter.validate_python({"status": "clarify", "input_version": 5, "question": "누구?"}).question == "누구?"
    assert adapter.validate_python({"status": "unsupported", "input_version": 5, "reason": "x"}).reason == "x"


def test_explain_request_wraps_schedule_request():
    req = ExplainRequest.model_validate(
        {"request": request(TEMPLATES), "conflicts": [{"constraint_id": "c8", "type": "leave", "source_text": "휴가"}]}
    )
    assert req.request.input_version == 0


def test_error_body():
    body = ErrorBody.model_validate({"error": {"code": "VALIDATION_ERROR", "message": "m", "request_id": "r1"}})
    assert body.error.code == "VALIDATION_ERROR"
