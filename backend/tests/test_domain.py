"""도메인 모델: 블록 3종·칸 고정 직렬화, hardness·중요도 기본값, params 검증, 참조 무결성, 샘플."""

import json
from datetime import date
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.domain import constants
from backend.domain.convert import convert_request
from backend.domain.legacy import LegacyScheduleRequest
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
from backend.tests import blocks

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "lib" / "samples" / "ward-15.json"
spec_adapter = TypeAdapter(ConstraintSpec)

# 템플릿 12종이 바뀐 블록 모양(설계 §2.5)
BLOCKS = [
    blocks.coverage("D", "weekday", 3, 4),
    blocks.forbid("c2", "N", "D"),
    blocks.max_work("c3", 5),
    blocks.max_nights("c4", 3),
    blocks.min_off("c5", 8),
    blocks.off_after_night("c6", 1),
    blocks.skill_mix("c7", "N", 3, 1),
    blocks.leave("c8", "n01", [15, 16, 17]),
    blocks.fixed("c9", "n02", 3, "E"),
    blocks.pref("c10", "n03", "O", 9, weekends_only=True),
    blocks.night_fair("c11"),
    blocks.weekend_fair("c12"),
]


def nurses(n: int = 3) -> list[dict]:
    return [{"id": f"n{i:02d}", "name": f"간호사{i}", "years": i, "tags": []} for i in range(1, n + 1)]


def request(constraints: list[dict], **extra) -> dict:
    return {
        "nurses": nurses(),
        "period": {"start_date": "2026-11-01", "length": 30},
        "holidays": [],
        "constraints": constraints,
        "input_version": 0,
        **extra,
    }


# --- 제약 ---


def test_constraint_types_are_blocks_and_fixed():
    assert {b["type"] for b in BLOCKS} == {"count", "sequence", "balance", "fixed_assignment"}


@pytest.mark.parametrize("raw", BLOCKS, ids=[b["id"] for b in BLOCKS])
def test_constraint_roundtrip(raw):
    spec = spec_adapter.validate_python(raw)
    assert spec.type == raw["type"]
    dumped = spec_adapter.dump_python(spec, mode="json")
    assert spec_adapter.validate_json(json.dumps(dumped)) == spec
    assert isinstance(dumped["params"], dict)
    assert dumped["enabled"] is True


def test_fixed_assignment_is_always_hard():
    raw = next(b for b in BLOCKS if b["type"] == "fixed_assignment")
    assert spec_adapter.validate_python({**raw, "hardness": "soft"}).hardness == "hard"


def test_default_hardness_and_weight_per_type():
    for raw in BLOCKS:
        without = {k: v for k, v in raw.items() if k not in ("hardness", "priority", "weight")}
        spec = spec_adapter.validate_python(without)
        assert spec.hardness == ("soft" if raw["type"] == "balance" else "hard")
        low = raw["type"] == "balance"
        assert spec.weight == constants.PRIORITY_WEIGHTS["low" if low else "normal"]


@pytest.mark.parametrize("type_", ["daily_coverage", "leave", "shift_preference", "night_fairness", "unknown"])
def test_template_types_rejected(type_):
    with pytest.raises(ValidationError):
        spec_adapter.validate_python(blocks.con("x", type_, {}))


@pytest.mark.parametrize(
    "raw",
    [
        blocks.coverage("D", "weekday", 5, 4),
        blocks.max_work("x", 0),
        blocks.min_off("x", -1),
        blocks.off_after_night("x", 0),
        blocks.con("x", "count", {"shifts": {"in": ["D"]}, "per": "day"}),
        {**blocks.max_work("x", 5), "weight": 0},
        blocks.con("x", "sequence", {"run": {"not_in": ["O"]}, "max_len": 5, "extra": 1}),
        {**blocks.night_fair("x"), "scope": "year"},
        {**blocks.night_fair("x"), "priority": "urgent"},
    ],
    ids=["min>max", "run-0", "min-negative", "then-off-0", "no-bound", "weight-0", "extra-param", "bad-scope", "bad-priority"],
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


def test_schedule_request_accepts_all_blocks():
    req = ScheduleRequest.model_validate(request(BLOCKS))
    assert len(req.constraints) == 12
    assert req.carry_over == []
    assert req.previous is None
    assert req.history is None


def test_unknown_nurse_id_reports_constraint_id():
    bad = blocks.leave("bad-leave", "n99", [1])
    with pytest.raises(ValidationError, match="bad-leave"):
        ScheduleRequest.model_validate(request([bad]))


@pytest.mark.parametrize(
    "raw",
    [
        blocks.leave("bad-day", "n01", [31]),
        blocks.fixed("bad-day", "n01", 0, "D"),
        blocks.pref("bad-day", "n01", "N", None, [40]),
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
    dup_id = nurses() + [{"id": "n01", "name": "다른이름", "years": 1}]
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "nurses": dup_id})
    dup_name = nurses() + [{"id": "n09", "name": "간호사1", "years": 1}]
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "nurses": dup_name})


