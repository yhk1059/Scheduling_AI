"""골든 케이스와 템플릿 → 블록 변환 픽스처. 실행: npm run gen:golden

cases.json은 블록화(ADR-018) 전 솔버의 목적값·배정 기록이다. 요청은 옛 형식(backend/domain/legacy.py)이고
옛 솔버가 없어져 다시 만들지 않는다(test_golden이 convert_request로 바꿔 풀어 목적값을 비교한다).
이 스크립트는 convert-cases.json(TS 변환이 같은 결과를 내야 하는 공유 픽스처)과
blocks-cases.json(블록 솔버의 목적값·배정 기록. 식 언어 전환(ADR-019)이 같은 결과를 내야 하는 기준)을 쓴다.
`--check`는 파일을 쓰지 않고 다시 만들어 기존 파일과 비교한다(다르면 exit 1).
"""

import json
import sys
from pathlib import Path
from typing import Any

from ortools.sat.python import cp_model
from pydantic import TypeAdapter

from backend.domain.constants import NIGHT_ONLY_TAG, SOLVE_TIME_LIMIT_S
from backend.domain.convert import NIGHT_ONLY_RULE_ID, convert_request, legacy_to_block, night_dedicated_rule
from backend.domain.legacy import LegacyScheduleRequest, LegacySpec
from backend.domain.models import ConstraintSpec, Period, ScheduleRequest
from backend.solver.conflicts import find_conflicts
from backend.solver.model import build_model

ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = ROOT / "backend" / "tests" / "golden" / "cases.json"
CONVERT_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "convert-cases.json"
BLOCKS_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "blocks-cases.json"


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


# --- 블록 골든(지금 블록 솔버의 기록) ---


def block_request(case: dict) -> ScheduleRequest:
    """옛 골든 요청을 블록으로 바꾸고(history_load는 버림), 누적 부담은 원본(history_raw)으로 보낸다."""
    data = convert_request(LegacyScheduleRequest.model_validate(case["request"])).model_dump(mode="json")
    data["history"] = case["history_raw"]
    return ScheduleRequest.model_validate(data)


_MONDAY = "2026-11-02"  # 11/2 월요일: 6, 7일이 토·일


def _shift(code: str, name: str, hours: float = 8, parts: list[str] | None = None) -> dict:
    return {"code": code, "name": name, "hours": hours, "parts": parts or []}


def _config(*extra: dict) -> dict:
    base = [_shift("D", "데이"), _shift("E", "이브닝"), _shift("N", "나이트")]
    return {"shifts": [*base, *extra, _shift("O", "휴무", 0)]}


def _nurses(n: int, tags: dict[int, list[str]] | None = None) -> list[dict]:
    return [{"id": f"n{i}", "name": f"간호사{i}", "years": 3 + i, "tags": (tags or {}).get(i, [])} for i in range(n)]


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


