"""솔버 hard 규칙(프리셋 이름의 식 규칙과 칸 고정). 병렬 탐색이라 정확한 배정값이 아니라 제약 충족 여부를 검증한다."""


from backend.domain.models import ScheduleRequest, SolveInfeasible, SolveOk
from backend.solver import select
from backend.solver.model import build_model, solve
from backend.tests.rules import (
    DEN_CONFIG,
    coverage,
    fixed,
    forbid,
    leave,
    max_nights,
    max_work,
    min_off,
    off_after_night,
    sample_data,
)

# 2026-11: 30일, 1일이 일요일. 주말 = 1, 7, 8, 14, 15, 21, 22, 28, 29
START, DAYS = "2026-11-01", 30
WEEKENDS = {1, 7, 8, 14, 15, 21, 22, 28, 29}


def employee(nid: str, tags: list[str] | None = None) -> dict:
    return {"id": nid, "name": f"직원{nid}", "tags": tags or []}


def request(employees: list[dict] | None = None, constraints: list[dict] | None = None, **extra) -> ScheduleRequest:
    return ScheduleRequest.model_validate({
        "config": DEN_CONFIG,
        "employees": employees if employees is not None else [employee(f"n{i}") for i in range(1, 7)],
        "period": {"start_date": START, "length": DAYS},
        "constraints": constraints or [],
        "input_version": 1,
        **extra,
    })


def solve_ok(req: ScheduleRequest) -> dict[str, list[str]]:
    res = solve(req)
    assert isinstance(res, SolveOk), res
    assert res.input_version == req.input_version
    return res.result.assignments


def combined(req: ScheduleRequest, assignments: dict, nid: str) -> tuple[list[str], int]:
    """(이월 + 대상 월 근무, 이월 길이)."""
    carry = next((r.shifts for r in req.carry_over if r.employee_id == nid), [])
    return list(carry) + assignments[nid], len(carry)


def runs(seq: list[str], pred, offset: int) -> list[int]:
    """대상 월 날짜를 하나 이상 포함하는 pred 연속 구간의 길이들."""
    out, start = [], None
    for i, s in enumerate(seq + ["#"]):
        if s != "#" and pred(s):
            start = i if start is None else start
        elif start is not None:
            if i - 1 >= offset:
                out.append(i - start)
            start = None
    return out


# --- 기본 구조 ---


def test_every_employee_has_one_shift_per_day():
    req = request()
    a = solve_ok(req)
    assert set(a) == {n.id for n in req.employees}
    assert all(len(row) == DAYS and set(row) <= set("DENO") for row in a.values())


def test_is_weekend_includes_sat_sun_and_holidays():
    ctx = build_model(request(holidays=[3]))
    assert {d for d in range(1, DAYS + 1) if ctx.is_weekend(d)} == WEEKENDS | {3}


def test_hard_literal_per_enabled_hard_constraint_only():
    req = request(constraints=[
        min_off("a", 8),
        min_off("b", 8, enabled=False),
        min_off("c", 8, hardness="soft"),
        leave("d", "n1", [3]),
    ])
    ctx = build_model(req)
    assert set(ctx.hard_literals) == {"a", "d"}


# --- 프리셋 이름의 식 규칙 ---


def test_daily_coverage_by_day_kind_with_holiday():
    req = request(holidays=[3], constraints=[
        coverage("D", "weekday", 2, 2),
        coverage("N", "weekday", 1, 2),
        coverage("D", "weekend", 1, 1),
        coverage("N", "weekend", 0, 0),
    ])
    a = solve_ok(req)
    for d in range(1, DAYS + 1):
        count = lambda s: sum(row[d - 1] == s for row in a.values())
        if d in WEEKENDS or d == 3:
            assert count("D") == 1 and count("N") == 0, d
        else:
            assert count("D") == 2 and 1 <= count("N") <= 2, d


def test_forbidden_sequence_within_month():
    req = request(constraints=[coverage("N", "weekday", 2, 2), coverage("D", "weekday", 2, 2),
                               forbid("fs", "N", "D")])
    a = solve_ok(req)
    for row in a.values():
        assert all(not (p == "N" and q == "D") for p, q in zip(row, row[1:]))


def test_forbidden_sequence_checks_carry_over_last_day():
    req = request(
        constraints=[forbid("fs", "N", "D")],
        carry_over=[{"employee_id": "n1", "shifts": ["D", "N"]}],
    )
    assert solve_ok(req)["n1"][0] != "D"


def test_forbidden_sequence_carry_last_n_with_fixed_day1_d_is_infeasible():
    req = request(
        constraints=[forbid("fs", "N", "D"),
                     fixed("fx", "n1", 1, "D")],
        carry_over=[{"employee_id": "n1", "shifts": ["N"]}],
    )
    assert isinstance(solve(req), SolveInfeasible)


