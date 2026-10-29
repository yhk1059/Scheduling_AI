"""soft 블록, 목적함수, compute_result(요약·통계)."""

import time

from ortools.sat.python import cp_model

from backend.domain.models import ScheduleRequest, SolveOk
from backend.solver.model import build_model, solve
from backend.solver.stats import compute_result
from backend.tests import blocks
from backend.tests.blocks import (
    coverage,
    history,
    max_nights,
    max_work,
    min_off,
    night_fair,
    off_after_night,
    sample_data,
    skill_mix,
    weekend_fair,
)
from backend.tests.test_solver_hard import START, WEEKENDS, forbid, nurse, request, solve_ok


def pref(cid: str, nid: str, shift: str, prefer: bool, days: list[int] | None = None,
         weekends_only: bool = False, **extra) -> dict:
    """희망·기피(2026-11, 공휴일 없음). 희망은 대상 날짜 수를 min으로."""
    target = set(days if days is not None else range(1, 31))
    if weekends_only:
        target &= WEEKENDS
    return blocks.pref(cid, nid, shift, len(target) if prefer else None, days, weekends_only, **extra)


def basic_coverage() -> list[dict]:
    return [coverage(s, k, 1, 1) for s in "DEN" for k in ("weekday", "weekend")]


def night_spread(assignments: dict, nurse_ids: list[str]) -> int:
    counts = [assignments[n].count("N") for n in nurse_ids]
    return max(counts) - min(counts)


# --- soft 제약 ---


def test_preferred_shift_is_assigned_when_no_conflict():
    req = request(constraints=basic_coverage() + [pref("p1", "n1", "O", True, [3, 4, 5]),
                                                  pref("p2", "n2", "N", True, [10])])
    a = solve_ok(req)
    assert [a["n1"][d - 1] for d in (3, 4, 5)] == ["O", "O", "O"]
    assert a["n2"][9] == "N"


def test_avoided_shift_is_not_assigned_when_possible():
    req = request(constraints=basic_coverage() + [pref("p1", "n1", "N", False)])
    a = solve_ok(req)
    assert "N" not in a["n1"]


def test_weekends_only_preference_targets_weekends():
    req = request(constraints=basic_coverage() + [pref("p1", "n1", "O", True, None, weekends_only=True)])
    a = solve_ok(req)
    assert all(a["n1"][d - 1] == "O" for d in WEEKENDS)


def test_soft_constraint_creates_no_hard_literal():
    req = request(constraints=[pref("p1", "n1", "O", True, [1]),
                               night_fair(),
                               coverage("D", "weekday", 1, 1, hardness="soft")])
    assert build_model(req).hard_literals == {}


def test_night_fairness_reduces_or_keeps_spread():
    nurses = [nurse(f"n{i}") for i in range(1, 6)] + [nurse("n6", tags=["나이트전담"])]
    base = [coverage("N", k, 2, 2) for k in ("weekday", "weekend")]
    regular = [f"n{i}" for i in range(1, 6)]

    without = solve_ok(request(nurses, base))
    with_fair = solve_ok(request(nurses, base + [night_fair()]))
    assert night_spread(with_fair, regular) <= night_spread(without, regular)
    assert night_spread(with_fair, regular) <= 1


def test_weekend_fairness_balances_weekend_work():
    base = [coverage(s, "weekend", 1, 1) for s in "DEN"]
    a = solve_ok(request(constraints=base + [weekend_fair()]))
    counts = [sum(1 for d in WEEKENDS if row[d - 1] != "O") for row in a.values()]
    assert max(counts) - min(counts) <= 1


def test_soft_coverage_allows_shortage_but_minimizes_it():
    # 2명뿐인데 데이 3명 요구(soft) → 해는 있고 매일 2명 배정
    nurses = [nurse("n1"), nurse("n2")]
    cons = [coverage("D", k, 3, 3, hardness="soft") for k in ("weekday", "weekend")]
    res = solve(request(nurses, cons))
    assert isinstance(res, SolveOk)
    a = res.result.assignments
    assert all(a["n1"][d] == "D" and a["n2"][d] == "D" for d in range(30))
    assert res.result.summary.soft_violation_count == 30


