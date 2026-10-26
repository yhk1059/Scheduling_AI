"""솔버 hard 템플릿 1~9. 병렬 탐색이라 정확한 배정값이 아니라 제약 충족 여부를 검증한다."""

import json
from pathlib import Path

from backend.domain.models import ScheduleRequest, SolveInfeasible, SolveOk
from backend.solver.model import build_model, solve

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "lib" / "samples" / "ward-15.json"

# 2026-11: 30일, 1일이 일요일. 주말 = 1, 7, 8, 14, 15, 21, 22, 28, 29
YEAR, MONTH, DAYS = 2026, 11, 30
WEEKENDS = {1, 7, 8, 14, 15, 21, 22, 28, 29}


def nurse(nid: str, years: int = 5, night_only: bool = False) -> dict:
    return {"id": nid, "name": f"간호사{nid}", "years": years, "night_only": night_only}


def con(cid: str, type_: str, params: dict, **extra) -> dict:
    return {"id": cid, "type": type_, "scope": "ward", "source_text": "원문", "params": params, **extra}


def coverage(shift: str, day_kind: str, lo: int, hi: int, **extra) -> dict:
    return con(f"cov-{day_kind}-{shift}", "daily_coverage",
               {"shift": shift, "day_kind": day_kind, "min": lo, "max": hi}, **extra)


def request(nurses: list[dict] | None = None, constraints: list[dict] | None = None, **extra) -> ScheduleRequest:
    return ScheduleRequest.model_validate({
        "nurses": nurses if nurses is not None else [nurse(f"n{i}") for i in range(1, 7)],
        "period": {"year": YEAR, "month": MONTH},
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
    carry = next((r.shifts for r in req.carry_over if r.nurse_id == nid), [])
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


def test_every_nurse_has_one_shift_per_day():
    req = request()
    a = solve_ok(req)
    assert set(a) == {n.id for n in req.nurses}
    assert all(len(row) == DAYS and set(row) <= set("DENO") for row in a.values())


def test_night_only_nurse_gets_only_n_or_o():
    nurses = [nurse("n1", night_only=True), nurse("n2"), nurse("n3")]
    req = request(nurses, [coverage("N", "weekday", 1, 1), coverage("N", "weekend", 1, 1)])
    a = solve_ok(req)
    assert set(a["n1"]) <= {"N", "O"}


def test_is_weekend_includes_sat_sun_and_holidays():
    ctx = build_model(request(holidays=[3]))
    assert {d for d in range(1, DAYS + 1) if ctx.is_weekend(d)} == WEEKENDS | {3}


def test_hard_literal_per_enabled_hard_constraint_only():
    req = request(constraints=[
        con("a", "min_days_off", {"days": 8}),
        con("b", "min_days_off", {"days": 8}, enabled=False),
        con("c", "min_days_off", {"days": 8}, hardness="soft"),
        con("d", "leave", {"nurse_id": "n1", "days": [3]}),
    ])
    ctx = build_model(req)
    assert set(ctx.hard_literals) == {"a", "d"}


# --- 템플릿 1~9 ---


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
                               con("fs", "forbidden_sequence", {"first": "N", "second": "D"})])
    a = solve_ok(req)
    for row in a.values():
        assert all(not (p == "N" and q == "D") for p, q in zip(row, row[1:]))


def test_forbidden_sequence_checks_carry_over_last_day():
    req = request(
        constraints=[con("fs", "forbidden_sequence", {"first": "N", "second": "D"})],
        carry_over=[{"nurse_id": "n1", "shifts": ["D", "N"]}],
    )
    assert solve_ok(req)["n1"][0] != "D"


def test_forbidden_sequence_carry_last_n_with_fixed_day1_d_is_infeasible():
    req = request(
        constraints=[con("fs", "forbidden_sequence", {"first": "N", "second": "D"}),
                     con("fx", "fixed_assignment", {"nurse_id": "n1", "day": 1, "shift": "D"})],
        carry_over=[{"nurse_id": "n1", "shifts": ["N"]}],
    )
    assert isinstance(solve(req), SolveInfeasible)


def test_violation_only_inside_carry_over_is_ignored():
    req = request(
        constraints=[con("fs", "forbidden_sequence", {"first": "N", "second": "D"}),
                     con("mw", "max_consecutive_work", {"days": 2}),
                     con("mn", "max_consecutive_nights", {"days": 1})],
        carry_over=[{"nurse_id": "n1", "shifts": ["N", "N", "D", "O"]}],
    )
    assert isinstance(solve(req), SolveOk)


def test_max_consecutive_work_including_carry_over():
    req = request(
        constraints=[coverage("D", "weekday", 2, 2), coverage("E", "weekday", 2, 2),
                     coverage("D", "weekend", 2, 2), coverage("E", "weekend", 2, 2),
                     con("mw", "max_consecutive_work", {"days": 4})],
        carry_over=[{"nurse_id": "n1", "shifts": ["D", "D", "E"]}],
    )
    a = solve_ok(req)
    for nid in a:
        seq, off = combined(req, a, nid)
        assert max(runs(seq, lambda s: s != "O", off), default=0) <= 4, nid


