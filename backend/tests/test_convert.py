"""템플릿 → 블록 변환(설계 §2.5). 저장 이전과 eval 기대값 재작성이 같은 표를 쓴다."""

import json
from datetime import date
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from backend.domain import constants
from backend.domain.convert import convert_request, legacy_to_block, night_dedicated_rule
from backend.domain.legacy import LegacyScheduleRequest, LegacySpec
from backend.domain.models import ConstraintSpec, Period, ScheduleRequest

CASES = json.loads((Path(__file__).parent / "golden" / "cases.json").read_text(encoding="utf-8"))
spec_adapter = TypeAdapter(ConstraintSpec)
legacy_adapter = TypeAdapter(LegacySpec)
PERIOD = Period(start_date=date(2026, 11, 1), length=14)  # 11/1 일요일: 주말 1, 7, 8, 14


def tpl(type_: str, params: dict, **extra) -> object:
    raw = {"id": "c1", "type": type_, "scope": "ward", "source_text": "원문", "params": params, **extra}
    return legacy_adapter.validate_python(raw)


def dump(spec) -> dict:
    return spec_adapter.dump_python(spec, mode="json")


def params(spec) -> dict:
    """기본값을 뺀 params(비교용)."""
    return spec.params.model_dump(mode="json", exclude_defaults=True)


def test_daily_coverage():
    b = legacy_to_block(tpl("daily_coverage", {"shift": "D", "day_kind": "weekend", "min": 3, "max": 4}))
    assert b.type == "count"
    assert params(b) == {"days": {"kind": "weekend"}, "shifts": {"in": ["D"]}, "per": "day", "min": 3, "max": 4}


def test_forbidden_sequence():
    b = legacy_to_block(tpl("forbidden_sequence", {"first": "N", "second": "D"}))
    assert b.type == "sequence"
    assert params(b) == {"forbid": [[{"in": ["N"]}, {"in": ["D"]}]]}


def test_max_consecutive_work():
    b = legacy_to_block(tpl("max_consecutive_work", {"days": 5}))
    assert params(b) == {"run": {"not_in": ["O"]}, "max_len": 5}


def test_max_consecutive_nights():
    b = legacy_to_block(tpl("max_consecutive_nights", {"days": 3}))
    assert params(b) == {"run": {"in": ["N"]}, "max_len": 3}


def test_min_days_off():
    b = legacy_to_block(tpl("min_days_off", {"days": 8}))
    assert b.type == "count"
    assert params(b) == {"shifts": {"in": ["O"]}, "per": "person", "min": 8}


def test_off_after_night_block():
    b = legacy_to_block(tpl("off_after_night_block", {"days": 2}))
    assert params(b) == {"after": {"in": ["N"]}, "then_off": 2}


def test_skill_mix():
    b = legacy_to_block(tpl("skill_mix", {"shift": "N", "min_years": 3, "min_count": 1}))
    assert params(b) == {"people": {"min_years": 3}, "shifts": {"in": ["N"]}, "per": "day", "min": 1}


def test_leave_is_hard():
    b = legacy_to_block(tpl("leave", {"nurse_id": "n01", "days": [3, 4]}, scope="period"))
    assert (b.type, b.hardness, b.scope) == ("count", "hard", "period")
    assert params(b) == {
        "people": {"ids": ["n01"]},
        "days": {"days": [3, 4]},
        "shifts": {"not_in": ["O"]},
        "per": "person",
        "max": 0,
    }


def test_fixed_assignment_unchanged():
    spec = tpl("fixed_assignment", {"nurse_id": "n01", "day": 2, "shift": "E"})
    assert legacy_to_block(spec) == spec


@pytest.mark.parametrize(
    ("p", "expected_days", "expected_min"),
    [
        ({"days": None, "weekends_only": False}, {}, 14),
        ({"days": None, "weekends_only": True}, {"kind": "weekend"}, 5),  # 1, 3(공휴일), 7, 8, 14
        ({"days": [2, 3, 7], "weekends_only": False}, {"days": [2, 3, 7]}, 3),
        ({"days": [2, 3, 7], "weekends_only": True}, {"kind": "weekend", "days": [2, 3, 7]}, 2),
    ],
    ids=["all", "weekends", "days", "days+weekends"],
)
def test_shift_preference_prefer(p, expected_days, expected_min):
    spec = tpl("shift_preference", {"nurse_id": "n02", "shift": "O", "prefer": True, **p}, scope="period")
    b = legacy_to_block(spec, PERIOD, [3])
    assert (b.type, b.hardness) == ("count", "soft")
    expected = {"people": {"ids": ["n02"]}, "shifts": {"in": ["O"]}, "per": "person", "min": expected_min}
    if expected_days:
        expected["days"] = expected_days
    assert params(b) == expected


