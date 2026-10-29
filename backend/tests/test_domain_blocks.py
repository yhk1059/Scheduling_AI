"""도메인 모델(ADR-018): 병동 구조, 태그, 셀렉터, 블록 3종, history, config 기준 참조 무결성."""

import json

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.domain import constants
from backend.domain.models import (
    DEFAULT_CONFIG,
    ConstraintSpec,
    Nurse,
    ScheduleRequest,
    Shifts,
    TranslateContext,
    WardConfig,
    covers,
)

spec_adapter = TypeAdapter(ConstraintSpec)


def nurses(n: int = 3) -> list[dict]:
    return [{"id": f"n{i:02d}", "name": f"간호사{i}", "years": i} for i in range(1, n + 1)]


def request(constraints: list[dict] | None = None, **extra) -> dict:
    return {
        "nurses": nurses(),
        "period": {"start_date": "2026-11-01", "length": 30},
        "holidays": [],
        "constraints": constraints or [],
        "input_version": 0,
        **extra,
    }


def shift(code: str, name: str = "근무", hours: float = 8, **extra) -> dict:
    return {"code": code, "name": name, "hours": hours, **extra}


def config(*extra: dict) -> dict:
    base = [shift("D", "데이"), shift("E", "이브닝"), shift("N", "나이트"), shift("O", "휴무", 0)]
    return {"shifts": base + list(extra)}


def block(cid: str, type_: str, params: dict, **extra) -> dict:
    return {"id": cid, "type": type_, "scope": "ward", "source_text": "원문", "params": params, **extra}


COUNT = block("b1", "count", {"shifts": {"in": ["D"]}, "per": "day", "min": 3, "max": 4})
SEQ = block("b2", "sequence", {"run": {"in": ["N"]}, "max_len": 3})
BAL = block("b3", "balance", {"shifts": {"in": ["N"]}})


# --- WardConfig ---


def test_default_config_is_den_o():
    codes = [(s.code, s.name, s.hours, s.parts) for s in DEFAULT_CONFIG.shifts]
    assert codes == [("D", "데이", 8, []), ("E", "이브닝", 8, []), ("N", "나이트", 8, []), ("O", "휴무", 0, [])]
    assert WardConfig.model_validate(config()) == DEFAULT_CONFIG


def test_config_accepts_composite_and_new_code():
    cfg = WardConfig.model_validate(config(shift("M", "미드", start="11:00"), shift("DE", "더블", 16, parts=["D", "E"])))
    assert covers(cfg, "DE") == {"DE", "D", "E"}
    assert covers(cfg, "M") == {"M"}
    assert covers(DEFAULT_CONFIG, "O") == {"O"}


@pytest.mark.parametrize(
    "raw",
    [
        config(shift("m", "소문자")),
        config(shift("ABCD", "네 글자")),
        config(shift("D", "중복")),
        {"shifts": [shift("D"), shift("E"), shift("N")]},
        {"shifts": [shift("D"), shift("O", "휴무", 8)]},
        config(shift("DE", "더블", 16, parts=["D", "X"])),
        config(shift("DO", "휴무 더블", 8, parts=["D", "O"])),
        config(shift("DE", "더블", 16, parts=["D", "E"]), shift("DEN", "삼중", 24, parts=["DE", "N"])),
        config(shift("M", "미드", 0)),
        config(shift("M", "미드", 25)),
        config(shift("M", "미드", 7.3)),
        config(*[shift(f"X{i}") for i in range(constants.MAX_SHIFT_CODES - 3)]),
    ],
    ids=[
        "lowercase",
        "too-long",
        "duplicate",
        "no-O",
        "O-hours",
        "unknown-part",
        "O-part",
        "composite-part",
        "zero-hours",
        "over-24h",
        "half-hour-step",
        "too-many",
    ],
)
def test_invalid_config_rejected(raw):
    with pytest.raises(ValidationError):
        WardConfig.model_validate(raw)


def test_config_at_code_limit_accepted():
    extra = [shift(f"X{i}") for i in range(constants.MAX_SHIFT_CODES - 4)]
    assert len(WardConfig.model_validate(config(*extra)).shifts) == constants.MAX_SHIFT_CODES


def test_inactive_code_cannot_be_part():
    with pytest.raises(ValidationError):
        WardConfig.model_validate(config(shift("M", "미드", active=False), shift("DM", "더블", 16, parts=["D", "M"])))


# --- Nurse.tags ---


