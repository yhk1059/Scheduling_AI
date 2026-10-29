"""블록 3종(count·sequence·balance) 솔버 경로와 대상 고르기(select.py), 블록 위반 계산(ADR-018, 설계 §3)."""

from backend.domain.models import Days, People, ScheduleRequest, Shifts, SolveInfeasible, SolveOk, WardConfig
from backend.gen_golden import solve_case
from backend.solver import select
from backend.solver.conflicts import find_conflicts
from backend.solver.model import build_model, solve
from backend.solver.stats import compute_result, violations

MONDAY = "2026-11-02"  # 11/2 월요일: 7일이면 6, 7일이 토·일


def shift(code: str, name: str, hours: float = 8, parts: list[str] | None = None, active: bool = True) -> dict:
    return {"code": code, "name": name, "hours": hours, "parts": parts or [], "active": active}


BASE_SHIFTS = [shift("D", "데이"), shift("E", "이브닝"), shift("N", "나이트"), shift("O", "휴무", 0)]


def config(*extra: dict) -> dict:
    return {"shifts": BASE_SHIFTS[:3] + list(extra) + BASE_SHIFTS[3:]}


def nurse(nid: str, years: int = 5, tags: list[str] | None = None) -> dict:
    return {"id": nid, "name": f"간호사{nid}", "years": years, "tags": tags or []}


def block(cid: str, type_: str, params: dict, hardness: str = "hard", **extra) -> dict:
    return {"id": cid, "type": type_, "scope": "ward", "hardness": hardness, "source_text": cid, "params": params, **extra}


def count(cid: str, shifts: dict, per: str, lo=None, hi=None, hardness: str = "hard", **params) -> dict:
    p = {"shifts": shifts, "per": per, **params}
    if lo is not None:
        p["min"] = lo
    if hi is not None:
        p["max"] = hi
    return block(cid, "count", p, hardness)


def daily(code: str, n: int, **params) -> dict:
    return count(f"cov-{code}", {"in": [code]}, "day", n, n, **params)


def request(nurses: list[dict], constraints: list[dict], length: int = 7, start: str = MONDAY, **extra) -> ScheduleRequest:
    return ScheduleRequest.model_validate({
        "nurses": nurses,
        "period": {"start_date": start, "length": length},
        "constraints": constraints,
        "input_version": 1,
        **extra,
    })


def solve_ok(req: ScheduleRequest) -> dict[str, list[str]]:
    res = solve(req)
    assert isinstance(res, SolveOk), res
    return res.result.assignments


def runs(seq: list[str], pred) -> list[tuple[int, int]]:
    """pred 연속 구간 (시작 인덱스, 길이)."""
    out, start = [], None
    for i, s in enumerate(seq + ["#"]):
        if i < len(seq) and pred(s):
            start = i if start is None else start
        elif start is not None:
            out.append((start, i - start))
            start = None
    return out


# --- select.py ---


def test_people_selector():
    req = request(
        [nurse("a", 1, ["신규"]), nurse("b", 3, ["책임"]), nurse("c", 10, ["책임", "나이트전담"]), nurse("d", 7)],
        [],
    )
    assert select.people(req, People()) == ["a", "b", "c", "d"]
    assert select.people(req, People(ids=["d", "a"])) == ["a", "d"]
    assert select.people(req, People(tags=["책임", "신규"])) == ["a", "b", "c"]
    assert select.people(req, People(tags=["책임"], exclude_tags=["나이트전담"])) == ["b"]
    assert select.people(req, People(min_years=3, max_years=7)) == ["b", "d"]


def test_days_selector():
    req = request([nurse("a")], [], length=14, holidays=[3])  # 11/2 월 ~ 11/15 일, 3일(수) 공휴일
    assert select.days(req, Days()) == list(range(1, 15))
    assert select.days(req, Days(kind="weekend")) == [3, 6, 7, 13, 14]
    assert select.days(req, Days(kind="weekday")) == [1, 2, 4, 5, 8, 9, 10, 11, 12]
    assert select.days(req, Days(kind="holiday")) == [3]
    assert select.days(req, Days(weekdays=[5])) == [6, 13]
    assert select.days(req, Days(kind="weekday", weekdays=[0, 2])) == [1, 8, 10]
    assert select.days(req, Days(kind="weekend", days=[1, 2, 3, 6])) == [3, 6]


