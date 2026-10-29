"""골든 케이스와 템플릿 → 블록 변환 픽스처. 실행: npm run gen:golden

cases.json은 블록화(ADR-018) 전 솔버의 목적값·배정 기록이다. 요청은 옛 형식(backend/domain/legacy.py)이고
옛 솔버가 없어져 다시 만들지 않는다(test_golden이 convert_request로 바꿔 풀어 목적값을 비교한다).
이 스크립트는 convert-cases.json(TS 변환이 같은 결과를 내야 하는 공유 픽스처)만 쓴다.
`--check`는 파일을 쓰지 않고 다시 만들어 기존 파일과 비교한다(다르면 exit 1).
"""

import json
import sys
from pathlib import Path
from typing import Any

from ortools.sat.python import cp_model
from pydantic import TypeAdapter

from backend.domain.constants import SOLVE_TIME_LIMIT_S
from backend.domain.convert import NIGHT_ONLY_RULE_ID, legacy_to_block, night_dedicated_rule
from backend.domain.legacy import LegacySpec
from backend.domain.models import ConstraintSpec, Period, ScheduleRequest
from backend.solver.conflicts import find_conflicts
from backend.solver.model import build_model

ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = ROOT / "backend" / "tests" / "golden" / "cases.json"
CONVERT_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "convert-cases.json"


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
            "block": _spec_adapter.dump_python(block, mode="json", exclude_none=True),
        })
    rule = night_dedicated_rule(NIGHT_ONLY_RULE_ID)
    cases.append({
        "name": "night-only-rule",
        "period": _CONVERT_PERIOD,
        "holidays": _CONVERT_HOLIDAYS,
        "template": None,
        "block": _spec_adapter.dump_python(rule, mode="json", exclude_none=True),
    })
    return cases


def render(cases: list[dict]) -> str:
    return json.dumps(cases, ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    text = render(build_convert_cases())
    path = CONVERT_CASES_PATH
    if "--check" in sys.argv[1:]:
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            print(f"{path.relative_to(ROOT)}가 지금 변환 결과와 다릅니다", file=sys.stderr)
            sys.exit(1)
        print("golden cases ok")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({len(json.loads(text))} cases)")


if __name__ == "__main__":
    main()
