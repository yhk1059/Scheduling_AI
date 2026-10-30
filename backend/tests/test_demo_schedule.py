"""샘플 데모 근무표(lib/samples/demo-schedule.json): 샘플 매장의 고정된 한 달을 매장 규칙대로 풀어 둔 것(ADR-016)."""

import json
from pathlib import Path

from backend.domain.models import ScheduleRequest, SolveOk
from backend.gen_demo import DEMO_PERIOD, demo_request
from backend.solver.model import solve

ROOT = Path(__file__).resolve().parents[2]
SHOP = json.loads((ROOT / "lib" / "samples" / "shop-12.json").read_text(encoding="utf-8"))
DEMO = json.loads((ROOT / "lib" / "samples" / "demo-schedule.json").read_text(encoding="utf-8"))


def _assignments() -> dict[str, list[str]]:
    return DEMO["result"]["assignments"]


def _max_run(row: list[str]) -> int:
    best = run = 0
    for s in row:
        run = run + 1 if s != "O" else 0
        best = max(best, run)
    return best


def test_sample_shop_rules():
    """샘플 매장 파일(lib/samples)은 식 규칙이다. 필요 인원은 기본 규칙."""
    rules = {c["id"]: c for c in SHOP["constraints"] if not c["id"].startswith("cov-")}
    assert all(c["scope"] == "shop" and c["type"] == "rule" for c in SHOP["constraints"])
    assert all(c["default"] for c in SHOP["constraints"] if c["id"].startswith("cov-"))
    assert {cid: (c["hardness"], c["default"]) for cid, c in rules.items()} == {
        "rule-no-close-open": ("hard", False),
        "rule-max-run": ("hard", False),
        "rule-week-hours": ("hard", False),
        "rule-week-off": ("hard", False),
        "rule-leader-open": ("hard", False),
        "rule-close-fair": ("soft", False),
        "rule-weekend-fair": ("soft", False),
    }
    assert rules["rule-max-run"]["values"]["max_len"]["value"] == 5
    assert rules["rule-week-hours"]["values"]["max"]["value"] == 40
    assert rules["rule-week-off"]["values"]["min"]["value"] == 2


def test_sample_shop_roster_and_coverage():
    """D1 명단(12명, 리더 3명, 신입 2명)과 D2 필요 인원."""
    tagged = {t: [n["name"] for n in SHOP["employees"] if t in n["tags"]] for t in ("리더", "신입")}
    assert len(SHOP["employees"]) == 12
    assert tagged == {"리더": ["이영희", "강서연", "윤지민"], "신입": ["서예린", "신도윤"]}
    cov = {c["id"]: {k: v["value"] for k, v in c["values"].items()} for c in SHOP["constraints"] if c["id"].startswith("cov-")}
    assert cov == {
        "cov-weekday-A": {"min": 1, "max": 2},
        "cov-weekday-M": {"min": 1, "max": 2},
        "cov-weekday-C": {"min": 3},
        "cov-weekend-A": {"min": 2},
        "cov-weekend-M": {"min": 2},
        "cov-weekend-C": {"min": 3},
    }


def test_demo_request_uses_shop_rules_only():
    """샘플 매장 규칙을 그대로 쓴다."""
    req = demo_request()
    assert req.period.model_dump(mode="json") == DEMO_PERIOD
    assert req.holidays == [] and req.carry_over == [] and req.previous is None
    assert [c.id for c in req.constraints] == [c["id"] for c in SHOP["constraints"]]
    assert {c.type for c in req.constraints} == {"rule"}


def test_file_records_period():
    assert DEMO["period"] == DEMO_PERIOD


def test_schedule_shape():
    a = _assignments()
    assert sorted(a) == sorted(n["id"] for n in SHOP["employees"])
    assert all(len(row) == DEMO_PERIOD["length"] for row in a.values())


def test_everyone_gets_days_off():
    a = _assignments()
    for nid, row in a.items():
        assert row.count("O") >= 8, nid  # 4주 × 주 2일
        assert _max_run(row) <= 5, nid


def test_schedule_satisfies_shop_rules():
    """모든 칸을 고정 배정으로 걸고 다시 풀어도 해가 있다 = 필요 인원과 hard 규칙을 모두 지킨다."""
    fixed = [
        {"id": f"fx-{nid}-{d}", "type": "fixed_assignment", "scope": "period", "source_text": "데모",
         "params": {"employee_id": nid, "day": d, "shift": s}}
        for nid, row in _assignments().items()
        for d, s in enumerate(row, start=1)
    ]
    data = demo_request().model_dump(mode="json")
    data["constraints"] += fixed
    assert isinstance(solve(ScheduleRequest.model_validate(data), analyze_conflicts=False), SolveOk)


def test_schedule_is_within_coverage_and_rules():
    a = _assignments()
    for d in range(DEMO_PERIOD["length"]):
        day = [row[d] for row in a.values()]
        weekend = d % 7 >= 5  # 월요일 시작
        assert day.count("C") == 3
        assert (day.count("A"), day.count("M")) == (2, 2) if weekend else 1 <= day.count("A") <= 2 and 1 <= day.count("M") <= 2
    for nid, row in a.items():
        assert all(not (x == "C" and y == "A") for x, y in zip(row, row[1:])), nid
    leaders = [n["id"] for n in SHOP["employees"] if "리더" in n["tags"]]
    assert all(any(a[nid][d] == "A" for nid in leaders) for d in range(DEMO_PERIOD["length"]))


def test_stats_match_assignments():
    stats = DEMO["result"]["stats"]
    for nid, row in _assignments().items():
        assert stats[nid]["max_consecutive_work"] == _max_run(row)

