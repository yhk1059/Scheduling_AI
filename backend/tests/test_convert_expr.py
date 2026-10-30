"""블록 → 식 변환(설계 §2.5). 저장 이전(TS)과 골든 동등성이 같은 표를 쓴다."""

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from backend.domain.convert import NIGHT_ONLY_RULE_ID, block_to_rules, night_dedicated_rule, rules_request
from backend.domain.models import ConstraintSpec, Rule, ScheduleRequest

GOLDEN = Path(__file__).parent / "golden"
BLOCK_CASES = json.loads((GOLDEN / "blocks-cases.json").read_text(encoding="utf-8"))
EXPR_CASES = json.loads((GOLDEN / "expr-convert-cases.json").read_text(encoding="utf-8"))
spec_adapter = TypeAdapter(ConstraintSpec)


def blk(type_: str, params: dict, cid: str = "b1", **extra) -> object:
    raw = {"id": cid, "type": type_, "scope": "ward", "source_text": "원문", "params": params, **extra}
    return spec_adapter.validate_python(raw)


def body(r: Rule) -> dict:
    return r.body.model_dump(mode="json", exclude_none=True, exclude_defaults=True)


def values(r: Rule) -> dict:
    return {k: v.value for k, v in r.values.items()}


def one(block) -> Rule:
    (r,) = block_to_rules(block)
    return r


def ref(name: str) -> dict:
    return {"value": name}


# --- 세기 ---


def test_count_day_min_max():
    r = one(blk("count", {"days": {"kind": "weekday"}, "shifts": {"in": ["D"]}, "per": "day", "min": 3, "max": 4}))
    assert body(r) == {
        "kind": "require",
        "for_each": {"per": "day", "days": {"kind": "weekday"}},
        "then": {"all": [
            {"left": {"shifts": {"in": ["D"]}}, "op": "ge", "right": ref("min")},
            {"left": {"shifts": {"in": ["D"]}}, "op": "le", "right": ref("max")},
        ]},
    }
    assert values(r) == {"min": 3, "max": 4}
    assert all(v.label for v in r.values.values())


def test_count_day_equal_is_eq():
    r = one(blk("count", {"shifts": {"in": ["N"]}, "per": "day", "min": 2, "max": 2}))
    assert body(r)["then"] == {"left": {"shifts": {"in": ["N"]}}, "op": "eq", "right": ref("min")}
    assert values(r) == {"min": 2}


def test_count_day_people_become_who():
    r = one(blk("count", {"people": {"min_years": 3}, "shifts": {"in": ["E"]}, "per": "day", "min": 1}))
    assert body(r)["for_each"] == {"per": "day"}
    assert body(r)["then"] == {"left": {"who": {"min_years": 3}, "shifts": {"in": ["E"]}}, "op": "ge", "right": ref("min")}


def test_count_person_people_and_days_in_for_each():
    r = one(blk("count", {"people": {"ids": ["n01"]}, "days": {"days": [3, 4]}, "shifts": {"not_in": ["O"]},
                          "per": "person", "max": 0}, scope="period"))
    assert body(r) == {
        "kind": "require",
        "for_each": {"per": "person", "people": {"ids": ["n01"]}, "days": {"days": [3, 4]}},
        "then": {"left": {"shifts": {"not_in": ["O"]}}, "op": "le", "right": ref("max")},
    }
    assert values(r) == {"max": 0}
    assert (r.scope, r.hardness) == ("period", "hard")


def test_count_person_week_hours():
    r = one(blk("count", {"shifts": {"not_in": ["O"]}, "per": "person_week", "measure": "hours", "max": 52}))
    assert body(r)["for_each"] == {"per": "person_week"}
    assert body(r)["then"] == {"left": {"shifts": {"not_in": ["O"]}, "measure": "hours"}, "op": "le", "right": ref("max")}


def test_count_person_window():
    r = one(blk("count", {"shifts": {"in": ["O"]}, "per": "person_window", "window": 7, "min": 1}))
    assert body(r)["for_each"] == {"per": "person_window", "window": 7}
    assert body(r)["then"]["op"] == "ge"


# --- 순서 ---


def test_forbid_single():
    r = one(blk("sequence", {"forbid": [[{"in": ["N"]}, {"in": ["D"]}]]}))
    assert r.id == "b1"
    assert body(r) == {
        "kind": "require",
        "for_each": {"per": "person_day"},
        "then": {"any": [
            {"left": {"offset": [0, 0], "shifts": {"in": ["N"]}}, "op": "eq", "right": 0},
            {"left": {"offset": [1, 1], "shifts": {"in": ["D"]}}, "op": "eq", "right": 0},
        ]},
    }
    assert r.values == {}


def test_forbid_three_long():
    r = one(blk("sequence", {"forbid": [[{"in": ["N"]}, {"in": ["O"]}, {"in": ["D"]}]]}))
    assert [c["left"]["offset"] for c in body(r)["then"]["any"]] == [[0, 0], [1, 1], [2, 2]]


def test_forbid_many_split():
    rules = block_to_rules(blk("sequence", {"people": {"tags": ["신규"]},
                                            "forbid": [[{"in": ["N"]}, {"in": ["D"]}], [{"in": ["N"]}, {"in": ["E"]}]]},
                               hardness="soft", priority="high", enabled=False))
    assert [r.id for r in rules] == ["b1", "b1-2"]
    assert [body(r)["then"]["any"][1]["left"]["shifts"] for r in rules] == [{"in": ["D"]}, {"in": ["E"]}]
    for r in rules:
        assert body(r)["for_each"] == {"per": "person_day", "people": {"tags": ["신규"]}}
        assert (r.hardness, r.priority, r.enabled, r.source_text) == ("soft", "high", False, "원문")


