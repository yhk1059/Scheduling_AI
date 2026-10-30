"""골든 케이스: cases.json은 블록화 전(ADR-018 이전), blocks-cases.json은 식 언어 전(ADR-019 이전) 솔버의 목적값·배정 기록.

요청은 옛 형식(legacy.py)이다. 옛 솔버는 없어졌으므로 식 규칙으로 바꿔 풀어 기록과 같은지 본다
(cases.json은 convert_request, blocks-cases.json은 block_to_rules). 기록 파일은 다시 만들지 않는다.
"""

import json
from pathlib import Path

import pytest

from pydantic import TypeAdapter, ValidationError

from backend.domain.convert import legacy_to_block
from backend.domain.legacy import BlockScheduleRequest, BlockSpec, LegacyScheduleRequest, LegacySpec
from backend.domain.models import Period, ScheduleRequest
from backend.gen_golden import (
    BLOCKS_CASES_PATH,
    CASES_PATH,
    CONVERT_CASES_PATH,
    block_case_request,
    build_convert_cases,
    case_request,
    check_block_case,
    render,
    solve_case,
)
from backend.solver.stats import violations

CASES = json.loads(Path(CASES_PATH).read_text(encoding="utf-8"))
FEASIBLE = [c for c in CASES if c["status"] == "ok"]
INFEASIBLE = [c for c in CASES if c["status"] == "infeasible"]
block_adapter = TypeAdapter(BlockSpec)
legacy_adapter = TypeAdapter(LegacySpec)


def _ids(cases):
    return [c["id"] for c in cases]


def _legacy(case) -> LegacyScheduleRequest:
    return LegacyScheduleRequest.model_validate(case["request"])


def test_cases_cover_templates_and_toggles():
    types = {(c["type"], c["hardness"]) for case in CASES for c in case["request"]["constraints"]}
    for t in (
        "daily_coverage",
        "forbidden_sequence",
        "max_consecutive_work",
        "max_consecutive_nights",
        "min_days_off",
        "off_after_night_block",
        "skill_mix",
    ):
        assert (t, "hard") in types and (t, "soft") in types, t
    for t in ("leave", "fixed_assignment", "shift_preference", "night_fairness", "weekend_fairness"):
        assert any(tt == t for tt, _ in types), t
    assert len(INFEASIBLE) >= 2
    assert any(c["request"].get("previous") for c in CASES)
    assert any(c["history_raw"] for c in CASES)


@pytest.mark.parametrize("case", CASES, ids=_ids(CASES))
def test_request_validates_as_legacy_only(case):
    _legacy(case)
    with pytest.raises(ValidationError):  # 옛 형식(night_only, history_load, 템플릿)은 새 요청이 받지 않는다
        ScheduleRequest.model_validate(case["request"])


# --- 템플릿 동등성: 템플릿을 convert_request로 식 규칙까지 바꿔 풀어도 같은 결과 ---


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_rules_objective_equal(case):
    req = case_request(case)
    assert {c.type for c in req.constraints} <= {"rule", "fixed_assignment"}
    out = solve_case(req)
    assert out["status"] == "ok" and out["optimal"]
    assert out["objective"] == case["objective"]


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_recorded_assignments_satisfy_hard_rules(case):
    req = case_request(case)
    hard = [c for c in req.constraints if c.enabled and c.hardness == "hard" and c.type != "fixed_assignment"]
    assert hard
    for c in hard:
        assert violations(req, case["assignments"], c) == [], c.id


@pytest.mark.parametrize("case", INFEASIBLE, ids=_ids(INFEASIBLE))
def test_rules_infeasible_stays_infeasible(case):
    assert solve_case(case_request(case), conflicts=False)["status"] == "infeasible"


def test_convert_cases_fixture_up_to_date():
    assert Path(CONVERT_CASES_PATH).read_text(encoding="utf-8") == render(build_convert_cases())


def test_convert_cases_cover_templates_toggles_and_night_only():
    cases = json.loads(Path(CONVERT_CASES_PATH).read_text(encoding="utf-8"))
    pairs = {(c["template"]["type"], c["template"]["hardness"]) for c in cases if c["template"]}
    for t in ("daily_coverage", "forbidden_sequence", "max_consecutive_work", "max_consecutive_nights",
              "min_days_off", "off_after_night_block", "skill_mix", "night_fairness", "weekend_fairness"):
        assert (t, "hard") in pairs and (t, "soft") in pairs, t
    assert {t for t, _ in pairs} >= {"leave", "fixed_assignment", "shift_preference"}
    assert any(c["template"] is None and c["block"]["id"] == "night-only" for c in cases)
    for c in cases:
        if c["template"]:
            got = legacy_to_block(legacy_adapter.validate_python(c["template"]), Period.model_validate(c["period"]),
                                  c["holidays"])
            assert block_adapter.dump_python(got, mode="json", exclude_none=True) == c["block"], c["name"]