def test_max_consecutive_work_carry_full_forces_day1_off():
    req = request(
        constraints=[con("mw", "max_consecutive_work", {"days": 3}),
                     con("fx", "fixed_assignment", {"nurse_id": "n1", "day": 1, "shift": "E"})],
        carry_over=[{"nurse_id": "n1", "shifts": ["D", "D", "D"]}],
    )
    assert isinstance(solve(req), SolveInfeasible)


def test_max_consecutive_nights_including_carry_over():
    req = request(
        constraints=[coverage("N", "weekday", 2, 2), coverage("N", "weekend", 2, 2),
                     con("mn", "max_consecutive_nights", {"days": 2})],
        carry_over=[{"nurse_id": "n1", "shifts": ["N"]}],
    )
    a = solve_ok(req)
    for nid in a:
        seq, off = combined(req, a, nid)
        assert max(runs(seq, lambda s: s == "N", off), default=0) <= 2, nid


def test_min_days_off():
    req = request(constraints=[coverage("D", "weekday", 2, 6), coverage("D", "weekend", 2, 6),
                               con("off", "min_days_off", {"days": 10})])
    a = solve_ok(req)
    assert all(row.count("O") >= 10 for row in a.values())


def test_off_after_night_block_including_carry_over():
    req = request(
        constraints=[coverage("N", "weekday", 1, 1), coverage("N", "weekend", 1, 1),
                     coverage("D", "weekday", 2, 2), coverage("D", "weekend", 2, 2),
                     con("noff", "off_after_night_block", {"days": 2})],
        carry_over=[{"nurse_id": "n1", "shifts": ["D", "N"]}],
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
        constraints=[con("noff", "off_after_night_block", {"days": 1}),
                     con("fx", "fixed_assignment", {"nurse_id": "n1", "day": 1, "shift": "E"})],
        carry_over=[{"nurse_id": "n1", "shifts": ["N"]}],
    )
    assert isinstance(solve(req), SolveInfeasible)


def test_skill_mix():
    nurses = [nurse("n1", 1), nurse("n2", 1), nurse("n3", 2), nurse("n4", 4), nurse("n5", 6), nurse("n6", 8)]
    req = request(nurses, [coverage("N", "weekday", 2, 2), coverage("N", "weekend", 2, 2),
                           con("sm", "skill_mix", {"shift": "N", "min_years": 3, "min_count": 1})])
    a = solve_ok(req)
    senior = {n.id for n in req.nurses if n.years >= 3}
    for d in range(DAYS):
        assert sum(a[nid][d] == "N" for nid in senior) >= 1, d + 1


def test_leave_days_are_off():
    req = request(constraints=[coverage("D", "weekday", 5, 6), coverage("D", "weekend", 5, 6),
                               con("lv", "leave", {"nurse_id": "n2", "days": [4, 5, 6]})])
    a = solve_ok(req)
    assert [a["n2"][d - 1] for d in (4, 5, 6)] == ["O", "O", "O"]


def test_fixed_assignment():
    req = request(constraints=[coverage("N", "weekday", 0, 0),
                               con("fx", "fixed_assignment", {"nurse_id": "n3", "day": 10, "shift": "E"})])
    assert solve_ok(req)["n3"][9] == "E"


# --- 무시 규칙, 해 없음, 샘플 ---


def test_leave_and_fixed_on_same_cell_is_infeasible():
    req = request(constraints=[con("lv", "leave", {"nurse_id": "n1", "days": [5]}),
                               con("fx", "fixed_assignment", {"nurse_id": "n1", "day": 5, "shift": "D"})])
    res = solve(req)
    assert isinstance(res, SolveInfeasible)
    assert res.conflicts == [] and res.input_version == req.input_version


def test_disabled_constraint_is_ignored():
    req = request(constraints=[con("lv", "leave", {"nurse_id": "n1", "days": [5]}),
                               con("fx", "fixed_assignment", {"nurse_id": "n1", "day": 5, "shift": "D"},
                                   enabled=False)])
    assert solve_ok(req)["n1"][4] == "O"


def test_soft_toggled_template_is_skipped_in_hard_phase():
    impossible = coverage("D", "weekday", 10, 10)
    assert isinstance(solve(request(constraints=[impossible])), SolveInfeasible)
    assert isinstance(solve(request(constraints=[{**impossible, "hardness": "soft"}])), SolveOk)


def test_sample_ward_has_solution():
    req = ScheduleRequest.model_validate(json.loads(SAMPLE_PATH.read_text(encoding="utf-8")))
    a = solve_ok(req)
    night_only = {n.id for n in req.nurses if n.night_only}
    assert all(set(a[nid]) <= {"N", "O"} for nid in night_only)
    ctx = build_model(req)
    for c in req.constraints:
        p = c.params
        for d in range(1, req.period.days + 1):
            if (p.day_kind == "weekend") == ctx.is_weekend(d):
                assert p.min <= sum(row[d - 1] == p.shift for row in a.values()) <= p.max
