"""샘플 확정 근무표(lib/samples/confirmed-schedules.json): 달 모양 28개가 모두 있고 샘플 병동 규칙을 지킨다."""

import json
from pathlib import Path

import pytest

from backend.domain.models import Period, ScheduleRequest, ScheduleResult, SolveOk
from backend.gen_sample import LENGTHS, sample_request, start_date_for
from backend.solver.model import solve

ROOT = Path(__file__).resolve().parents[2]
WARD = json.loads((ROOT / "lib" / "samples" / "ward-15.json").read_text(encoding="utf-8"))
SCHEDULES = json.loads((ROOT / "lib" / "samples" / "confirmed-schedules.json").read_text(encoding="utf-8"))
KEYS = [f"{length}-{weekday}" for length in LENGTHS for weekday in range(7)]
NIGHT_ONLY = {n["id"] for n in WARD["nurses"] if n["night_only"]}


def _result(key: str) -> ScheduleResult:
    return ScheduleResult.model_validate(SCHEDULES[key])


def _max_run(row: list[str]) -> int:
    best = run = 0
    for s in row:
        run = run + 1 if s != "O" else 0
        best = max(best, run)
    return best


# --- 샘플 병동 ---


def test_sample_ward_rules():
    rules = {c["type"]: c for c in WARD["constraints"] if c["type"] != "daily_coverage"}
    assert all(c["scope"] == "ward" for c in WARD["constraints"])
    assert {t: (c["hardness"], c["params"].get("days")) for t, c in rules.items()} == {
        "off_after_night_block": ("hard", 1),
        "max_consecutive_work": ("hard", 5),
        "max_consecutive_nights": ("hard", 3),
        "min_days_off": ("hard", 8),
        "night_fairness": ("soft", None),
        "weekend_fairness": ("soft", None),
    }


def test_next_requests_are_valid_for_shortest_period():
    reqs = WARD["next_requests"]
    assert len(reqs) == 3 and all(c["scope"] == "period" for c in reqs)
    assert {c["type"] for c in reqs} == {"leave", "shift_preference"}
    data = {k: v for k, v in WARD.items() if k != "next_requests"}
    data["period"] = {"start_date": "2027-02-01", "length": 28}
    data["constraints"] = WARD["constraints"] + reqs
    req = ScheduleRequest.model_validate(data)  # 참조 무결성: 날짜 1..28, 명단 안의 간호사
    assert isinstance(solve(req, analyze_conflicts=False), SolveOk)


# --- 달 모양 ---


@pytest.mark.parametrize("length", LENGTHS)
@pytest.mark.parametrize("weekday", range(7))
def test_start_date_matches_shape(length, weekday):
    period = Period(start_date=start_date_for(length, weekday), length=length)
    assert period.start_date.day == 1 and period.weekday(1) == weekday
    assert period.date_of(length).month == period.start_date.month
    assert period.date_of(length + 1).day == 1


def test_sample_request_uses_ward_rules_only():
    req = sample_request(30, 6)
    assert req.period.length == 30 and req.period.weekday(1) == 6
    assert req.holidays == [] and req.carry_over == [] and req.previous is None
    assert [c.id for c in req.constraints] == [c["id"] for c in WARD["constraints"]]


def test_deterministic_solve_repeats():
    req = sample_request(31, 3)
    first, second = (solve(req, analyze_conflicts=False, deterministic=True) for _ in range(2))
    assert isinstance(first, SolveOk) and first.result.optimal
    assert first == second


# --- 확정 근무표 ---


def test_all_shapes_present():
    assert sorted(SCHEDULES) == sorted(KEYS)


@pytest.mark.parametrize("key", KEYS)
def test_schedule_shape(key):
    length = int(key.split("-")[0])
    a = _result(key).assignments
    assert sorted(a) == sorted(n["id"] for n in WARD["nurses"])
    assert all(len(row) == length for row in a.values())


@pytest.mark.parametrize("key", KEYS)
def test_night_only_gets_days_off(key):
    """UX 점검 회귀: 나이트 전담이 기간 내내 나이트, 휴무 0일이던 문제."""
    a = _result(key).assignments
    for nid, row in a.items():
        assert row.count("O") >= 8, nid
        assert _max_run(row) <= 5, nid
    for nid in NIGHT_ONLY:
        assert set(a[nid]) <= {"N", "O"}


@pytest.mark.parametrize("key", KEYS)
def test_schedule_satisfies_ward_rules(key):
    """모든 칸을 고정 배정으로 걸고 다시 풀어도 해가 있다 = 필요 인원과 hard 규칙을 모두 지킨다."""
    length, weekday = map(int, key.split("-"))
    req = sample_request(length, weekday)
    fixed = [
        {"id": f"fx-{nid}-{d}", "type": "fixed_assignment", "scope": "period", "source_text": "샘플",
         "params": {"nurse_id": nid, "day": d, "shift": s}}
        for nid, row in _result(key).assignments.items()
        for d, s in enumerate(row, start=1)
    ]
    data = req.model_dump(mode="json")
    data["constraints"] += fixed
    assert isinstance(solve(ScheduleRequest.model_validate(data), analyze_conflicts=False), SolveOk)


def test_stats_match_assignments():
    result = _result("31-3")
    for nid, row in result.assignments.items():
        st = result.stats[nid]
        assert (st.D, st.E, st.N, st.O) == tuple(row.count(s) for s in "DENO")
        assert st.max_consecutive_work == _max_run(row)