def test_run_max_len():
    r = one(blk("sequence", {"run": {"in": ["N"]}, "max_len": 3}))
    assert body(r) == {
        "kind": "require",
        "for_each": {"per": "person_window", "window": 4},
        "then": {"left": {"shifts": {"in": ["N"]}}, "op": "le", "right": ref("max_len")},
    }
    assert values(r) == {"max_len": 3}
    assert r.values["max_len"].label == "최대 연속 나이트"


def test_run_max_len_work_label():
    r = one(blk("sequence", {"run": {"not_in": ["O"]}, "max_len": 5}))
    assert r.values["max_len"].label == "최대 연속 근무"


def test_run_min_len():
    r = one(blk("sequence", {"run": {"in": ["N"]}, "min_len": 2}))
    assert body(r) == {
        "kind": "require",
        "for_each": {"per": "person_day"},
        "when": {"all": [
            {"left": {"offset": [-1, -1], "shifts": {"not_in": ["N"]}}, "op": "ge", "right": 1},
            {"left": {"offset": [0, 0], "shifts": {"in": ["N"]}}, "op": "ge", "right": 1},
        ]},
        "then": {"left": {"offset": [1, 1], "shifts": {"not_in": ["N"]}}, "op": "eq", "right": 0},
    }
    assert r.values == {}  # 길이는 offset 구조에 들어간다


def test_run_min_and_max_split():
    rules = block_to_rules(blk("sequence", {"run": {"in": ["N"]}, "min_len": 2, "max_len": 3}))
    assert [r.id for r in rules] == ["b1", "b1-2"]
    assert body(rules[0])["for_each"]["per"] == "person_window"
    assert body(rules[1])["when"]


def test_run_min_len_one_is_dropped():
    rules = block_to_rules(blk("sequence", {"run": {"in": ["N"]}, "min_len": 1, "max_len": 3}))
    assert [r.id for r in rules] == ["b1"]
    with pytest.raises(ValueError):
        block_to_rules(blk("sequence", {"run": {"in": ["N"]}, "min_len": 1}))


def test_after_then_off():
    r = one(blk("sequence", {"after": {"in": ["N"]}, "then_off": 2}))
    assert body(r) == {
        "kind": "require",
        "for_each": {"per": "person_day"},
        "when": {"all": [
            {"left": {"offset": [0, 0], "shifts": {"in": ["N"]}}, "op": "ge", "right": 1},
            {"left": {"offset": [1, 1], "shifts": {"not_in": ["N"]}}, "op": "ge", "right": 1},
        ]},
        "then": {"left": {"offset": [1, 2], "shifts": {"not_in": ["O"]}}, "op": "eq", "right": 0},
    }


# --- 고르게, 칸 고정 ---


def test_balance():
    r = one(blk("balance", {"days": {"kind": "weekend"}, "shifts": {"not_in": ["O"]}, "max_gap": 2}, hardness="hard"))
    assert body(r) == {"kind": "balance", "days": {"kind": "weekend"}, "shifts": {"not_in": ["O"]}, "max_gap": ref("max_gap")}
    assert values(r) == {"max_gap": 2}
    assert (r.hardness, r.priority) == ("hard", "low")


def test_balance_soft_keeps_priority():
    r = one(blk("balance", {"shifts": {"in": ["N"]}, "with_history": False}, hardness="soft", priority="high"))
    assert (r.hardness, r.priority, r.body.with_history) == ("soft", "high", False)


def test_fixed_assignment_unchanged():
    f = blk("fixed_assignment", {"nurse_id": "n01", "day": 2, "shift": "E"}, scope="period")
    assert block_to_rules(f) == [f]


def test_rule_unchanged():
    r = one(blk("count", {"shifts": {"in": ["D"]}, "per": "day", "min": 3}))
    assert block_to_rules(r) == [r]


# --- 기본 규칙 ---


def test_default_rules():
    cov = one(blk("count", {"shifts": {"in": ["D"]}, "per": "day", "min": 3}, cid="cov-D-weekday"))
    assert cov.default is True
    night = one(night_dedicated_rule(NIGHT_ONLY_RULE_ID))
    assert night.default is True
    assert body(night)["for_each"] == {"per": "person", "people": {"tags": ["나이트전담"]}}
    other = one(blk("count", {"shifts": {"in": ["O"]}, "per": "person", "min": 8}, cid="min-off"))
    assert other.default is False


# --- 요청 ---


@pytest.mark.parametrize("case", BLOCK_CASES, ids=[c["id"] for c in BLOCK_CASES])
def test_rules_request_validates(case):
    req = ScheduleRequest.model_validate(case["request"])
    out = rules_request(req)
    assert {c.type for c in out.constraints} <= {"rule", "fixed_assignment"}
    assert ScheduleRequest.model_validate(out.model_dump(mode="json")) == out
    ids = {c.id for c in out.constraints}
    assert {c.id for c in req.constraints} <= ids
    defaults = {c.id for c in out.constraints if c.type == "rule" and c.default}
    assert defaults == {i for i in ids if i.startswith("cov-") or i == NIGHT_ONLY_RULE_ID}
    assert out.nurses == req.nurses and out.period == req.period


# --- 공유 픽스처 ---


def test_fixture_matches_converter():
    assert len(EXPR_CASES) >= 20
    names = [c["name"] for c in EXPR_CASES]
    assert len(names) == len(set(names))
    for case in EXPR_CASES:
        rules = block_to_rules(spec_adapter.validate_python(case["block"]))
        assert [spec_adapter.dump_python(r, mode="json", exclude_none=True) for r in rules] == case["rules"], case["name"]