def test_nurse_tags_default_and_limits():
    assert Nurse.model_validate(nurses(1)[0]).tags == []
    n = Nurse.model_validate({**nurses(1)[0], "tags": ["책임", "나이트전담"]})
    assert n.tags == ["책임", "나이트전담"] and n.night_only is False
    for bad in (["x" * 11], [""], [f"t{i}" for i in range(constants.MAX_TAGS_PER_NURSE + 1)]):
        with pytest.raises(ValidationError):
            Nurse.model_validate({**nurses(1)[0], "tags": bad})


# --- config가 요청에 들어감 ---


def test_request_and_translate_context_default_config():
    assert ScheduleRequest.model_validate(request()).config == DEFAULT_CONFIG
    ctx = TranslateContext.model_validate(
        {"nurses": nurses(), "period": {"start_date": "2026-11-01", "length": 30}, "today": "2026-10-29"}
    )
    assert ctx.config == DEFAULT_CONFIG


def test_codes_checked_against_config():
    with pytest.raises(ValidationError, match="carry_over"):
        ScheduleRequest.model_validate(request(carry_over=[{"nurse_id": "n01", "shifts": ["M"]}]))
    with_m = request(config=config(shift("M", "미드")), carry_over=[{"nurse_id": "n01", "shifts": ["M"]}])
    assert ScheduleRequest.model_validate(with_m).carry_over[0].shifts == ["M"]


def test_previous_codes_checked_against_config():
    prev = {n["id"]: ["O"] * 30 for n in nurses()}
    prev["n01"] = ["M"] + ["O"] * 29
    with pytest.raises(ValidationError, match="previous"):
        ScheduleRequest.model_validate(request(previous=prev))
    assert ScheduleRequest.model_validate(request(previous=prev, config=config(shift("M", "미드")))).previous == prev


def test_fixed_assignment_code_checked_against_config():
    fixed = block("fx", "fixed_assignment", {"nurse_id": "n01", "day": 1, "shift": "M"})
    with pytest.raises(ValidationError, match="fx"):
        ScheduleRequest.model_validate(request([fixed]))
    assert ScheduleRequest.model_validate(request([fixed], config=config(shift("M", "미드"))))


def test_template_codes_checked_against_config():
    no_n = {"shifts": [shift("D"), shift("E"), shift("O", "휴무", 0)]}
    seq = block("tpl", "forbidden_sequence", {"first": "N", "second": "D"})
    with pytest.raises(ValidationError, match="tpl"):
        ScheduleRequest.model_validate(request([seq], config=no_n))


# --- 셀렉터 ---


def test_shifts_in_alias_roundtrip():
    s = Shifts.model_validate({"in": ["D", "E"]})
    assert s.in_ == ["D", "E"]
    assert s.model_dump() == {"in": ["D", "E"], "not_in": None}
    assert Shifts.model_validate(s.model_dump()) == s


@pytest.mark.parametrize("raw", [{}, {"in": ["D"], "not_in": ["O"]}, {"in": []}, {"in": ["d"]}])
def test_shifts_requires_exactly_one(raw):
    with pytest.raises(ValidationError):
        Shifts.model_validate(raw)


# --- 블록 ---


@pytest.mark.parametrize("raw", [COUNT, SEQ, BAL], ids=["count", "sequence", "balance"])
def test_block_roundtrip(raw):
    spec = spec_adapter.validate_python(raw)
    dumped = spec_adapter.dump_python(spec, mode="json")
    assert spec_adapter.validate_json(json.dumps(dumped)) == spec
    assert dumped["enabled"] is True


def test_block_defaults():
    count, seq, bal = (spec_adapter.validate_python(r) for r in (COUNT, SEQ, BAL))
    assert (count.hardness, count.priority) == ("hard", "normal")
    assert (seq.hardness, seq.priority) == ("hard", "normal")
    assert (bal.hardness, bal.priority) == ("soft", "low")
    assert bal.weight == constants.PRIORITY_WEIGHTS["low"]
    assert bal.params.with_history is True and bal.params.max_gap == 1
    assert count.params.people.ids is None and count.params.days.kind == "all"
    assert count.params.measure == "count"


@pytest.mark.parametrize("priority", ["high", "normal", "low"])
def test_block_weight_follows_priority(priority):
    spec = spec_adapter.validate_python({**COUNT, "hardness": "soft", "priority": priority, "weight": 99})
    assert spec.weight == constants.PRIORITY_WEIGHTS[priority]


