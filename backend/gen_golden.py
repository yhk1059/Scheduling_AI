"""골든 케이스와 변환 픽스처. 실행: npm run gen:golden

cases.json은 블록화(ADR-018) 전 솔버의, blocks-cases.json은 식 언어 전환(ADR-019) 전 블록 솔버의 목적값·배정
기록이다. 요청은 옛 형식(backend/domain/legacy.py)이고 옛 솔버가 없어져 다시 만들지 않는다. 대신 식 규칙으로
바꿔 풀어 기록과 같은지 본다(cases.json은 test_golden, blocks-cases.json은 이 스크립트와 test_golden).
이 스크립트는 convert-cases.json(템플릿 → 블록. TS 변환이 같은 결과를 내야 하는 공유 픽스처)과
expr-convert-cases.json(블록 → 식 변환. TS 변환이 같은 결과를 내야 하는 공유 픽스처)을 쓴다.
`--check`는 파일을 쓰지 않고 다시 만들어 기존 파일과 비교하고, blocks-cases.json의 블록 요청을 식으로 바꿔 푼
결과가 기록과 같은지 본다(다르면 exit 1). 쓰기 모드에서도 blocks-cases.json 비교는 한다.
"""

import json
import sys
from pathlib import Path
from typing import Any

from ortools.sat.python import cp_model
from pydantic import TypeAdapter

from backend.domain.constants import NIGHT_ONLY_TAG, SOLVE_TIME_LIMIT_S
from backend.domain.convert import (
    NIGHT_ONLY_RULE_ID,
    block_to_rules,
    convert_request,
    legacy_to_block,
    night_dedicated_block,
    rules_request,
)
from backend.domain.legacy import BlockScheduleRequest, BlockSpec, LegacyScheduleRequest, LegacySpec
from backend.domain.models import ConstraintSpec, Period, ScheduleRequest
from backend.solver.conflicts import find_conflicts
from backend.solver.model import build_model

ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = ROOT / "backend" / "tests" / "golden" / "cases.json"
CONVERT_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "convert-cases.json"
BLOCKS_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "blocks-cases.json"
EXPR_CONVERT_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "expr-convert-cases.json"


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
            n.id: [next(s for s in ctx.codes if solver.boolean_value(ctx.x[n.id, d, s])) for d in range(1, ctx.days + 1)]
            for n in request.nurses
        }
        objective = round(solver.objective_value) if ctx.objective_terms else 0
        return {"status": "ok", "optimal": True, "objective": objective, "assignments": assignments}
    if status == cp_model.INFEASIBLE:
        found = find_conflicts(request) if conflicts else []
        return {"status": "infeasible", "conflict_ids": [c.constraint_id for c in found or []]}
    return {"status": solver.status_name(status)}


def _c(cid: str, type_: str, params: dict, hardness: str = "hard", scope: str = "ward", **extra) -> dict:
    return {"id": cid, "type": type_, "scope": scope, "hardness": hardness, "source_text": cid, "params": params, **extra}


# --- 변환 픽스처(템플릿 → 블록) ---

_CONVERT_PERIOD = {"start_date": "2026-11-01", "length": 14}  # 11/1 일요일: 주말 1, 7, 8, 14 + 공휴일 3
_CONVERT_HOLIDAYS = [3]
_legacy_adapter = TypeAdapter(LegacySpec)
_block_adapter = TypeAdapter(BlockSpec)
_spec_adapter = TypeAdapter(ConstraintSpec)