def test_shift_preference_avoid():
    spec = tpl("shift_preference", {"nurse_id": "n02", "shift": "N", "prefer": False, "weekends_only": True})
    b = legacy_to_block(spec)
    assert params(b) == {
        "people": {"ids": ["n02"]},
        "days": {"kind": "weekend"},
        "shifts": {"in": ["N"]},
        "per": "person",
        "max": 0,
    }


def test_shift_preference_prefer_needs_period():
    spec = tpl("shift_preference", {"nurse_id": "n02", "shift": "O", "prefer": True})
    with pytest.raises(ValueError):
        legacy_to_block(spec)


def test_night_fairness():
    b = legacy_to_block(tpl("night_fairness", {}, hardness="soft", weight=5))
    assert (b.type, b.hardness, b.priority) == ("balance", "soft", "low")
    assert params(b) == {"people": {"exclude_tags": ["나이트전담"]}, "shifts": {"in": ["N"]}}


def test_weekend_fairness():
    b = legacy_to_block(tpl("weekend_fairness", {}, hardness="soft", weight=5))
    assert (b.type, b.priority) == ("balance", "low")
    assert params(b) == {"days": {"kind": "weekend"}, "shifts": {"not_in": ["O"]}}


def test_common_fields_kept():
    spec = tpl("min_days_off", {"days": 4}, id="keep", scope="period", source_text="쉬게", enabled=False)
    b = legacy_to_block(spec)
    assert (b.id, b.scope, b.source_text, b.enabled) == ("keep", "period", "쉬게", False)


@pytest.mark.parametrize("hardness", ["hard", "soft"])
def test_hardness_kept(hardness):
    b = legacy_to_block(tpl("max_consecutive_work", {"days": 5}, hardness=hardness))
    assert b.hardness == hardness
    b = legacy_to_block(tpl("weekend_fairness", {}, hardness=hardness))
    assert b.hardness == hardness


@pytest.mark.parametrize(
    ("weight", "priority"), [(10, "normal"), (5, "low"), (30, "high"), (1, "low"), (8, "normal"), (25, "high")]
)
def test_soft_weight_to_priority(weight, priority):
    b = legacy_to_block(tpl("min_days_off", {"days": 4}, hardness="soft", weight=weight))
    assert b.priority == priority
    assert b.weight == constants.PRIORITY_WEIGHTS[priority]


def test_night_dedicated_rule():
    r = night_dedicated_rule("night-only")
    assert (r.id, r.type, r.hardness, r.scope) == ("night-only", "count", "hard", "ward")
    assert r.source_text == "나이트 전담은 나이트와 휴무만"
    assert params(r) == {
        "people": {"tags": ["나이트전담"]},
        "shifts": {"not_in": ["N", "O"]},
        "per": "person",
        "max": 0,
    }


def test_convert_request_tags_night_only():
    raw = CASES[0]["request"]
    req = LegacyScheduleRequest.model_validate(raw)
    assert req.history_load
    out = convert_request(req)
    tagged = {n.id for n in out.nurses if "나이트전담" in n.tags}
    assert tagged and tagged == {n.id for n in req.nurses if n.night_only}
    assert sum(c.type == "count" and c.params.people.tags == ["나이트전담"] for c in out.constraints) == 1
    assert out.history is None  # history_load(요약)는 원본으로 되돌릴 수 없어 버린다
    assert "night_only" not in out.nurses[0].model_dump() and "history_load" not in out.model_dump()
    assert req.nurses[0].tags == []  # 원본은 바꾸지 않는다


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_golden_requests_convert_to_valid_blocks(case):
    req = LegacyScheduleRequest.model_validate(case["request"])
    out = convert_request(req)
    assert {c.type for c in out.constraints} <= {"count", "sequence", "balance", "fixed_assignment"}
    assert len(out.constraints) == len(req.constraints) + 1
    revalidated = ScheduleRequest.model_validate(out.model_dump(mode="json"))
    assert revalidated == out