def test_matches_uses_covers():
    cfg = WardConfig.model_validate(config(shift("DE", "더블", 16, ["D", "E"]), shift("M", "미드", 8, active=False)))
    assert select.matches(cfg, "DE", Shifts(in_=["D"]))
    assert select.matches(cfg, "D", Shifts(in_=["D"]))
    assert not select.matches(cfg, "D", Shifts(in_=["DE"]))
    assert select.matches(cfg, "DE", Shifts(not_in=["N", "O"]))
    assert not select.matches(cfg, "O", Shifts(not_in=["O"]))
    assert select.codes_matching(cfg, Shifts(in_=["E"])) == ["E", "DE"]
    assert select.codes_matching(cfg, Shifts(not_in=["O"])) == ["D", "E", "N", "DE", "M"]


def test_history_count():
    # 이력 10/5(월)~10/11(일), 10/7(수) 공휴일
    history = {"start_date": "2026-10-05", "rows": {"a": ["N", "N", "D", "O", "E", "N", "D"]}, "holidays": ["2026-10-07"]}
    req = request([nurse("a"), nurse("b")], [], history=history)
    n, work = Shifts(in_=["N"]), Shifts(not_in=["O"])
    assert select.history_count(req, "a", Days(), n, "count") == 3
    assert select.history_count(req, "a", Days(kind="weekend"), work, "count") == 3  # 수(D)·토(N)·일(D)
    assert select.history_count(req, "a", Days(kind="holiday"), work, "count") == 1
    assert select.history_count(req, "a", Days(weekdays=[0]), n, "count") == 1
    assert select.history_count(req, "a", Days(), work, "hours") == 6 * 8 * 60  # 분 단위
    assert select.history_count(req, "a", Days(days=[1, 2]), work, "count") == 0  # 기간 날짜 인덱스는 이력에 없다
    assert select.history_count(req, "b", Days(), work, "count") == 0


# --- 모델 골격 ---


def test_variables_follow_active_codes():
    req = request([nurse("a")], [], length=2, config=config(shift("M", "미드"), shift("X", "옛 근무", active=False)))
    ctx = build_model(req)
    assert {c for (_, _, c) in ctx.x} == {"D", "E", "N", "M", "O"}


def test_match_uses_carry_constants():
    req = request([nurse("a")], [], length=2, carry_over=[{"nurse_id": "a", "shifts": ["N", "D"]}])
    ctx = build_model(req)
    assert ctx.match("a", 0, Shifts(in_=["D"])) == 1
    assert ctx.match("a", -1, Shifts(in_=["D"])) == 0
    assert ctx.match("a", -2, Shifts(in_=["D"])) is None
    assert ctx.minutes("a", 0, Shifts(not_in=["O"])) == 8 * 60


# --- 새 기능 ---


def test_mid_shift_counted_by_coverage_block():
    req = request([nurse(f"n{i}") for i in range(5)], [daily("D", 1), daily("M", 1), daily("N", 1)],
                  config=config(shift("M", "미드")))
    a = solve_ok(req)
    for d in range(7):
        col = [row[d] for row in a.values()]
        assert col.count("M") == col.count("D") == col.count("N") == 1


def test_double_shift_counts_for_both_parts():
    cfg = config(shift("DE", "더블", 16, ["D", "E"]))
    rules = [
        count("cov-D", {"in": ["D"]}, "day", 2, 2),
        count("cov-E", {"in": ["E"]}, "day", 2, 2),
        count("de-max", {"in": ["DE"]}, "person", hi=2),
    ]
    req = request([nurse(f"n{i}") for i in range(3)], rules, length=5, config=cfg)
    a = solve_ok(req)
    for d in range(5):
        col = [row[d] for row in a.values()]
        assert col.count("D") + col.count("DE") == 2
        assert col.count("E") + col.count("DE") == 2
        assert col.count("DE") >= 1  # 3명으로 4자리를 채우려면 더블이 필요하다
    assert all(row.count("DE") <= 2 for row in a.values())
    res = solve(req)
    stats = res.result.stats["n0"]
    assert stats.counts["DE"] == a["n0"].count("DE")
    assert stats.hours == sum({"D": 8, "E": 8, "N": 8, "DE": 16, "O": 0}[s] for s in a["n0"])


def test_week_hours_include_carry():
    # 11/5(목) 시작. 이월 월~수 D 3번(24시간) → 첫 주 목~일에는 근무 3번까지(52시간 이하)
    rules = [
        count("week52", {"not_in": ["O"]}, "person_week", hi=52, measure="hours"),
        count("want-work", {"not_in": ["O"]}, "person", lo=7, hardness="soft"),
    ]
    req = request([nurse("a")], rules, start="2026-11-05", carry_over=[{"nurse_id": "a", "shifts": ["D", "D", "D"]}])
    a = solve_ok(req)["a"]
    assert sum(s != "O" for s in a[:4]) == 3
    assert sum(s != "O" for s in a[4:]) == 3


