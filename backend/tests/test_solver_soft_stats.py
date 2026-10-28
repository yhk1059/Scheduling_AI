"""soft 제약, 목적함수, compute_result(요약·통계)."""

import time

from ortools.sat.python import cp_model

from backend.domain.models import ScheduleRequest, SolveOk
from backend.solver.model import build_model, solve
from backend.solver.stats import compute_result
from backend.tests.test_solver_hard import WEEKENDS, con, coverage, nurse, request, sample_data, solve_ok


def pref(cid: str, nid: str, shift: str, prefer: bool, days: list[int] | None = None,
         weekends_only: bool = False, **extra) -> dict:
    return con(cid, "shift_preference", {"nurse_id": nid, "shift": shift, "prefer": prefer,
                                         "days": days, "weekends_only": weekends_only}, **extra)


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
                               con("nf", "night_fairness", {}),
                               coverage("D", "weekday", 1, 1, hardness="soft")])
    assert build_model(req).hard_literals == {}


def test_night_fairness_reduces_or_keeps_spread():
    nurses = [nurse(f"n{i}") for i in range(1, 6)] + [nurse("n6", night_only=True)]
    base = [coverage("N", k, 2, 2) for k in ("weekday", "weekend")]
    regular = [f"n{i}" for i in range(1, 6)]

    without = solve_ok(request(nurses, base))
    with_fair = solve_ok(request(nurses, base + [con("nf", "night_fairness", {})]))
    assert night_spread(with_fair, regular) <= night_spread(without, regular)
    assert night_spread(with_fair, regular) <= 1


def test_weekend_fairness_balances_weekend_work():
    base = [coverage(s, "weekend", 1, 1) for s in "DEN"]
    a = solve_ok(request(constraints=base + [con("wf", "weekend_fairness", {})]))
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
    cons.append(con("mcw", "max_consecutive_work", {"days": 3}, hardness="soft"))
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
    return request([nurse("a"), nurse("b"), nurse("c", night_only=True)], constraints, **extra)


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
    assert (sa.D, sa.E, sa.N, sa.O) == (11, 4, 3, 12)
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