def _convert_templates() -> list[tuple[str, dict]]:
    """12종과 반드시/가능하면·옵션 조합. (이름, 템플릿 제약)."""
    out: list[tuple[str, dict]] = []
    toggleable = [
        ("daily_coverage-weekday", "daily_coverage", {"shift": "D", "day_kind": "weekday", "min": 3, "max": 4}),
        ("daily_coverage-weekend", "daily_coverage", {"shift": "N", "day_kind": "weekend", "min": 2, "max": 2}),
        ("forbidden_sequence", "forbidden_sequence", {"first": "N", "second": "D"}),
        ("max_consecutive_work", "max_consecutive_work", {"days": 5}),
        ("max_consecutive_nights", "max_consecutive_nights", {"days": 3}),
        ("min_days_off", "min_days_off", {"days": 8}),
        ("off_after_night_block", "off_after_night_block", {"days": 2}),
        ("skill_mix", "skill_mix", {"shift": "E", "min_years": 3, "min_count": 1}),
    ]
    for name, type_, params in toggleable:
        out.append((f"{name}-hard", _c(name, type_, params)))
        out.append((f"{name}-soft", _c(name, type_, params, "soft")))
    for weight in (5, 30):
        out.append((f"min_days_off-soft-weight{weight}", _c("min_days_off", "min_days_off", {"days": 8}, "soft", weight=weight)))
    out.append(("max_consecutive_work-disabled", _c("max_consecutive_work", "max_consecutive_work", {"days": 5}, enabled=False)))
    out.append(("leave", _c("leave", "leave", {"nurse_id": "n01", "days": [3, 4, 5]}, scope="period")))
    out.append(("fixed_assignment", _c("fixed", "fixed_assignment", {"nurse_id": "n01", "day": 2, "shift": "E"}, scope="period")))
    prefs = [
        ("prefer-all", {"shift": "O", "prefer": True}),
        ("prefer-weekends", {"shift": "O", "prefer": True, "weekends_only": True}),
        ("prefer-days", {"shift": "D", "prefer": True, "days": [2, 3, 7]}),
        ("prefer-days-weekends", {"shift": "D", "prefer": True, "days": [2, 3, 7], "weekends_only": True}),
        ("avoid-all", {"shift": "N", "prefer": False}),
        ("avoid-weekends", {"shift": "N", "prefer": False, "weekends_only": True}),
        ("avoid-days", {"shift": "E", "prefer": False, "days": [5, 6]}),
    ]
    for name, params in prefs:
        out.append((f"shift_preference-{name}", _c(name, "shift_preference", {"nurse_id": "n02", **params}, "soft", "period")))
    out.append(("shift_preference-weight30", _c("pref", "shift_preference", {"nurse_id": "n02", "shift": "N", "prefer": False}, "soft", "period", weight=30)))
    for type_ in ("night_fairness", "weekend_fairness"):
        out.append((f"{type_}-soft", _c(type_, type_, {}, "soft", weight=5)))
        out.append((f"{type_}-hard", _c(type_, type_, {})))
    return out


def build_convert_cases() -> list[dict]:
    period = Period.model_validate(_CONVERT_PERIOD)
    cases = []
    for name, template in _convert_templates():
        block = legacy_to_block(_legacy_adapter.validate_python(template), period, _CONVERT_HOLIDAYS)
        cases.append({
            "name": name,
            "period": _CONVERT_PERIOD,
            "holidays": _CONVERT_HOLIDAYS,
            "template": template,
            "block": _block_adapter.dump_python(block, mode="json", exclude_none=True),
        })
    rule = night_dedicated_block(NIGHT_ONLY_RULE_ID)
    cases.append({
        "name": "night-only-rule",
        "period": _CONVERT_PERIOD,
        "holidays": _CONVERT_HOLIDAYS,
        "template": None,
        "block": _block_adapter.dump_python(rule, mode="json", exclude_none=True),
    })
    return cases


# --- 옛 골든(cases.json)과 블록 골든(blocks-cases.json): 식 규칙으로 바꿔 풀어 기록과 비교 ---


def case_request(case: dict) -> ScheduleRequest:
    """옛 골든 요청을 식 규칙으로 바꾸고(history_load는 버림), 누적 부담은 원본(history_raw)으로 보낸다."""
    data = convert_request(LegacyScheduleRequest.model_validate(case["request"])).model_dump(mode="json")
    data["history"] = case["history_raw"]
    return ScheduleRequest.model_validate(data)


def block_cases() -> list[dict]:
    return json.loads(BLOCKS_CASES_PATH.read_text(encoding="utf-8"))


def block_case_request(case: dict) -> tuple[ScheduleRequest, dict[str, str]]:
    """blocks-cases.json 요청(블록 형식)을 식 규칙 요청으로. (요청, 규칙 id → 원 블록 id)."""
    blocks = BlockScheduleRequest.model_validate(case["request"])
    origin = {r.id: c.id for c in blocks.constraints for r in block_to_rules(c)}
    return rules_request(blocks), origin


def check_block_case(case: dict) -> str | None:
    """식으로 바꿔 푼 결과가 기록과 같으면 None, 다르면 이유. 해가 있으면 OPTIMAL·목적값, 없으면 충돌 원 블록 id."""
    req, origin = block_case_request(case)
    expected = case["expected"]
    out = solve_case(req, conflicts=expected["status"] == "infeasible")
    if out["status"] != expected["status"]:
        return f"status {out['status']} (기록 {expected['status']})"
    if out["status"] == "ok":
        if not out["optimal"] or out["objective"] != expected["objective"]:
            return f"목적값 {out['objective']} (기록 {expected['objective']})"
        return None
    got = {origin[i] for i in out["conflict_ids"]}
    if got != set(expected["conflict_ids"]):
        return f"충돌 {sorted(got)} (기록 {sorted(expected['conflict_ids'])})"
    return None


# --- 변환 픽스처(블록 → 식) ---


def _count(cid: str, shifts: dict, per: str, lo=None, hi=None, hardness: str = "hard", scope: str = "ward",
           **params) -> dict:
    p = {"shifts": shifts, "per": per, **params}
    if lo is not None:
        p["min"] = lo
    if hi is not None:
        p["max"] = hi
    return _c(cid, "count", p, hardness, scope)


def _daily(code: str, n: int) -> dict:
    return _count(f"cov-{code}", {"in": [code]}, "day", n, n)