def test_soft_max_consecutive_work_penalizes_excess():
    nurses = [nurse("n1"), nurse("n2")]
    cons = [coverage("D", k, 1, 1) for k in ("weekday", "weekend")]
    cons.append(max_work("mcw", 3, hardness="soft"))
    a = solve_ok(request(nurses, cons))
    for row in a.values():
        run = best = 0
        for s in row:
            run = run + 1 if s != "O" else 0
            best = max(best, run)
        assert best <= 3


def test_holiday_follows_weekend_coverage():
    # 2026-11-03(화)을 공휴일로 → 주말 인원 기준(D 2명)을 따른다
    cons = [coverage("D", "weekday", 1, 1), coverage("D", "weekend", 2, 2)]
    a = solve_ok(request(constraints=cons, holidays=[3]))
    assert sum(row[2] == "D" for row in a.values()) == 2
    assert sum(row[3] == "D" for row in a.values()) == 1


def test_solve_fills_result_stats():
    res = solve(request(constraints=basic_coverage() + [pref("p1", "n1", "O", True, [3])]))
    assert isinstance(res, SolveOk)
    r = res.result
    assert set(r.stats) == {f"n{i}" for i in range(1, 7)}
    assert r.summary.preferences_total == 1 and r.summary.preferences_met == 1
    assert r.optimal is True


# --- compute_result 단위 테스트 (손으로 만든 assignments) ---


def stats_request(constraints: list[dict], **extra) -> ScheduleRequest:
    return request([nurse("a"), nurse("b"), nurse("c", tags=["나이트전담"])], constraints, **extra)


def row(pattern: str) -> list[str]:
    assert len(pattern) == 30
    return list(pattern)


# 2026-11: 주말 = 1, 7, 8, 14, 15, 21, 22, 28, 29
A = row("DDDDDDOODDDDDOONNNOOEEEEOOOOOO")  # 최대 연속 6
B = row("OOOOOOOOOOOOOOOOOOOOOOOOOOOOOD")
C = row("NNNOONNNOONNNOONNNOONNNOONNNOO")


def test_compute_result_counts_and_weekend_work():
    req = stats_request([])
    r = compute_result(req, {"a": A, "b": B, "c": C}, optimal=True)
    sa = r.stats["a"]
    assert sa.counts == {"D": 11, "E": 4, "N": 3, "O": 12}
    assert sa.hours == 18 * 8
    # a의 주말 근무: 1(D), 15(O)·14(O)·7·8(O) 제외 → 1, 21(E), 22(E) = 3
    assert sa.weekend_holiday_work == 3
    assert sa.max_consecutive_work == 6
    assert r.stats["b"].max_consecutive_work == 1
    assert r.stats["c"].max_consecutive_work == 3
    assert r.optimal is True


def test_compute_result_deviation_from_mean():
    req = stats_request([])
    r = compute_result(req, {"a": A, "b": B, "c": C}, optimal=False)
    # 근무일: a 18, b 1, c 18 → 평균 37/3
    assert abs(r.stats["a"].deviation - (18 - 37 / 3)) < 0.01
    assert abs(r.stats["b"].deviation - (1 - 37 / 3)) < 0.01
    assert r.optimal is False


def test_compute_result_counts_holiday_as_weekend():
    req = stats_request([], holidays=[2])  # 2일(월) 공휴일, a는 D
    r = compute_result(req, {"a": A, "b": B, "c": C}, optimal=True)
    assert r.stats["a"].weekend_holiday_work == 4


