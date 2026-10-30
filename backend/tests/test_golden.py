"""골든 케이스(backend/tests/golden/cases.json): 블록화 전 솔버의 목적값·배정 기록(ADR-018 이전 기준).

요청은 옛 형식(legacy.py)이다. 옛 솔버는 없어졌으므로 convert_request로 블록으로 바꿔 풀어 목적값이 같은지 본다.
blocks-cases.json은 블록 솔버의 기록이다(ADR-019 식 변환이 같은 결과를 내야 하는 기준).
"""

import json
from pathlib import Path

import pytest

from pydantic import TypeAdapter, ValidationError

from backend.domain.convert import legacy_to_block
from backend.domain.legacy import LegacyScheduleRequest, LegacySpec
from backend.domain.models import ConstraintSpec, Period, ScheduleRequest
from backend.gen_golden import (
    BLOCKS_CASES_PATH,
    CASES_PATH,
    CONVERT_CASES_PATH,
    block_request,
    build_blocks_requests,
    build_convert_cases,
    dump_request,
    render,
    solve_case,
)
from backend.solver.stats import violations

CASES = json.loads(Path(CASES_PATH).read_text(encoding="utf-8"))
FEASIBLE = [c for c in CASES if c["status"] == "ok"]
INFEASIBLE = [c for c in CASES if c["status"] == "infeasible"]
spec_adapter = TypeAdapter(ConstraintSpec)
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


# --- 블록 동등성(ADR-018): 템플릿을 convert_request로 바꿔 풀어도 같은 결과 ---


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_blocks_objective_equal(case):
    req = block_request(case)
    assert {c.type for c in req.constraints} <= {"count", "sequence", "balance", "fixed_assignment"}
    out = solve_case(req)
    assert out["status"] == "ok" and out["optimal"]
    assert out["objective"] == case["objective"]


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_recorded_assignments_satisfy_hard_blocks(case):
    req = block_request(case)
    hard = [c for c in req.constraints if c.enabled and c.hardness == "hard" and c.type != "fixed_assignment"]
    assert hard
    for c in hard:
        assert violations(req, case["assignments"], c) == [], c.id


@pytest.mark.parametrize("case", INFEASIBLE, ids=_ids(INFEASIBLE))
def test_blocks_infeasible_stays_infeasible(case):
    assert solve_case(block_request(case), conflicts=False)["status"] == "infeasible"


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
            assert spec_adapter.dump_python(got, mode="json", exclude_none=True) == c["block"], c["name"]


# --- 블록 골든(blocks-cases.json): 지금 블록 솔버의 목적값·배정(ADR-019 식 변환의 기준) ---

BLOCK_CASES = json.loads(Path(BLOCKS_CASES_PATH).read_text(encoding="utf-8"))
BLOCK_FEASIBLE = [c for c in BLOCK_CASES if c["expected"]["status"] == "ok"]
BLOCK_INFEASIBLE = [c for c in BLOCK_CASES if c["expected"]["status"] == "infeasible"]


def _req(case) -> ScheduleRequest:
    return ScheduleRequest.model_validate(case["request"])


def test_blocks_cases_requests_up_to_date():
    built = [{"id": cid, "request": dump_request(req)} for cid, _, req in build_blocks_requests()]
    assert [{"id": c["id"], "request": c["request"]} for c in BLOCK_CASES] == built


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


@pytest.mark.parametrize("case", BLOCK_FEASIBLE, ids=_ids(BLOCK_FEASIBLE))
def test_blocks_golden_objective_equal(case):
    out = solve_case(_req(case))
    assert out["status"] == "ok" and out["optimal"]
    assert out["objective"] == case["expected"]["objective"]


@pytest.mark.parametrize("case", BLOCK_FEASIBLE, ids=_ids(BLOCK_FEASIBLE))
def test_blocks_golden_assignments_satisfy_hard(case):
    req = _req(case)
    hard = [c for c in req.constraints if c.enabled and c.hardness == "hard"]
    assert hard
    for c in hard:
        assert violations(req, case["expected"]["assignments"], c) == [], c.id


@pytest.mark.parametrize("case", BLOCK_INFEASIBLE, ids=_ids(BLOCK_INFEASIBLE))
def test_blocks_golden_infeasible(case):
    assert solve_case(_req(case), conflicts=False)["status"] == "infeasible"
