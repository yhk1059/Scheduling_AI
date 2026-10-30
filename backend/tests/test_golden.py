"""솔버 회귀 기준(solver-cases.json): 식 규칙 요청과 지금 솔버의 기대값(status, 목적값·배정 또는 충돌 규칙 id).

다시 쓰기: npm run gen:golden
"""

import json

import pytest

from backend.domain.models import ScheduleRequest
from backend.gen_golden import SOLVER_CASES_PATH, solve_case
from backend.solver.evaluate import evaluate_rule

CASES = json.loads(SOLVER_CASES_PATH.read_text(encoding="utf-8"))
FEASIBLE = [c for c in CASES if c["expected"]["status"] == "ok"]
INFEASIBLE = [c for c in CASES if c["expected"]["status"] == "infeasible"]


def _ids(cases):
    return [c["id"] for c in cases]


def _req(case) -> ScheduleRequest:
    return ScheduleRequest.model_validate(case["request"])


def _hard_violations(req: ScheduleRequest, a: dict) -> dict[str, list]:
    out = {}
    for c in req.constraints:
        if c.enabled and c.hardness == "hard" and c.type == "rule":
            vs = evaluate_rule(req, a, c)
            if vs:
                out[c.id] = vs
    return out


def test_cases_cover_features():
    reqs = [_req(c) for c in CASES]
    assert all({c.type for c in r.constraints} <= {"rule", "fixed_assignment"} for r in reqs)
    rules = [c for r in reqs for c in r.constraints if c.type == "rule"]
    assert any(c.hardness == "soft" for c in rules) and any(c.body.kind == "balance" for c in rules)
    assert any(c.type == "fixed_assignment" for r in reqs for c in r.constraints)
    assert any(r.previous for r in reqs) and any(r.history for r in reqs) and any(r.carry_over for r in reqs)
    codes = {s.code for r in reqs for s in r.config.shifts}
    assert {"M", "DE"} <= codes
    assert len(FEASIBLE) >= 10 and len(INFEASIBLE) >= 3
    assert all(c["expected"]["optimal"] for c in FEASIBLE)
    assert all(c["expected"]["conflict_ids"] for c in INFEASIBLE)


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_objective_equal(case):
    req = _req(case)
    out = solve_case(req)
    assert out["status"] == "ok" and out["optimal"]
    assert out["objective"] == case["expected"]["objective"]
    assert _hard_violations(req, out["assignments"]) == {}


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_recorded_assignments_satisfy_hard_rules(case):
    req = _req(case)
    assert [c for c in req.constraints if c.enabled and c.hardness == "hard"]
    assert _hard_violations(req, case["expected"]["assignments"]) == {}


@pytest.mark.parametrize("case", INFEASIBLE, ids=_ids(INFEASIBLE))
def test_infeasible_same_conflicts(case):
    out = solve_case(_req(case))
    assert out["status"] == "infeasible"
    assert set(out["conflict_ids"]) == set(case["expected"]["conflict_ids"])