def _feature_requests() -> list[tuple[str, str, dict]]:
    """블록 기능 케이스: 작은 병동(1~8명 × 5~10일), 1초 안에 OPTIMAL. (id, 설명, 요청 dict)."""
    after_n = _c("n-off", "sequence", {"after": {"in": ["N"]}, "then_off": 1})
    work = {"not_in": ["O"]}
    return [
        ("block-mid-shift", "M 미드 코드 추가, 날마다 D·M·N 1명, 나이트 다음 휴무, 나이트 고르게", {
            "config": _config({**_shift("M", "미드"), "start": "11:00"}),
            "nurses": _nurses(5),
            "constraints": [_daily("D", 1), _daily("M", 1), _daily("N", 1), after_n,
                            _c("nf", "balance", {"shifts": {"in": ["N"]}}, "soft", priority="low")],
        }),
        ("block-double-de", "DE 더블이 D와 E를 모두 채움, 사람당 더블 2번까지, 3명 × 5일", {
            "config": _config(_shift("DE", "더블", 16, ["D", "E"])),
            "nurses": _nurses(3),
            "length": 5,
            "constraints": [_count("cov-D", {"in": ["D"]}, "day", 2, 2), _count("cov-E", {"in": ["E"]}, "day", 2, 2),
                            _count("de-max", {"in": ["DE"]}, "person", hi=2)],
        }),
        ("block-week-52h", "주 52시간(사람·주, 시간) + 이월 월~수 D, 가능하면 매일 근무", {
            "nurses": _nurses(1),
            "start": "2026-11-05",
            "carry_over": [{"nurse_id": "n0", "shifts": ["D", "D", "D"]}],
            "constraints": [_count("week52", work, "person_week", hi=52, measure="hours"),
                            _count("want-work", work, "person", lo=7, hardness="soft")],
        }),
        ("block-window-7", "7일 창마다 휴무 1일 이상(사람·연속 7일) + 이월 6일 연속 근무", {
            "nurses": _nurses(1),
            "length": 10,
            "carry_over": [{"nurse_id": "n0", "shifts": ["D"] * 6}],
            "constraints": [_count("off7", {"in": ["O"]}, "person_window", lo=1, window=7),
                            _count("want-work", work, "person", lo=10, hardness="soft")],
        }),
        ("block-run-min-len", "나이트 블록 2~3일(run.min_len·max_len), 날마다 N 1명, 3명 × 10일", {
            "nurses": _nurses(3),
            "length": 10,
            "carry_over": [{"nurse_id": f"n{i}", "shifts": ["O"]} for i in range(3)],
            "constraints": [_daily("N", 1),
                            _c("n-run", "sequence", {"run": {"in": ["N"]}, "min_len": 2, "max_len": 3})],
        }),
        ("block-then-off-2", "나이트가 끝나면 2일 휴무(after.then_off 2), 날마다 D·N 1명, 5명 × 10일", {
            "nurses": _nurses(5),
            "length": 10,
            "constraints": [_daily("D", 1), _daily("N", 1),
                            _c("after-n", "sequence", {"after": {"in": ["N"]}, "then_off": 2})],
        }),
        ("block-tag-charge", "책임 태그가 날마다 데이에 1명 이상, 날마다 D 2·E 1·N 1명, 7명 × 7일", {
            "nurses": _nurses(7, {0: ["책임"], 3: ["책임"]}),
            "constraints": [_daily("D", 2), _daily("E", 1), _daily("N", 1), after_n,
                            _count("charge-d", {"in": ["D"]}, "day", lo=1, people={"tags": ["책임"]}),
                            _c("wf", "balance", {"days": {"kind": "weekend"}, "shifts": work}, "soft",
                               priority="low")],
        }),
        ("block-hard-balance", "나이트 개수 차이 0(hard balance max_gap), 날마다 N 1명, 3명 × 6일", {
            "nurses": _nurses(3),
            "length": 6,
            "constraints": [_daily("N", 1),
                            _c("n-even", "balance", {"shifts": {"in": ["N"]}, "max_gap": 0}, "hard")],
        }),
        ("block-soft-prefs", "가능하면 세기: 희망 휴무(min)·기피 나이트(max 0)·중요도, 6명 × 7일", {
            "nurses": _nurses(6),
            "constraints": [_daily("D", 2), _daily("E", 1), _daily("N", 1), after_n,
                            _count("want-off", {"in": ["O"]}, "person", lo=3, hardness="soft", scope="period",
                                   people={"ids": ["n0"]}, days={"days": [1, 2, 3]}),
                            _count("avoid-n", {"in": ["N"]}, "person", hi=0, hardness="soft", scope="period",
                                   people={"ids": ["n1", "n2", "n3", "n4", "n5"]}),
                            _count("want-d-sat", {"in": ["D"]}, "person", lo=1, hardness="soft", scope="period",
                                   people={"ids": ["n2"]}, days={"weekdays": [5]})],
        }),
        ("block-soft-forbid", "가능하면 금지 순서(N→D, N→E), 최대 연속 나이트 1일, 날마다 D·E·N 1명, 3명 × 7일", {
            "nurses": _nurses(3),
            "constraints": [_daily("D", 1), _daily("E", 1), _daily("N", 1),
                            _c("max-n", "sequence", {"run": {"in": ["N"]}, "max_len": 1}),
                            _c("no-nd", "sequence", {"forbid": [[{"in": ["N"]}, {"in": ["D"]}]]}, "soft"),
                            _c("no-ne", "sequence", {"forbid": [[{"in": ["N"]}, {"in": ["E"]}]]}, "soft",
                               priority="high")],
        }),
        ("block-infeasible-tag", "나이트 전담 2명뿐인데 날마다 데이 1명(해 없음), 3일", {
            "nurses": _nurses(2, {0: [NIGHT_ONLY_TAG], 1: [NIGHT_ONLY_TAG]}),
            "length": 3,
            "constraints": [night_dedicated_rule(NIGHT_ONLY_RULE_ID).model_dump(mode="json"), _daily("D", 1),
                            _daily("N", 1)],
        }),
    ]


def build_blocks_requests() -> list[tuple[str, str, ScheduleRequest]]:
    """(id, 설명, 블록 요청). 옛 골든 9케이스의 블록 변환 + 블록 기능 케이스."""
    out = []
    for case in json.loads(CASES_PATH.read_text(encoding="utf-8")):
        out.append((case["id"], case["description"], block_request(case)))
    for cid, description, spec in _feature_requests():
        data = {
            "config": spec.get("config", _config()),
            "nurses": spec["nurses"],
            "period": {"start_date": spec.get("start", _MONDAY), "length": spec.get("length", 7)},
            "constraints": spec["constraints"],
            "carry_over": spec.get("carry_over", []),
            "input_version": 1,
        }
        out.append((cid, description, ScheduleRequest.model_validate(data)))
    return out


def dump_request(req: ScheduleRequest) -> dict:
    return req.model_dump(mode="json", exclude_none=True)


def build_blocks_cases() -> list[dict]:
    return [
        {"id": cid, "description": description, "request": dump_request(req), "expected": solve_case(req)}
        for cid, description, req in build_blocks_requests()
    ]


def render(cases: list[dict]) -> str:
    return json.dumps(cases, ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    outputs = [(CONVERT_CASES_PATH, render(build_convert_cases())), (BLOCKS_CASES_PATH, render(build_blocks_cases()))]
    if "--check" in sys.argv[1:]:
        stale = [p for p, text in outputs if not p.exists() or p.read_text(encoding="utf-8") != text]
        for path in stale:
            print(f"{path.relative_to(ROOT)}가 지금 결과와 다릅니다", file=sys.stderr)
        if stale:
            sys.exit(1)
        print("golden cases ok")
        return
    for path, text in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(json.loads(text))} cases)")


if __name__ == "__main__":
    main()