# --- 블록 골든(blocks-cases.json): 블록 솔버의 목적값·배정 기록. 식 규칙으로 바꿔 같은 결과 ---

BLOCK_CASES = json.loads(Path(BLOCKS_CASES_PATH).read_text(encoding="utf-8"))
BLOCK_FEASIBLE = [c for c in BLOCK_CASES if c["expected"]["status"] == "ok"]
BLOCK_INFEASIBLE = [c for c in BLOCK_CASES if c["expected"]["status"] == "infeasible"]


def _req(case) -> ScheduleRequest:
    return block_case_request(case)[0]


def test_blocks_cases_requests_are_block_format():
    for case in BLOCK_CASES:
        with pytest.raises(ValidationError):  # 블록은 새 요청이 받지 않는다
            ScheduleRequest.model_validate(case["request"])
        assert {c.type for c in BlockScheduleRequest.model_validate(case["request"]).constraints} <= {
            "count", "sequence", "balance", "fixed_assignment"}


def test_blocks_cases_old_cases_match_templates():
    """옛 골든 9케이스의 블록 요청은 cases.json 템플릿을 블록으로 바꾼 것이다(규칙 id와 변환 결과)."""
    by_id = {c["id"]: c for c in BLOCK_CASES}
    for case in CASES:
        legacy = _legacy(case)
        blocks = BlockScheduleRequest.model_validate(by_id[case["id"]]["request"]).constraints
        templates = [legacy_to_block(c, legacy.period, legacy.holidays) for c in legacy.constraints]
        assert blocks[: len(templates)] == templates, case["id"]
        assert [c.id for c in blocks[len(templates):]] == ["night-only"]


def test_blocks_cases_cover_converted_and_features():
    ids = {c["id"] for c in BLOCK_CASES}
    assert {c["id"] for c in CASES} <= ids  # 옛 골든 9케이스를 블록으로 바꾼 요청
    features = [c for c in BLOCK_CASES if c["id"] not in {c["id"] for c in CASES}]
    assert len(features) >= 8
    rules = [r for c in features for r in c["request"]["constraints"]]
    codes = {s["code"] for c in features for s in c["request"]["config"]["shifts"]}
    assert {"M", "DE"} <= codes
    assert any(r["type"] == "count" and r["params"]["per"] == "person_week" and r["params"]["measure"] == "hours"
               for r in rules)
    assert any(r["type"] == "count" and r["params"]["per"] == "person_window" for r in rules)
    assert any(r["type"] == "sequence" and r["params"].get("min_len") for r in rules)
    assert any(r["type"] == "sequence" and r["params"].get("then_off") == 2 for r in rules)
    assert any(r["type"] == "count" and r["params"]["people"].get("tags") == ["책임"] for r in rules)
    assert any(r["type"] == "balance" and r["hardness"] == "hard" for r in rules)
    assert any(r["type"] == "count" and r["hardness"] == "soft" and r["scope"] == "period" for r in rules)
    assert any(r["type"] == "sequence" and r["hardness"] == "soft" and r["params"].get("forbid") for r in rules)
    assert all(c["expected"]["optimal"] for c in BLOCK_FEASIBLE)
    assert any(c["id"] not in {x["id"] for x in CASES} for c in BLOCK_INFEASIBLE)
    assert all(c["expected"]["conflict_ids"] for c in BLOCK_INFEASIBLE)


@pytest.mark.parametrize("case", BLOCK_CASES, ids=_ids(BLOCK_CASES))
def test_blocks_golden_rules_match_record(case):
    """gen:golden --check와 같은 비교: 해가 있으면 OPTIMAL·목적값, 없으면 충돌의 원 블록 id."""
    assert check_block_case(case) is None


@pytest.mark.parametrize("case", BLOCK_FEASIBLE, ids=_ids(BLOCK_FEASIBLE))
def test_blocks_golden_assignments_satisfy_hard(case):
    req = _req(case)
    hard = [c for c in req.constraints if c.enabled and c.hardness == "hard"]
    assert hard
    for c in hard:
        assert violations(req, case["expected"]["assignments"], c) == [], c.id
