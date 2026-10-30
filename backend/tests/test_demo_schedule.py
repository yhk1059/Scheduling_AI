"""샘플 데모 근무표(lib/samples/demo-schedule.json): 샘플 병동의 고정된 한 달을 병동 규칙대로 풀어 둔 것(ADR-016)."""

import json
from pathlib import Path

from backend.domain.models import ScheduleRequest, SolveOk
from backend.gen_demo import DEMO_PERIOD, demo_request
from backend.solver.model import solve

ROOT = Path(__file__).resolve().parents[2]
WARD = json.loads((ROOT / "lib" / "samples" / "ward-15.json").read_text(encoding="utf-8"))
DEMO = json.loads((ROOT / "lib" / "samples" / "demo-schedule.json").read_text(encoding="utf-8"))


def _assignments() -> dict[str, list[str]]:
    return DEMO["result"]["assignments"]


def _max_run(row: list[str]) -> int:
    best = run = 0
    for s in row:
        run = run + 1 if s != "O" else 0
        best = max(best, run)
    return best


def test_sample_ward_rules():
    """샘플 병동 파일(lib/samples)은 식 규칙이다. 필요 인원은 기본 규칙."""
    rules = {c["id"]: c for c in WARD["constraints"] if not c["id"].startswith("cov-")}
    assert all(c["scope"] == "ward" and c["type"] == "rule" for c in WARD["constraints"])
    assert all(c["default"] for c in WARD["constraints"] if c["id"].startswith("cov-"))
    assert {cid: (c["hardness"], c["default"]) for cid, c in rules.items()} == {
        "rule-noff": ("hard", False),
        "rule-max-work": ("hard", False),
        "rule-max-nights": ("hard", False),
        "rule-min-off": ("hard", False),
        "rule-night-fair": ("soft", False),
        "rule-weekend-fair": ("soft", False),
    }
    assert rules["rule-max-work"]["values"]["max_len"]["value"] == 5
    assert rules["rule-max-nights"]["values"]["max_len"]["value"] == 3
    assert rules["rule-min-off"]["values"]["min"]["value"] == 8


def test_demo_request_uses_ward_rules_only():
    """샘플 병동 규칙을 그대로 쓴다."""
    req = demo_request()
    assert req.period.model_dump(mode="json") == DEMO_PERIOD
    assert req.holidays == [] and req.carry_over == [] and req.previous is None
    assert [c.id for c in req.constraints] == [c["id"] for c in WARD["constraints"]]
    assert {c.type for c in req.constraints} == {"rule"}


def test_file_records_period():
    assert DEMO["period"] == DEMO_PERIOD


def test_schedule_shape():
    a = _assignments()
    assert sorted(a) == sorted(n["id"] for n in WARD["nurses"])
    assert all(len(row) == DEMO_PERIOD["length"] for row in a.values())


def test_everyone_gets_days_off():
    a = _assignments()
    for nid, row in a.items():
        assert row.count("O") >= 8, nid
        assert _max_run(row) <= 5, nid


def test_schedule_satisfies_ward_rules():
    """모든 칸을 고정 배정으로 걸고 다시 풀어도 해가 있다 = 필요 인원과 hard 규칙을 모두 지킨다."""
    fixed = [
        {"id": f"fx-{nid}-{d}", "type": "fixed_assignment", "scope": "period", "source_text": "데모",
         "params": {"nurse_id": nid, "day": d, "shift": s}}
        for nid, row in _assignments().items()
        for d, s in enumerate(row, start=1)
    ]
    data = demo_request().model_dump(mode="json")
    data["constraints"] += fixed
    assert isinstance(solve(ScheduleRequest.model_validate(data), analyze_conflicts=False), SolveOk)


def test_stats_match_assignments():
    stats = DEMO["result"]["stats"]
    for nid, row in _assignments().items():
        assert stats[nid]["max_consecutive_work"] == _max_run(row)