def test_compute_result_preferences():
    cons = [pref("p1", "a", "O", True, [7, 8, 9]),     # 7, 8 지켜짐, 9(D) 아님
            pref("p2", "b", "N", False),               # b는 N 없음 → 30칸 모두 지켜짐
            pref("p3", "a", "D", True, [1], enabled=False)]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    assert r.summary.preferences_total == 33
    assert r.summary.preferences_met == 32
    assert abs(r.stats["a"].preference_rate - 2 / 3) < 1e-9
    assert r.stats["b"].preference_rate == 1.0
    assert r.stats["c"].preference_rate is None
    v = [x for x in r.soft_violations if x.constraint_id == "p1"]
    assert [(x.nurse_id, x.day) for x in v] == [("a", 9)]


def test_compute_result_weekends_only_preference():
    cons = [pref("p1", "a", "O", True, None, weekends_only=True)]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    assert r.summary.preferences_total == 9
    assert {x.day for x in r.soft_violations} == {1, 21, 22}


def test_compute_result_soft_violations_for_toggled_blocks():
    cons = [
        max_work("mcw", 5, hardness="soft"),
        max_work("mcw-hard", 5),  # hard는 나열하지 않는다
        coverage("D", "weekday", 2, 2, hardness="soft"),
    ]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    ids = {x.constraint_id for x in r.soft_violations}
    assert "mcw" in ids and "mcw-hard" not in ids
    assert any(x.constraint_id == "mcw" and x.nurse_id == "a" for x in r.soft_violations)
    # 평일 D가 2명인 날은 없다(a 혼자이거나 0명, 30일은 b만) → 평일 21일 모두 위반
    assert sum(x.constraint_id == "cov-weekday-D" for x in r.soft_violations) == 21
    assert r.summary.soft_violation_count == len(r.soft_violations)


def test_compute_result_fairness_violation():
    cons = [night_fair(), weekend_fair()]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    ids = [x.constraint_id for x in r.soft_violations]
    # 비전담 a(N 3), b(N 0) → 편차 3. 주말 근무 a 3, b 0, c 6 → 편차 6
    assert ids.count("nf") == 1 and ids.count("wf") == 1


def test_compute_result_disabled_soft_not_listed():
    cons = [night_fair(enabled=False)]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    assert r.soft_violations == []


# --- 최근 28일 원본(history) ---


def history_sample(constraints: list[dict], rows: dict[str, list[str]] | None = None) -> ScheduleRequest:
    """15명 샘플 병동. N 연속 3일 + N-OFF 2일(hard)이라 나이트 전담 2명만으로는 N을 다 채우지 못한다."""
    data = sample_data()
    data["constraints"] += [max_nights("mcn", 3), off_after_night("noff", 2), *constraints]
    if rows is not None:
        data["history"] = history(START, rows)
    return ScheduleRequest.model_validate(data)


# 기간(11/1) 직전 28일 = 10/4(일)~10/31(토). 주말은 0, 6, 7, 13, 14, 20, 21, 27번째 칸(8일)
WEEKDAYS_ONLY_N = ["N" if i not in (0, 6, 7, 13, 14, 20, 21, 27) else "O" for i in range(28)]