def test_window_requires_off_day():
    rules = [
        count("off7", {"in": ["O"]}, "person_window", lo=1, window=7),
        count("want-work", {"not_in": ["O"]}, "person", lo=14, hardness="soft"),
    ]
    a = solve_ok(request([nurse("a")], rules, length=14))["a"]
    assert all("O" in a[s:s + 7] for s in range(0, 8))
    # 이월 6일 연속 근무면 첫날은 휴무
    req = request([nurse("a")], rules, length=14, carry_over=[{"nurse_id": "a", "shifts": ["D"] * 6}])
    assert solve_ok(req)["a"][0] == "O"


def test_night_block_min_length():
    rules = [
        daily("N", 1),
        block("n-run", "sequence", {"run": {"in": ["N"]}, "min_len": 2, "max_len": 3}),
    ]
    carry = [{"nurse_id": f"n{i}", "shifts": ["O"]} for i in range(3)]
    a = solve_ok(request([nurse(f"n{i}") for i in range(3)], rules, length=10, carry_over=carry))
    for row in a.values():
        for start, length in runs(row, lambda s: s == "N"):
            assert length <= 3
            if start + length < len(row):  # 기간 끝에 닿은 구간은 제외
                assert length >= 2


def test_off_days_after_night_block():
    rules = [daily("N", 1), block("after-n", "sequence", {"after": {"in": ["N"]}, "then_off": 2})]
    a = solve_ok(request([nurse(f"n{i}") for i in range(4)], rules, length=10))
    for row in a.values():
        for start, length in runs(row, lambda s: s == "N"):
            end = start + length
            assert all(s == "O" for s in row[end:end + 2])


def test_tag_coverage():
    nurses = [nurse("a", tags=["책임"]), nurse("b", tags=["책임"]), nurse("c"), nurse("d"), nurse("e")]
    rules = [daily("D", 1), count("charge-d", {"in": ["D"]}, "day", lo=1, people={"tags": ["책임"]})]
    a = solve_ok(request(nurses, rules))
    for d in range(7):
        assert {nid for nid, row in a.items() if row[d] == "D"} <= {"a", "b"}


def test_hard_balance_max_gap():
    rules = [daily("N", 1), block("n-even", "balance", {"shifts": {"in": ["N"]}, "max_gap": 0}, "hard")]
    a = solve_ok(request([nurse(f"n{i}") for i in range(3)], rules, length=6))
    assert [row.count("N") for row in a.values()] == [2, 2, 2]


def test_weekday_selector_saturday_only():
    rules = [
        count("sat-d", {"in": ["D"]}, "day", 2, 2, days={"weekdays": [5]}),
        count("other-d", {"in": ["D"]}, "day", 1, 1, days={"weekdays": [0, 1, 2, 3, 4, 6]}),
    ]
    a = solve_ok(request([nurse(f"n{i}") for i in range(4)], rules))
    d_counts = [sum(row[d] == "D" for row in a.values()) for d in range(7)]
    assert d_counts == [1, 1, 1, 1, 1, 2, 1]


def test_balance_with_raw_history():
    history = {"start_date": "2026-10-05", "rows": {"a": ["N"] * 4 + ["O"] * 24}, "holidays": []}
    rules = [daily("N", 1), block("n-even", "balance", {"shifts": {"in": ["N"]}}, "soft")]
    a = solve_ok(request([nurse("a"), nurse("b")], rules, length=4, history=history))
    assert a["b"].count("N") == 4
    rules[1]["params"]["with_history"] = False
    a = solve_ok(request([nurse("a"), nurse("b")], rules, length=4, history=history))
    assert a["a"].count("N") == a["b"].count("N") == 2


def test_soft_hours_violation_normalized_by_base_shift():
    # 2일 모두 D(16시간)인데 가능하면 8시간 이하 → 8시간 초과 = 근무 하나 분량 = 위반 1단위 × 보통(10)
    rules = [daily("D", 1), count("hours8", {"not_in": ["O"]}, "person", hi=8, measure="hours", hardness="soft")]
    out = solve_case(request([nurse("a")], rules, length=2))
    assert out["objective"] == 10


def test_infeasible_block_ids_in_core():
    nurses = [nurse("a", tags=["나이트전담"]), nurse("b", tags=["나이트전담"])]
    rules = [
        count("night-only", {"not_in": ["N", "O"]}, "person", hi=0, people={"tags": ["나이트전담"]}),
        daily("D", 1),
        daily("N", 1),
        block("max-n", "sequence", {"run": {"in": ["N"]}, "max_len": 5}),
    ]
    req = request(nurses, rules, length=3)
    assert isinstance(solve(req, analyze_conflicts=False), SolveInfeasible)
    assert {c.constraint_id for c in find_conflicts(req)} == {"night-only", "cov-D"}
    assert {c.type for c in find_conflicts(req)} == {"count"}


