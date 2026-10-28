"""최소 변경 재스케줄: previous가 있으면 바뀐 칸에 DIFF_WEIGHT 페널티, 결과에 diff."""

import pytest

from backend.domain.models import ScheduleRequest, SolveOk
from backend.solver.model import solve
from backend.tests.test_solver_hard import con, nurse, sample_data


def sample() -> dict:
    return sample_data()


def solve_result(raw: dict):
    res = solve(ScheduleRequest.model_validate(raw))
    assert isinstance(res, SolveOk), res
    return res.result


def changed_cells(before: dict, after: dict) -> set[tuple[str, int]]:
    return {
        (nid, d + 1)
        for nid, row in before.items()
        if nid in after
        for d, s in enumerate(row)
        if d < len(after[nid]) and after[nid][d] != s
    }


def assert_diff_matches(result, previous: dict) -> None:
    expected = changed_cells(previous, result.assignments)
    assert {(c.nurse_id, c.day) for c in result.diff} == expected
    for c in result.diff:
        assert c.before == previous[c.nurse_id][c.day - 1]
        assert c.after == result.assignments[c.nurse_id][c.day - 1]


@pytest.fixture(scope="module")
def base() -> dict:
    return solve_result(sample()).assignments


def test_no_previous_means_diff_none():
    assert solve_result(sample()).diff is None


def test_identical_rerun_has_empty_diff(base):
    result = solve_result({**sample(), "previous": base})
    assert result.diff == []
    assert result.assignments == base


def test_sick_leave_changes_few_cells(base):
    nid = "n03"
    raw = sample()
    raw["previous"] = base
    raw["constraints"].append(con("sick", "leave", {"nurse_id": nid, "days": [10, 11, 12]}))
    result = solve_result(raw)
    assert all(result.assignments[nid][d - 1] == "O" for d in (10, 11, 12))
    assert len(result.diff) <= 12
    assert_diff_matches(result, base)


def test_fixed_assignment_edit_is_applied_with_few_changes(base):
    nid, day = "n05", 15
    target = "N" if base[nid][day - 1] != "N" else "D"
    raw = sample()
    raw["previous"] = base
    raw["constraints"].append(con("fix", "fixed_assignment", {"nurse_id": nid, "day": day, "shift": target}))
    result = solve_result(raw)
    assert result.assignments[nid][day - 1] == target
    assert (nid, day) in {(c.nurse_id, c.day) for c in result.diff}
    assert len(result.diff) <= 6
    assert_diff_matches(result, base)


def test_new_nurse_not_in_previous_is_ignored_by_diff(base):
    raw = sample()
    raw["nurses"].append(nurse("n99", years=3))
    raw["previous"] = base
    result = solve_result(raw)
    assert "n99" in result.assignments
    assert all(c.nurse_id != "n99" for c in result.diff)
    assert_diff_matches(result, base)