def test_duplicate_constraint_ids_rejected():
    raw = blocks.night_fair("same")
    with pytest.raises(ValidationError, match="same"):
        ScheduleRequest.model_validate(request([raw, raw]))


def test_negative_years_rejected():
    bad = nurses()
    bad[0]["years"] = -1
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate({**request([]), "nurses": bad})


# --- 샘플 ---


def test_sample_ward_is_old_format_and_converts():
    raw = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    next_requests = raw.pop("next_requests")
    assert next_requests
    with pytest.raises(ValidationError):  # 샘플 파일은 아직 옛 형식(night_only, 템플릿)이다(step 10에서 바꾼다)
        ScheduleRequest.model_validate(raw)
    req = convert_request(LegacyScheduleRequest.model_validate(raw))
    assert req.input_version == 0
    assert req.period == Period(start_date=date(2026, 11, 1), length=30)
    assert req.holidays == []
    assert len(req.nurses) == 15
    assert sum("나이트전담" in n.tags for n in req.nurses) == 2
    names = {n.name for n in req.nurses}
    assert {"이영희", "박민수", "김철수", "정유진", "최지훈"} <= names
    years = [n.years for n in req.nurses]
    assert min(years) >= 1 and max(years) <= 15 and len(set(years)) >= 8
    coverage = [c for c in req.constraints if c.id.startswith("cov-")]
    assert coverage and all(c.type == "count" and c.scope == "ward" and c.hardness == "hard" for c in coverage)
    kinds = {(c.params.shifts.in_[0], c.params.days.kind) for c in coverage}
    assert kinds == {(s, k) for s in "DEN" for k in ("weekday", "weekend")}


# --- 응답/요청 모델 ---


def test_solve_response_discriminates_by_status():
    adapter = TypeAdapter(SolveResponse)
    assert type(adapter.validate_python({"status": "timeout", "input_version": 3})).__name__ == "SolveTimeout"
    infeasible = adapter.validate_python(
        {
            "status": "infeasible",
            "input_version": 1,
            "conflicts": [{"constraint_id": "c1", "type": "count", "source_text": "휴가"}],
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
        "assignments": {"n01": ["D", "O"]},
        "summary": {"preferences_total": 1, "preferences_met": 1, "soft_violation_count": 0},
        "stats": {"n01": stats},
        "soft_violations": [],
        "diff": None,
        "optimal": True,
    }
    ok = adapter.validate_python({"status": "ok", "input_version": 2, "result": result})
    assert ok.result.optimal is True
    assert ok.result.stats["n01"].counts["D"] == 1
    old = {**result, "stats": {"n01": {**stats, "D": 1, "E": 0, "N": 0, "O": 1}}}
    with pytest.raises(ValidationError):  # D/E/N/O 필드는 counts로 바뀌었다
        adapter.validate_python({"status": "ok", "input_version": 2, "result": old})


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
    ok = adapter.validate_python({"status": "ok", "input_version": 5, "constraints": [BLOCKS[1]]})
    assert ok.constraints[0].type == "sequence"
    assert adapter.validate_python({"status": "clarify", "input_version": 5, "question": "누구?"}).question == "누구?"
    assert adapter.validate_python({"status": "unsupported", "input_version": 5, "reason": "x"}).reason == "x"


def test_explain_request_wraps_schedule_request():
    req = ExplainRequest.model_validate(
        {"request": request(BLOCKS), "conflicts": [{"constraint_id": "c8", "type": "count", "source_text": "휴가"}]}
    )
    assert req.request.input_version == 0


def test_error_body():
    body = ErrorBody.model_validate({"error": {"code": "VALIDATION_ERROR", "message": "m", "request_id": "r1"}})
    assert body.error.code == "VALIDATION_ERROR"


# --- history(최근 28일 원본) ---


def test_history_load_rejected():
    load = [{"nurse_id": "n01", "nights": 8, "weekends": 3}]
    with pytest.raises(ValidationError):  # 두 숫자 요약은 원본 history로 바뀌었다
        ScheduleRequest.model_validate(request([], history_load=load))


def test_history_accepted():
    history = blocks.history("2026-11-01", {"n01": ["N"] * 8})
    req = ScheduleRequest.model_validate(request([], history=history))
    assert req.history.rows["n01"].count("N") == 8
    assert req.history.start_date == date(2026, 10, 4)


def test_history_unknown_nurse_or_code_rejected():
    with pytest.raises(ValidationError, match="n99"):
        ScheduleRequest.model_validate(request([], history=blocks.history("2026-11-01", {"n99": ["N"]})))
    with pytest.raises(ValidationError, match="M"):
        ScheduleRequest.model_validate(request([], history=blocks.history("2026-11-01", {"n01": ["M"]})))


def test_history_longer_than_limit_rejected():
    history = {"start_date": "2026-10-01", "rows": {"n01": ["O"] * (constants.HISTORY_DAYS + 1)}, "holidays": []}
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request([], history=history))
