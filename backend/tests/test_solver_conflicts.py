"""충돌 분석: assumptions core → Conflict 목록, solve() 연동."""

import time

from backend.domain.constants import CONFLICT_TIME_LIMIT_S, SOLVE_TIME_LIMIT_S
from backend.domain.models import ScheduleRequest, SolveInfeasible
from backend.solver import model as solver_model
from backend.solver.conflicts import find_conflicts
from backend.solver.model import solve
from backend.tests.test_solver_hard import con, coverage, nurse, request, sample_data


def leave(cid: str, nid: str, days: list[int]) -> dict:
    return con(cid, "leave", {"nurse_id": nid, "days": days})


def fixed(cid: str, nid: str, day: int, shift: str) -> dict:
    return con(cid, "fixed_assignment", {"nurse_id": nid, "day": day, "shift": shift})


def basic_coverage() -> list[dict]:
    return [coverage(s, k, 1, 1) for s in "DEN" for k in ("weekday", "weekend")]


def ids(conflicts) -> set[str]:
    return {c.constraint_id for c in conflicts}


def overloaded_sample() -> tuple[ScheduleRequest, set[str]]:
    """샘플 병동(주말 7명 필요)에서 토요일 7일에 9명이 휴가 → 6명만 남는다."""
    data = sample_data()
    leaves = [leave(f"lv-n{i:02d}", f"n{i:02d}", [7]) for i in range(1, 10)]
    data["constraints"] += leaves + [con("mcn", "max_consecutive_nights", {"days": 3})]
    return ScheduleRequest.model_validate(data), {c["id"] for c in leaves}


def test_excess_leave_conflicts_with_weekend_coverage():
    req, leave_ids = overloaded_sample()
    conflicts = find_conflicts(req)
    assert conflicts is not None
    got = ids(conflicts)
    assert leave_ids <= got
    assert got & {"cov-weekend-D", "cov-weekend-E", "cov-weekend-N"}
    assert "mcn" not in got
    assert not got & {"cov-weekday-D", "cov-weekday-E", "cov-weekday-N"}


def test_conflict_carries_type_and_source_text():
    req, _ = overloaded_sample()
    by_id = {c.constraint_id: c for c in find_conflicts(req)}
    assert by_id["lv-n01"].type == "leave"
    assert by_id["lv-n01"].source_text == "원문"


def test_fixed_cells_same_day_conflict():
    req = request(constraints=[fixed("f1", "n1", 5, "D"), fixed("f2", "n1", 5, "N")])
    assert ids(find_conflicts(req)) == {"f1", "f2"}


def test_fixed_cells_conflict_with_rule():
    req = request(constraints=basic_coverage() + [
        fixed("f1", "n1", 1, "N"), fixed("f2", "n1", 2, "D"),
        con("fs", "forbidden_sequence", {"first": "N", "second": "D"}),
    ])
    assert ids(find_conflicts(req)) == {"f1", "f2", "fs"}


def test_night_only_nurse_fixed_day_shift():
    nurses = [nurse("n1", night_only=True), nurse("n2"), nurse("n3")]
    req = request(nurses, [fixed("f1", "n1", 3, "D"), con("mcn", "max_consecutive_nights", {"days": 3})])
    assert ids(find_conflicts(req)) == {"f1"}


def test_disabled_constraints_are_not_reported():
    req = request(constraints=[
        fixed("f1", "n1", 5, "D"), fixed("f2", "n1", 5, "N"), fixed("f3", "n1", 5, "E") | {"enabled": False},
    ])
    assert ids(find_conflicts(req)) == {"f1", "f2"}


def test_solve_returns_conflicts_when_infeasible():
    req = request(constraints=[fixed("f1", "n1", 5, "D"), fixed("f2", "n1", 5, "N")])
    res = solve(req)
    assert isinstance(res, SolveInfeasible)
    assert res.input_version == req.input_version
    assert ids(res.conflicts) == {"f1", "f2"}


def test_solve_returns_empty_conflicts_when_analysis_undecided(monkeypatch):
    monkeypatch.setattr(solver_model, "find_conflicts", lambda *a, **k: None)
    req = request(constraints=[fixed("f1", "n1", 5, "D"), fixed("f2", "n1", 5, "N")])
    res = solve(req)
    assert isinstance(res, SolveInfeasible)
    assert res.conflicts == []


def test_find_conflicts_returns_none_when_time_runs_out():
    req, _ = overloaded_sample()
    assert find_conflicts(req, time_limit_s=0.0) is None


def test_infeasible_solve_with_analysis_within_time_budget():
    req, _ = overloaded_sample()
    start = time.perf_counter()
    res = solve(req)
    assert isinstance(res, SolveInfeasible)
    assert time.perf_counter() - start < SOLVE_TIME_LIMIT_S + CONFLICT_TIME_LIMIT_S


def test_solve_can_skip_conflict_analysis(monkeypatch):
    """제안 검증용 재풀이는 충돌 분석 시간을 쓰지 않는다."""

    def fail(*a, **k):
        raise AssertionError("find_conflicts가 호출되면 안 된다")

    monkeypatch.setattr(solver_model, "find_conflicts", fail)
    req = request(constraints=[fixed("f1", "n1", 5, "D"), fixed("f2", "n1", 5, "N")])
    res = solve(req, analyze_conflicts=False)
    assert isinstance(res, SolveInfeasible)
    assert res.conflicts == []
