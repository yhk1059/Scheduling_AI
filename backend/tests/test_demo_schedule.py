"""샘플 데모 근무표(lib/samples/demo-schedule.json): 샘플 병동의 고정된 한 달을 병동 규칙대로 풀어 둔 것(ADR-016)."""

import json
from pathlib import Path

from backend.domain.models import ScheduleRequest, ScheduleResult, SolveOk
from backend.gen_demo import DEMO_PERIOD, demo_request
from backend.solver.model import solve

ROOT = Path(__file__).resolve().parents[2]
WARD = json.loads((ROOT / "lib" / "samples" / "ward-15.json").read_text(encoding="utf-8"))
DEMO = json.loads((ROOT / "lib" / "samples" / "demo-schedule.json").read_text(encoding="utf-8"))
NIGHT_ONLY = {n["id"] for n in WARD["nurses"] if n["night_only"]}


def _result() -> ScheduleResult:
    return ScheduleResult.model_validate(DEMO["result"])


def _max_run(row: list[str]) -> int:
    best = run = 0
    for s in row:
        run = run + 1 if s != "O" else 0
        best = max(best, run)
    return best


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


def test_demo_request_uses_ward_rules_only():
    req = demo_request()
    assert req.period.model_dump(mode="json") == DEMO_PERIOD
    assert req.holidays == [] and req.carry_over == [] and req.previous is None
    assert [c.id for c in req.constraints] == [c["id"] for c in WARD["constraints"]]


def test_file_records_period():
    assert DEMO["period"] == DEMO_PERIOD


def test_schedule_shape():
    a = _result().assignments
    assert sorted(a) == sorted(n["id"] for n in WARD["nurses"])
    assert all(len(row) == DEMO_PERIOD["length"] for row in a.values())


def test_night_only_gets_days_off():
    a = _result().assignments
    for nid, row in a.items():
        assert row.count("O") >= 8, nid
        assert _max_run(row) <= 5, nid
    for nid in NIGHT_ONLY:
        assert set(a[nid]) <= {"N", "O"}


def test_schedule_satisfies_ward_rules():
    """모든 칸을 고정 배정으로 걸고 다시 풀어도 해가 있다 = 필요 인원과 hard 규칙을 모두 지킨다."""
    fixed = [
        {"id": f"fx-{nid}-{d}", "type": "fixed_assignment", "scope": "period", "source_text": "데모",
         "params": {"nurse_id": nid, "day": d, "shift": s}}
        for nid, row in _result().assignments.items()
        for d, s in enumerate(row, start=1)
    ]
    data = demo_request().model_dump(mode="json")
    data["constraints"] += fixed
    assert isinstance(solve(ScheduleRequest.model_validate(data), analyze_conflicts=False), SolveOk)


def test_stats_match_assignments():
    result = _result()
    for nid, row in result.assignments.items():
        st = result.stats[nid]
        assert (st.D, st.E, st.N, st.O) == tuple(row.count(s) for s in "DENO")
        assert st.max_consecutive_work == _max_run(row)