def _expr_shape_blocks() -> list[tuple[str, dict]]:
    """변환표(설계 §2.5)의 모든 모양. (이름, 블록)."""
    n, d, e, o = ({"in": [c]} for c in "NDEO")
    work = {"not_in": ["O"]}
    return [
        ("count-day-min", _count("c", d, "day", 3)),
        ("count-day-max", _count("c", e, "day", hi=4, days={"kind": "weekend"})),
        ("count-day-min-max", _count("c", d, "day", 3, 4, days={"kind": "weekday"})),
        ("count-day-eq", _count("c", n, "day", 2, 2)),
        ("count-day-people", _count("c", e, "day", 1, people={"min_years": 3})),
        ("count-day-hours", _count("c", work, "day", hi=80, measure="hours")),
        ("count-person-min", _count("c", o, "person", 8)),
        ("count-person-max-soft", {**_count("c", n, "person", hi=0, hardness="soft", scope="period",
                                            people={"ids": ["n1"]}, days={"kind": "weekend"}), "priority": "high"}),
        ("count-person-leave", _count("c", work, "person", hi=0, scope="period", people={"ids": ["n1"]},
                                      days={"days": [3, 4, 5]})),
        ("count-person-week-hours", _count("c", work, "person_week", hi=52, measure="hours")),
        ("count-person-window", _count("c", o, "person_window", 1, window=7, people={"exclude_tags": ["신규"]})),
        ("count-disabled", {**_count("c", o, "person", 8), "enabled": False}),
        ("forbid-1", _c("s", "sequence", {"forbid": [[n, d]]})),
        ("forbid-2-split", _c("s", "sequence", {"forbid": [[n, d], [n, e]]}, "soft", priority="high")),
        ("forbid-3-long", _c("s", "sequence", {"people": {"tags": ["신규"]}, "forbid": [[n, o, d]]})),
        ("run-max-len-night", _c("s", "sequence", {"run": n, "max_len": 3})),
        ("run-max-len-work", _c("s", "sequence", {"run": work, "max_len": 5})),
        ("run-min-len", _c("s", "sequence", {"run": n, "min_len": 2})),
        ("run-min-max-split", _c("s", "sequence", {"run": n, "min_len": 2, "max_len": 3})),
        ("after-then-off-1", _c("s", "sequence", {"after": n, "then_off": 1})),
        ("after-then-off-2", _c("s", "sequence", {"after": n, "then_off": 2}, "soft")),
        ("balance-soft", _c("b", "balance", {"people": {"exclude_tags": [NIGHT_ONLY_TAG]}, "shifts": n}, "soft",
                            priority="low")),
        ("balance-hard-gap", _c("b", "balance", {"shifts": n, "max_gap": 0})),
        ("balance-hours-no-history", _c("b", "balance", {"days": {"kind": "weekend"}, "shifts": work,
                                                         "measure": "hours", "with_history": False}, "soft")),
        ("fixed-assignment", _c("f", "fixed_assignment", {"nurse_id": "n1", "day": 2, "shift": "E"}, scope="period")),
        ("default-coverage", _daily("D", 3)),
        ("default-night-only", night_dedicated_block(NIGHT_ONLY_RULE_ID).model_dump(mode="json")),
    ]


def _expr_case(name: str, block: Any) -> dict:
    return {
        "name": name,
        "block": _block_adapter.dump_python(block, mode="json", exclude_none=True),
        "rules": [_spec_adapter.dump_python(r, mode="json", exclude_none=True) for r in block_to_rules(block)],
    }


def build_expr_convert_cases() -> list[dict]:
    cases = [_expr_case(name, _block_adapter.validate_python(raw)) for name, raw in _expr_shape_blocks()]
    for case in block_cases():
        req = BlockScheduleRequest.model_validate(case["request"])
        cases += [_expr_case(f"{case['id']}/{c.id}", c) for c in req.constraints]
    return cases


def render(cases: list[dict]) -> str:
    return json.dumps(cases, ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    outputs = [
        (CONVERT_CASES_PATH, render(build_convert_cases())),
        (EXPR_CONVERT_CASES_PATH, render(build_expr_convert_cases())),
    ]
    mismatched = [(c["id"], why) for c in block_cases() if (why := check_block_case(c)) is not None]
    for cid, why in mismatched:
        print(f"{BLOCKS_CASES_PATH.relative_to(ROOT)} {cid}: {why}", file=sys.stderr)
    if "--check" in sys.argv[1:]:
        stale = [p for p, text in outputs if not p.exists() or p.read_text(encoding="utf-8") != text]
        for path in stale:
            print(f"{path.relative_to(ROOT)}가 지금 결과와 다릅니다", file=sys.stderr)
        if stale or mismatched:
            sys.exit(1)
        print("golden cases ok")
        return
    for path, text in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(json.loads(text))} cases)")
    if mismatched:
        sys.exit(1)


if __name__ == "__main__":
    main()