def test_violation_only_inside_carry_over_is_ignored():
    req = request(
        constraints=[forbid("fs", "N", "D"),
                     max_work("mw", 2),
                     max_nights("mn", 1)],
        carry_over=[{"employee_id": "n1", "shifts": ["N", "N", "D", "O"]}],
    )
    assert isinstance(solve(req), SolveOk)


def test_max_consecutive_work_including_carry_over():
    req = request(
        constraints=[coverage("D", "weekday", 2, 2), coverage("E", "weekday", 2, 2),
                     coverage("D", "weekend", 2, 2), coverage("E", "weekend", 2, 2),
                     max_work("mw", 4)],
        carry_over=[{"employee_id": "n1", "shifts": ["D", "D", "E"]}],
    )
    a = solve_ok(req)
    for nid in a:
        seq, off = combined(req, a, nid)
        assert max(runs(seq, lambda s: s != "O", off), default=0) <= 4, nid


def test_max_consecutive_work_carry_full_forces_day1_off():
    req = request(
        constraints=[max_work("mw", 3),
                     fixed("fx", "n1", 1, "E")],
        carry_over=[{"employee_id": "n1", "shifts": ["D", "D", "D"]}],
    )
    assert isinstance(solve(req), SolveInfeasible)


def test_max_consecutive_nights_including_carry_over():
    req = request(
        constraints=[coverage("N", "weekday", 2, 2), coverage("N", "weekend", 2, 2),
                     max_nights("mn", 2)],
        carry_over=[{"employee_id": "n1", "shifts": ["N"]}],
    )
    a = solve_ok(req)
    for nid in a:
        seq, off = combined(req, a, nid)
        assert max(runs(seq, lambda s: s == "N", off), default=0) <= 2, nid


def test_min_days_off():
    req = request(constraints=[coverage("D", "weekday", 2, 6), coverage("D", "weekend", 2, 6),
                               min_off("off", 10)])
    a = solve_ok(req)
    assert all(row.count("O") >= 10 for row in a.values())


def test_off_after_night_block_including_carry_over():
    req = request(
        constraints=[coverage("N", "weekday", 1, 1), coverage("N", "weekend", 1, 1),
                     coverage("D", "weekday", 2, 2), coverage("D", "weekend", 2, 2),
                     off_after_night("noff", 2)],
        carry_over=[{"employee_id": "n1", "shifts": ["D", "N"]}],
    )
    a = solve_ok(req)
    for nid in a:
        seq, off = combined(req, a, nid)
        for i in range(len(seq) - 1):
            if seq[i] == "N" and seq[i + 1] != "N" and i + 1 >= off:
                after = seq[i + 1:i + 3]
                assert all(s == "O" for s in after), (nid, i - off + 1)


def test_off_after_night_block_carry_n_then_day1_work_is_infeasible():
    req = request(
        constraints=[off_after_night("noff", 1),
                     fixed("fx", "n1", 1, "E")],
        carry_over=[{"employee_id": "n1", "shifts": ["N"]}],
    )
    assert isinstance(solve(req), SolveInfeasible)


def test_leave_days_are_off():
    req = request(constraints=[coverage("D", "weekday", 5, 6), coverage("D", "weekend", 5, 6),
                               leave("lv", "n2", [4, 5, 6])])
    a = solve_ok(req)
    assert [a["n2"][d - 1] for d in (4, 5, 6)] == ["O", "O", "O"]


def test_fixed_assignment():
    req = request(constraints=[coverage("N", "weekday", 0, 0),
                               fixed("fx", "n3", 10, "E")])
    assert solve_ok(req)["n3"][9] == "E"


# --- 무시 규칙, 해 없음, 샘플 ---


def test_leave_and_fixed_on_same_cell_is_infeasible():
    req = request(constraints=[leave("lv", "n1", [5]),
                               fixed("fx", "n1", 5, "D")])
    res = solve(req)
    assert isinstance(res, SolveInfeasible)
    assert {c.constraint_id for c in res.conflicts} == {"lv", "fx"}
    assert res.input_version == req.input_version


def test_disabled_constraint_is_ignored():
    req = request(constraints=[leave("lv", "n1", [5]),
                               fixed("fx", "n1", 5, "D",
                                   enabled=False)])
    assert solve_ok(req)["n1"][4] == "O"


def test_soft_toggled_template_is_skipped_in_hard_phase():
    impossible = coverage("D", "weekday", 10, 10)
    assert isinstance(solve(request(constraints=[impossible])), SolveInfeasible)
    assert isinstance(solve(request(constraints=[{**impossible, "hardness": "soft"}])), SolveOk)


def test_sample_shop_has_solution():
    req = ScheduleRequest.model_validate(sample_data())
    a = solve_ok(req)
    for c in req.constraints:
        if not c.id.startswith("cov-"):
            continue
        n = c.values["min"].value  # 샘플 필요 인원은 정확히 n명(eq)
        shifts = c.body.then.left.shifts
        for d in select.days(req, c.body.for_each.days):
            assert sum(row[d - 1] in shifts.codes for row in a.values()) == n
