"""골든 케이스(backend/tests/golden/cases.json): 블록화 전 솔버의 목적값·배정 기록(ADR-018 이전 기준)."""

import json
from pathlib import Path

import pytest

from backend.domain.models import ScheduleRequest
from backend.gen_golden import CASES_PATH, history_load, solve_case

CASES = json.loads(Path(CASES_PATH).read_text(encoding="utf-8"))
FEASIBLE = [c for c in CASES if c["status"] == "ok"]
INFEASIBLE = [c for c in CASES if c["status"] == "infeasible"]


def _ids(cases):
    return [c["id"] for c in cases]


def _request(case) -> ScheduleRequest:
    return ScheduleRequest.model_validate(case["request"])


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
def test_request_validates(case):
    _request(case)


@pytest.mark.parametrize("case", [c for c in CASES if c["history_raw"]], ids=_ids([c for c in CASES if c["history_raw"]]))
def test_history_load_matches_raw(case):
    assert case["request"]["history_load"] == history_load(case["history_raw"])


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_feasible_objective_reproduces(case):
    assert case["optimal"] is True
    out = solve_case(_request(case))
    assert out["status"] == "ok" and out["optimal"]
    assert out["objective"] == case["objective"]


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_recorded_assignments_satisfy_hard(case):
    data = dict(case["request"])
    fixed = [
        {
            "id": f"golden-{nid}-{d}",
            "type": "fixed_assignment",
            "scope": "period",
            "source_text": "",
            "params": {"nurse_id": nid, "day": d, "shift": s},
        }
        for nid, row in case["assignments"].items()
        for d, s in enumerate(row, start=1)
    ]
    data["constraints"] = data["constraints"] + fixed
    out = solve_case(ScheduleRequest.model_validate(data))
    assert out["status"] == "ok"
    assert out["objective"] >= case["objective"]


@pytest.mark.parametrize("case", INFEASIBLE, ids=_ids(INFEASIBLE))
def test_infeasible_stays_infeasible(case):
    assert case["conflict_ids"]
    assert solve_case(_request(case), conflicts=False)["status"] == "infeasible"
