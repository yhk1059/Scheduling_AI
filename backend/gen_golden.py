"""블록화(ADR-018) 전 솔버의 목적값·배정을 골든 케이스로 기록한다. 실행: npm run gen:golden

`--check`는 파일을 쓰지 않고 다시 만들어 기존 cases.json과 비교한다(다르면 exit 1).
feasible 케이스는 모두 OPTIMAL이어야 한다. 아니면 시간 제한을 늘리지 말고 케이스를 줄인다.
"""

import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from ortools.sat.python import cp_model

from backend.domain.constants import HISTORY_DAYS, SOLVE_TIME_LIMIT_S
from backend.domain.models import ScheduleRequest
from backend.solver.conflicts import find_conflicts
from backend.solver.model import SHIFTS, build_model

ROOT = Path(__file__).resolve().parent.parent
WARD = ROOT / "lib" / "samples" / "ward-15.json"
CASES_PATH = ROOT / "backend" / "tests" / "golden" / "cases.json"
MONDAY = "2026-11-02"


# --- 풀이 ---


def solve_case(request: ScheduleRequest, conflicts: bool = True) -> dict[str, Any]:
    """solve()와 같은 방식(hard 리터럴 고정, 단일 워커, 고정 시드)으로 풀어 목적값을 읽는다."""
    ctx = build_model(request)
    ctx.model.add_bool_and(list(ctx.hard_literals.values()))
    if ctx.objective_terms:
        ctx.model.minimize(sum(ctx.objective_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_S
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    status = solver.solve(ctx.model)
    if status == cp_model.OPTIMAL:
        assignments = {
            n.id: [next(s for s in SHIFTS if solver.boolean_value(ctx.x[n.id, d, s])) for d in range(1, ctx.days + 1)]
            for n in request.nurses
        }
        objective = round(solver.objective_value) if ctx.objective_terms else 0
        return {"status": "ok", "optimal": True, "objective": objective, "assignments": assignments}
    if status == cp_model.INFEASIBLE:
        found = find_conflicts(request) if conflicts else []
        return {"status": "infeasible", "conflict_ids": [c.constraint_id for c in found or []]}
    return {"status": solver.status_name(status)}


# --- 케이스 재료 ---


def _c(cid: str, type_: str, params: dict, hardness: str = "hard", scope: str = "ward", **extra) -> dict:
    return {"id": cid, "type": type_, "scope": scope, "hardness": hardness, "source_text": cid, "params": params, **extra}


def _cov(shift: str, kind: str, n: int, hardness: str = "hard") -> dict:
    return _c(f"cov-{kind}-{shift}", "daily_coverage", {"shift": shift, "day_kind": kind, "min": n, "max": n}, hardness)


def _small_coverage(wd: tuple[int, int, int], we: tuple[int, int, int]) -> list[dict]:
    return [_cov(s, "weekday", n) for s, n in zip("DEN", wd)] + [_cov(s, "weekend", n) for s, n in zip("DEN", we)]


def _nurses(years: list[int], night_only: set[int] = frozenset()) -> list[dict]:
    return [
        {"id": f"n{i + 1:02d}", "name": f"간호사{i + 1}", "years": y, "night_only": i in night_only}
        for i, y in enumerate(years)
    ]


def _sample_ward(min_off: int) -> tuple[list[dict], list[dict]]:
    """샘플 병동의 명단과 필요 인원 + 병동 규칙 6개. 최소 휴무는 기간 길이에 맞춰 줄인다(한 달 8일)."""
    ward = json.loads(WARD.read_text(encoding="utf-8"))
    constraints = [dict(c) for c in ward["constraints"]]
    for c in constraints:
        if c["type"] == "min_days_off":
            c["params"] = {"days": min_off}
    return ward["nurses"], constraints


def _carry(nurses: list[dict]) -> list[dict]:
    """7일 이월. 순환 근무 패턴을 간호사마다 밀어서 쓴다(나이트 전담은 N/O만)."""
    rows = []
    for i, n in enumerate(nurses):
        cycle = "NNOONNO" if n["night_only"] else "DDENNOO"
        rows.append({"nurse_id": n["id"], "shifts": [cycle[(i + k) % 7] for k in range(7)]})
    return rows


def _history_raw(nurses: list[dict], start: str, holidays: list[str], seed: int) -> dict:
    """기간 시작 직전 28일의 원본 배정(고정 시드)."""
    rng = random.Random(seed)
    first = date.fromisoformat(start) - timedelta(days=HISTORY_DAYS)
    rows = {}
    for n in nurses:
        pool = ["N", "O", "O"] if n["night_only"] else ["D", "E", "N", "O", "O"]
        rows[n["id"]] = [rng.choice(pool) for _ in range(HISTORY_DAYS)]
    return {"start_date": first.isoformat(), "rows": rows, "holidays": holidays}


def history_load(raw: dict) -> list[dict]:
    """원본에서 누적 부담 계산: 나이트 = N 수, 주말 = 토·일·공휴일의 근무(D/E/N) 수. 둘 다 0이면 뺀다."""
    first = date.fromisoformat(raw["start_date"])
    holidays = set(raw["holidays"])
    out = []
    for nid, row in raw["rows"].items():
        days = [first + timedelta(days=i) for i in range(len(row))]
        nights = sum(s == "N" for s in row)
        weekends = sum(s != "O" and (d.weekday() >= 5 or d.isoformat() in holidays) for d, s in zip(days, row))
        if nights or weekends:
            out.append({"nurse_id": nid, "nights": nights, "weekends": weekends})
    return out


def _request(nurses, start, length, constraints, holidays=(), **extra) -> dict:
    return {
        "nurses": nurses,
        "period": {"start_date": start, "length": length},
        "holidays": list(holidays),
        "constraints": constraints,
        "input_version": 0,
        **extra,
    }


# --- 케이스 ---


def _case_sample_2w() -> dict:
    nurses, constraints = _sample_ward(min_off=4)
    raw = _history_raw(nurses, MONDAY, ["2026-10-09"], seed=1)
    req = _request(
        nurses, MONDAY, 14, constraints, holidays=[3], carry_over=_carry(nurses), history_load=history_load(raw)
    )
    return {
        "id": "sample-2w",
        "description": "샘플 병동 필요 인원 + 병동 규칙 6개(최소 휴무 4일), 2주, 공휴일 1일(수), 이월, 최근 4주 부담",
        "request": req,
        "history_raw": raw,
    }


def _case_sample_1w_requests() -> dict:
    nurses, constraints = _sample_ward(min_off=2)
    requests = [
        _c("req-leave", "leave", {"nurse_id": "n01", "days": [2, 3]}, scope="period"),
        _c(
            "req-avoid-weekend-n",
            "shift_preference",
            {"nurse_id": "n02", "shift": "N", "prefer": False, "weekends_only": True},
            "soft",
            "period",
        ),
        _c("req-want-d", "shift_preference", {"nurse_id": "n04", "shift": "D", "prefer": True, "days": [4]}, "soft", "period"),
        _c("req-fixed", "fixed_assignment", {"nurse_id": "n03", "day": 1, "shift": "E"}, scope="period"),
    ]
    return {
        "id": "sample-1w-requests",
        "description": "샘플 병동(최소 휴무 2일), 1주, 요청: 휴가·주말 나이트 기피·특정일 데이 희망·고정 배정",
        "request": _request(nurses, MONDAY, 7, constraints + requests),
        "history_raw": None,
    }


def _case_soft_a() -> dict:
    nurses = _nurses([10, 7, 5, 3, 2, 1, 1])
    constraints = _small_coverage((2, 2, 1), (1, 1, 1))
    constraints[0] = _c("cov-weekday-D", "daily_coverage", {"shift": "D", "day_kind": "weekday", "min": 3, "max": 3}, "soft")
    constraints += [
        _c("seq-n-d", "forbidden_sequence", {"first": "N", "second": "D"}, "soft"),
        _c("max-work", "max_consecutive_work", {"days": 3}, "soft"),
        _c("max-nights", "max_consecutive_nights", {"days": 1}, "soft"),
    ]
    return {
        "id": "soft-a",
        "description": "7명 7일: 필요 인원(평일 데이 3명)·금지 순서 N→D·최대 연속 근무 3일·최대 연속 나이트 1일을 가능하면으로",
        "request": _request(nurses, MONDAY, 7, constraints),
        "history_raw": None,
    }


def _case_soft_b() -> dict:
    nurses = _nurses([10, 7, 5, 3, 2, 1, 1])
    constraints = _small_coverage((2, 2, 1), (1, 1, 1)) + [
        _c("min-off", "min_days_off", {"days": 3}, "soft"),
        _c("off-after-n", "off_after_night_block", {"days": 2}, "soft"),
        _c("skill-d", "skill_mix", {"shift": "D", "min_years": 5, "min_count": 2}, "soft"),
    ]
    return {
        "id": "soft-b",
        "description": "7명 5일(평일만): 최소 휴무 3일·나이트 후 휴무 2일·데이 5년차 이상 2명을 가능하면으로",
        "request": _request(nurses, MONDAY, 5, constraints),
        "history_raw": None,
    }


def _case_night_only_rules() -> dict:
    nurses = _nurses([12, 8, 6, 4, 3, 2, 1, 9], night_only={7})
    constraints = _small_coverage((2, 2, 1), (2, 1, 1)) + [
        _c("seq-n-d", "forbidden_sequence", {"first": "N", "second": "D"}),
        _c("off-after-n", "off_after_night_block", {"days": 2}),
        _c("skill-e", "skill_mix", {"shift": "E", "min_years": 4, "min_count": 1}),
        _c("min-off", "min_days_off", {"days": 3}),
        _c("max-work", "max_consecutive_work", {"days": 5}),
        _c("max-nights", "max_consecutive_nights", {"days": 3}),
        _c("night-fair", "night_fairness", {}, "soft", weight=5),
    ]
    return {
        "id": "night-only-rules",
        "description": "8명(나이트 전담 1명) 10일: 금지 순서 N→D, 나이트 후 휴무 2일, 이브닝 4년차 이상 1명, 최소 휴무 3일",
        "request": _request(nurses, MONDAY, 10, constraints),
        "history_raw": None,
    }


def _case_weekday_holiday() -> dict:
    nurses = _nurses([10, 7, 5, 3, 2, 1, 1])
    constraints = _small_coverage((2, 2, 1), (1, 1, 1)) + [
        _c("weekend-fair", "weekend_fairness", {}, "soft", weight=5),
        _c(
            "req-off-weekend",
            "shift_preference",
            {"nurse_id": "n01", "shift": "O", "prefer": True, "weekends_only": True},
            "soft",
            "period",
        ),
    ]
    return {
        "id": "weekday-holiday",
        "description": "7명 7일, 수요일(3일) 공휴일: 주말 판정 = 토·일 ∪ 공휴일. 주말 고르게, 주말 휴무 희망",
        "request": _request(nurses, MONDAY, 7, constraints, holidays=[3]),
        "history_raw": None,
    }


def _case_reschedule() -> dict:
    nurses = _nurses([10, 7, 5, 3, 2, 1, 1])
    base = _small_coverage((2, 2, 1), (1, 1, 1)) + [_c("max-work", "max_consecutive_work", {"days": 5})]
    prev = solve_case(ScheduleRequest.model_validate(_request(nurses, MONDAY, 7, base)), conflicts=False)
    if prev["status"] != "ok":
        raise SystemExit(f"reschedule 기준 근무표를 풀지 못했습니다({prev['status']})")
    # 이전 근무표에서 3~5일 근무가 가장 많은 간호사가 그 사흘 병가
    nid = max(prev["assignments"], key=lambda k: sum(s != "O" for s in prev["assignments"][k][2:5]))
    sick = _c("req-sick", "leave", {"nurse_id": nid, "days": [3, 4, 5]}, scope="period")
    return {
        "id": "reschedule",
        "description": "7명 7일 재스케줄: 이전 근무표(previous) + 병가 3일, 바뀐 칸마다 DIFF_WEIGHT",
        "request": _request(nurses, MONDAY, 7, base + [sick], previous=prev["assignments"]),
        "history_raw": None,
    }


def _case_infeasible_leaves() -> dict:
    nurses = _nurses([10, 7, 5, 3, 2, 1])
    constraints = _small_coverage((2, 2, 1), (1, 1, 1)) + [
        _c("req-leave-1", "leave", {"nurse_id": "n01", "days": [3]}, scope="period"),
        _c("req-leave-2", "leave", {"nurse_id": "n02", "days": [3]}, scope="period"),
    ]
    return {
        "id": "infeasible-leaves",
        "description": "6명 7일: 수요일 휴가 2건이 겹쳐 평일 필요 인원 5명을 못 채움",
        "request": _request(nurses, MONDAY, 7, constraints),
        "history_raw": None,
    }


def _case_infeasible_night_only() -> dict:
    nurses = _nurses([10, 7, 5, 3], night_only={2, 3})
    constraints = [_cov("D", "weekday", 1), _cov("E", "weekday", 1), _cov("N", "weekday", 1)]
    constraints.append(_c("req-leave", "leave", {"nurse_id": "n01", "days": [2]}, scope="period"))
    return {
        "id": "infeasible-night-only",
        "description": "4명(나이트 전담 2명) 5일: 일반 간호사 1명이 휴가라 데이·이브닝을 채울 사람이 없음",
        "request": _request(nurses, MONDAY, 5, constraints),
        "history_raw": None,
    }


CASE_BUILDERS = [
    _case_sample_2w,
    _case_sample_1w_requests,
    _case_soft_a,
    _case_soft_b,
    _case_night_only_rules,
    _case_weekday_holiday,
    _case_reschedule,
    _case_infeasible_leaves,
    _case_infeasible_night_only,
]


def build_cases() -> list[dict]:
    cases = []
    for build in CASE_BUILDERS:
        case = build()
        out = solve_case(ScheduleRequest.model_validate(case["request"]))
        if out["status"] not in ("ok", "infeasible"):
            raise SystemExit(f"{case['id']}: 최적해를 증명하지 못했습니다({out['status']}). 케이스를 줄이세요")
        cases.append({**case, **out})
    return cases


def render(cases: list[dict]) -> str:
    return json.dumps(cases, ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    text = render(build_cases())
    if "--check" in sys.argv[1:]:
        if not CASES_PATH.exists() or CASES_PATH.read_text(encoding="utf-8") != text:
            print(f"{CASES_PATH.relative_to(ROOT)}가 지금 솔버 결과와 다릅니다", file=sys.stderr)
            sys.exit(1)
        print("golden cases ok")
        return
    CASES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CASES_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {CASES_PATH.relative_to(ROOT)} ({len(json.loads(text))} cases)")


if __name__ == "__main__":
    main()