# --- 위반 계산(stats.violations) ---


def test_violations_count_per_day_and_person_week():
    req = request([nurse("a"), nurse("b")], [], start="2026-11-05", length=5,  # 목~월
                  carry_over=[{"nurse_id": "a", "shifts": ["D", "D", "D"]}])
    a = {"a": ["D", "D", "D", "O", "D"], "b": ["O", "O", "O", "O", "O"]}
    cov = request([nurse("a"), nurse("b")], [daily("D", 1)], start="2026-11-05", length=5).constraints[0]
    v = violations(req, a, cov)
    assert [x.day for x in v] == [4]
    assert "0명" in v[0].detail and "기준 1" in v[0].detail
    week = request([nurse("a")], [count("w", {"not_in": ["O"]}, "person_week", hi=40, measure="hours")]).constraints[0]
    v = violations(req, a, week)
    assert [(x.nurse_id, x.day) for x in v] == [("a", 1)]  # 첫 주: 이월 24 + 24시간 = 48시간
    assert "48" in v[0].detail


def test_violations_sequence_forbid_three_cells_with_carry():
    rule = request([nurse("a")], [block("f", "sequence", {"forbid": [[{"in": ["N"]}, {"in": ["O"]}, {"in": ["N"]}]]})])
    req = request([nurse("a")], [], length=5, carry_over=[{"nurse_id": "a", "shifts": ["N", "O"]}])
    v = violations(req, {"a": ["N", "O", "N", "D", "D"]}, rule.constraints[0])
    assert [x.day for x in v] == [1, 3]


def test_violations_run_min_and_after():
    req = request([nurse("a")], [], length=7, carry_over=[{"nurse_id": "a", "shifts": ["O"]}])
    row = {"a": ["N", "O", "N", "N", "D", "O", "N"]}
    run = request([nurse("a")], [block("r", "sequence", {"run": {"in": ["N"]}, "min_len": 2})]).constraints[0]
    assert [x.day for x in violations(req, row, run)] == [1]  # 7일 N은 기간 끝에 닿아 제외
    after = request([nurse("a")], [block("af", "sequence", {"after": {"in": ["N"]}, "then_off": 1})]).constraints[0]
    assert [x.day for x in violations(req, row, after)] == [5]


def test_violations_balance_soft_tolerance_and_hard_gap():
    req = request([nurse("a"), nurse("b")], [], length=4)
    a = {"a": ["N", "N", "O", "O"], "b": ["O", "O", "O", "O"]}
    soft = request([nurse("a")], [block("s", "balance", {"shifts": {"in": ["N"]}}, "soft")]).constraints[0]
    hard = request([nurse("a")], [block("h", "balance", {"shifts": {"in": ["N"]}, "max_gap": 1}, "hard")]).constraints[0]
    v = violations(req, a, soft)
    assert len(v) == 1 and v[0].detail == "나이트 개수 편차 2"
    assert len(violations(req, a, hard)) == 1
    a["b"][0] = "N"
    assert violations(req, a, soft) == [] and violations(req, a, hard) == []


# --- 결과 ---


def test_soft_block_violations_listed_and_preferences_counted():
    rules = [
        daily("D", 1),
        count("want-off", {"in": ["O"]}, "person", lo=2, hardness="soft", people={"ids": ["a"]}, days={"days": [1, 2]}),
        count("avoid-d", {"in": ["D"]}, "person", hi=0, hardness="soft", people={"ids": ["a"]}),
    ]
    rules[1]["scope"] = rules[2]["scope"] = "period"
    req = request([nurse("a")], rules, length=3)
    result = compute_result(req, {"a": ["D", "D", "D"]}, optimal=True)
    assert result.summary.preferences_total == 2 + 3
    assert result.summary.preferences_met == 0
    assert {v.constraint_id for v in result.soft_violations} == {"want-off", "avoid-d"}
    assert result.summary.soft_violation_count == len(result.soft_violations)


def test_stats_counts_and_hours_default_config():
    req = request([nurse("a")], [], length=4)
    s = compute_result(req, {"a": ["D", "N", "O", "D"]}, optimal=True).stats["a"]
    assert (s.D, s.E, s.N, s.O) == (2, 0, 1, 1)
    assert s.counts == {"D": 2, "E": 0, "N": 1, "O": 1}
    assert s.hours == 24