def test_priority_weights_constant():
    assert constants.PRIORITY_WEIGHTS == {"high": 30, "normal": 10, "low": 5}


def _count(**params) -> dict:
    return block("x", "count", {"shifts": {"in": ["D"]}, "per": "day", "min": 1, **params})


def _seq(**params) -> dict:
    return block("x", "sequence", params)


N, D, O = {"in": ["N"]}, {"in": ["D"]}, {"in": ["O"]}


@pytest.mark.parametrize(
    "raw",
    [
        _count(min=5, max=4),
        _count(min=None),
        _count(per="person_window"),
        _count(per="person_window", window=1),
        _count(per="person_window", window=15),
        _count(per="person", window=7),
        _count(min=-1),
        _count(people={"min_years": 5, "max_years": 3}),
        _count(days={"weekdays": [7]}),
        _count(days={"kind": "month"}),
        _seq(),
        _seq(forbid=[[N, D]], run=N, max_len=3),
        _seq(forbid=[[N]]),
        _seq(forbid=[[N, D, D, D, D]]),
        _seq(forbid=[[N, D]] * 5),
        _seq(run=N),
        _seq(run=N, min_len=4, max_len=3),
        _seq(after=N),
        _seq(after=N, then_off=0),
        _seq(run=N, max_len=3, then_off=1),
        block("x", "balance", {"shifts": N, "max_gap": -1}),
        block("x", "balance", {"shifts": N, "extra": 1}),
    ],
    ids=[
        "min>max",
        "no-min-max",
        "window-missing",
        "window-1",
        "window-15",
        "window-without-person_window",
        "negative-min",
        "years-reversed",
        "weekday-7",
        "bad-kind",
        "seq-empty",
        "seq-two-modes",
        "forbid-1",
        "forbid-5",
        "forbid-too-many",
        "run-no-len",
        "run-min>max",
        "after-no-off",
        "after-off-0",
        "then_off-with-run",
        "balance-gap-negative",
        "balance-extra",
    ],
)
def test_invalid_blocks_rejected(raw):
    with pytest.raises(ValidationError):
        spec_adapter.validate_python(raw)


def test_valid_block_shapes():
    for raw in (
        _count(per="person_window", window=7, min=None, max=6, measure="hours"),
        _count(per="person_week", max=52, min=None, measure="hours", days={"weekdays": [0, 1], "days": [1, 2]}),
        _seq(forbid=[[N, D], [N, {"in": ["E"]}]]),
        _seq(run={"not_in": ["O"]}, min_len=2),
        _seq(after=N, then_off=2, people={"tags": ["책임"], "exclude_tags": ["신규"]}),
    ):
        spec_adapter.validate_python(raw)


# --- 블록 참조 무결성 ---


def test_request_accepts_blocks():
    req = ScheduleRequest.model_validate(request([COUNT, SEQ, BAL]))
    assert [c.type for c in req.constraints] == ["count", "sequence", "balance"]


@pytest.mark.parametrize(
    "raw",
    [
        _count(people={"ids": ["n99"]}),
        _count(shifts={"in": ["M"]}),
        _count(days={"days": [31]}),
        _seq(forbid=[[N, {"not_in": ["M"]}]]),
        _seq(after={"in": ["M"]}, then_off=1),
        block("x", "balance", {"shifts": {"in": ["M"]}}),
    ],
    ids=["unknown-nurse", "unknown-code", "day-out-of-range", "forbid-code", "after-code", "balance-code"],
)
def test_block_reference_errors_report_constraint_id(raw):
    with pytest.raises(ValidationError, match="제약 x"):
        ScheduleRequest.model_validate(request([raw]))


def test_unknown_tag_passes():
    raw = _count(people={"tags": ["없는태그"]})
    assert ScheduleRequest.model_validate(request([raw]))


# --- history ---


def test_history_accepted_and_checked():
    hist = {"start_date": "2026-10-04", "rows": {"n01": ["N"] * 28}, "holidays": ["2026-10-09"]}
    req = ScheduleRequest.model_validate(request(history=hist))
    assert req.history.rows["n01"][0] == "N"
    assert ScheduleRequest.model_validate(request()).history is None
    with pytest.raises(ValidationError, match="history"):
        ScheduleRequest.model_validate(request(history={**hist, "rows": {"n99": ["N"]}}))
    with pytest.raises(ValidationError, match="history"):
        ScheduleRequest.model_validate(request(history={**hist, "rows": {"n01": ["M"]}}))
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request(history={**hist, "rows": {"n01": ["N"] * 29}}))