def objective(req: ScheduleRequest) -> float:
    ctx = build_model(req)
    ctx.model.add_bool_and(list(ctx.hard_literals.values()))
    ctx.model.minimize(sum(ctx.objective_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    assert solver.solve(ctx.model) == cp_model.OPTIMAL
    return solver.objective_value


def weekend_work(req: ScheduleRequest, row: list[str]) -> int:
    return sum(row[d - 1] != "O" for d in range(1, req.period.days + 1) if d in WEEKENDS)


def test_night_history_reduces_nights_this_period():
    nf = [night_fair()]
    before = solve_ok(history_sample(nf))["n03"].count("N")
    after = solve_ok(history_sample(nf, {"n03": ["N"] * 8}))["n03"].count("N")
    assert before >= 1
    assert after < before


def test_night_only_history_is_excluded_from_night_fairness():
    nf = [night_fair()]
    base = objective(history_sample(nf))
    loaded = history_sample(nf, {"n14": WEEKDAYS_ONLY_N[:20]})
    assert objective(loaded) == base
    r = solve(loaded)
    assert isinstance(r, SolveOk)
    assert not any(v.constraint_id == "nf" and "20" in v.detail for v in r.result.soft_violations)


def test_weekend_history_reduces_weekend_work_this_period():
    wf = [weekend_fair()]
    req = history_sample(wf)
    before = weekend_work(req, solve_ok(req)["n03"])
    loaded = history_sample(wf, {"n03": ["D"] * 28})  # 주말 8일 모두 근무
    after = weekend_work(loaded, solve_ok(loaded)["n03"])
    assert before >= 1
    assert after < before


def test_empty_or_zero_history_keeps_objective():
    fair = [night_fair(), weekend_fair()]
    base = objective(history_sample(fair))
    all_off = {f"n{i:02d}": ["O"] * 28 for i in range(1, 16)}
    assert objective(history_sample(fair, {})) == base
    assert objective(history_sample(fair, all_off)) == base


def test_compute_result_fairness_includes_history():
    cons = [night_fair(), weekend_fair()]
    b_row = ["N" if i in (0, 6, 7) else "O" for i in range(28)]  # 주말 나이트 3번
    req = stats_request(cons, history=history(START, {"b": b_row}))
    r = compute_result(req, {"a": A, "b": B, "c": C}, optimal=True)
    # 나이트: a 3, b 0+3 → 편차 0. 주말: a 3, b 0+3, c 6 → 편차 3
    assert [x.constraint_id for x in r.soft_violations] == ["wf"]
    assert "최근 4주 포함" in r.soft_violations[0].detail
    assert "편차 3" in r.soft_violations[0].detail


def test_compute_result_fairness_detail_without_history_unchanged():
    r = compute_result(stats_request([night_fair()]), {"a": A, "b": B, "c": C}, optimal=True)
    assert r.soft_violations[0].detail == "나이트 개수 편차 3"


# --- 성능 ---


def test_sample_ward_31_days_solves_within_10s():
    data = sample_data()
    data["period"] = {"start_date": "2026-12-01", "length": 31}
    data["constraints"] += [
        forbid("fs-nd", "N", "D"),
        forbid("fs-ne", "N", "E"),
        forbid("fs-ed", "E", "D"),
        max_work("mcw", 5),
        max_nights("mcn", 3),
        off_after_night("noff", 2),
        min_off("mdo", 8),
        *[skill_mix(f"sm-{s}", s, 3, 1) for s in "DEN"],
        night_fair(),
        weekend_fair(),
        blocks.pref("p1", "n01", "O", 2, [24, 25]),
        blocks.pref("p2", "n05", "O", 8, weekends_only=True),  # 12월 주말 8일
        blocks.pref("p3", "n11", "N"),
    ]
    req = ScheduleRequest.model_validate(data)

    start = time.monotonic()
    res = solve(req)
    elapsed = time.monotonic() - start
    assert isinstance(res, SolveOk), res
    assert elapsed < 10, elapsed
    assert len(res.result.assignments["n01"]) == 31


def test_sample_ward_31_days_with_history_solves_within_10s():
    data = sample_data()
    data["period"] = {"start_date": "2026-12-01", "length": 31}
    data["constraints"] += [
        max_nights("mcn", 3),
        off_after_night("noff", 2),
        min_off("mdo", 8),
        *[skill_mix(f"sm-{s}", s, 3, 1) for s in "DEN"],
        night_fair(),
        weekend_fair(),
    ]
    data["history"] = history("2026-12-01", {f"n{i:02d}": ["N"] * (i % 9) + ["D", "O"] * (i % 5) for i in range(1, 16)})
    req = ScheduleRequest.model_validate(data)

    start = time.monotonic()
    res = solve(req)
    elapsed = time.monotonic() - start
    assert isinstance(res, SolveOk), res
    assert elapsed < 10, elapsed