def test_compute_result_soft_violations_for_toggled_templates():
    cons = [
        con("mcw", "max_consecutive_work", {"days": 5}, hardness="soft"),
        con("mcw-hard", "max_consecutive_work", {"days": 5}),  # hard는 나열하지 않는다
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
    cons = [con("nf", "night_fairness", {}), con("wf", "weekend_fairness", {})]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    ids = [x.constraint_id for x in r.soft_violations]
    # 비전담 a(N 3), b(N 0) → 편차 3. 주말 근무 a 3, b 0, c 6 → 편차 6
    assert ids.count("nf") == 1 and ids.count("wf") == 1


def test_compute_result_disabled_soft_not_listed():
    cons = [con("nf", "night_fairness", {}, enabled=False)]
    r = compute_result(stats_request(cons), {"a": A, "b": B, "c": C}, optimal=True)
    assert r.soft_violations == []


# --- 누적 부담(history_load) ---


def history_sample(constraints: list[dict], history: list[dict] | None = None) -> ScheduleRequest:
    """15명 샘플 병동. N 연속 3일 + N-OFF 2일(hard)이라 나이트 전담 2명만으로는 N을 다 채우지 못한다."""
    data = sample_data()
    data["constraints"] += [
        con("mcn", "max_consecutive_nights", {"days": 3}),
        con("noff", "off_after_night_block", {"days": 2}),
        *constraints,
    ]
    data["history_load"] = history or []
    return ScheduleRequest.model_validate(data)


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
    nf = [con("nf", "night_fairness", {})]
    before = solve_ok(history_sample(nf))["n03"].count("N")
    after = solve_ok(history_sample(nf, [{"nurse_id": "n03", "nights": 8, "weekends": 0}]))["n03"].count("N")
    assert before >= 1
    assert after < before


def test_night_only_history_is_excluded_from_night_fairness():
    nf = [con("nf", "night_fairness", {})]
    base = objective(history_sample(nf))
    loaded = history_sample(nf, [{"nurse_id": "n14", "nights": 20, "weekends": 0}])
    assert objective(loaded) == base
    r = solve(loaded)
    assert isinstance(r, SolveOk)
    assert not any(v.constraint_id == "nf" and "20" in v.detail for v in r.result.soft_violations)


def test_weekend_history_reduces_weekend_work_this_period():
    wf = [con("wf", "weekend_fairness", {})]
    req = history_sample(wf)
    before = weekend_work(req, solve_ok(req)["n03"])
    loaded = history_sample(wf, [{"nurse_id": "n03", "nights": 0, "weekends": 8}])
    after = weekend_work(loaded, solve_ok(loaded)["n03"])
    assert before >= 1
    assert after < before


def test_empty_or_zero_history_keeps_objective():
    fair = [con("nf", "night_fairness", {}), con("wf", "weekend_fairness", {})]
    base = objective(history_sample(fair))
    zeros = [{"nurse_id": f"n{i:02d}", "nights": 0, "weekends": 0} for i in range(1, 16)]
    assert objective(history_sample(fair, zeros)) == base


def test_compute_result_fairness_includes_history():
    cons = [con("nf", "night_fairness", {}), con("wf", "weekend_fairness", {})]
    history = [{"nurse_id": "b", "nights": 3, "weekends": 3}]
    r = compute_result(stats_request(cons, history_load=history), {"a": A, "b": B, "c": C}, optimal=True)
    # 나이트: a 3, b 0+3 → 편차 0. 주말: a 3, b 0+3, c 6 → 편차 3
    assert [x.constraint_id for x in r.soft_violations] == ["wf"]
    assert "최근 4주 포함" in r.soft_violations[0].detail
    assert "편차 3" in r.soft_violations[0].detail


def test_compute_result_fairness_detail_without_history_unchanged():
    r = compute_result(stats_request([con("nf", "night_fairness", {})]), {"a": A, "b": B, "c": C}, optimal=True)
    assert r.soft_violations[0].detail == "나이트 개수 편차 3"


# --- 성능 ---


def test_sample_ward_31_days_solves_within_10s():
    data = sample_data()
    data["period"] = {"start_date": "2026-12-01", "length": 31}
    data["constraints"] += [
        con("fs-nd", "forbidden_sequence", {"first": "N", "second": "D"}),
        con("fs-ne", "forbidden_sequence", {"first": "N", "second": "E"}),
        con("fs-ed", "forbidden_sequence", {"first": "E", "second": "D"}),
        con("mcw", "max_consecutive_work", {"days": 5}),
        con("mcn", "max_consecutive_nights", {"days": 3}),
        con("noff", "off_after_night_block", {"days": 2}),
        con("mdo", "min_days_off", {"days": 8}),
        *[con(f"sm-{s}", "skill_mix", {"shift": s, "min_years": 3, "min_count": 1}) for s in "DEN"],
        con("nf", "night_fairness", {}),
        con("wf", "weekend_fairness", {}),
        pref("p1", "n01", "O", True, [24, 25]),
        pref("p2", "n05", "O", True, None, weekends_only=True),
        pref("p3", "n11", "N", False),
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
        con("mcn", "max_consecutive_nights", {"days": 3}),
        con("noff", "off_after_night_block", {"days": 2}),
        con("mdo", "min_days_off", {"days": 8}),
        *[con(f"sm-{s}", "skill_mix", {"shift": s, "min_years": 3, "min_count": 1}) for s in "DEN"],
        con("nf", "night_fairness", {}),
        con("wf", "weekend_fairness", {}),
    ]
    data["history_load"] = [{"nurse_id": f"n{i:02d}", "nights": i % 9, "weekends": (i * 3) % 8}
                            for i in range(1, 16)]
    req = ScheduleRequest.model_validate(data)

    start = time.monotonic()
    res = solve(req)
    elapsed = time.monotonic() - start
    assert isinstance(res, SolveOk), res
    assert elapsed < 10, elapsed
