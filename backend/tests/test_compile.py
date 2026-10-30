"""식 규칙 → CP-SAT 컴파일(ADR-019, 설계 §3). 의미의 기준은 evaluate.py다.

- 골든: blocks-cases.json의 블록 요청을 rules_request로 바꿔 풀어도 status·목적값·conflict가 같고,
  기록된 블록 배정이 식 규칙 hard 위반 0이다.
  목적값이 바뀌는 soft 모양(위반량 모양이 다른 것)은 hard 위반 0만 본다:
  - 세기 min·max(다른 값): 식은 그리고(All)라 묶음마다 1, 블록은 벗어난 양
  - 최소 연속(run.min_len): 식은 짧은 구간 뒤 칸 중 다른 근무 수, 블록은 구간마다 1
- 컴파일 = 평가: 모든 칸을 고정한 근무표에서 soft 목적값 = Σ 위반량 × weight, hard는 풀리면 위반 0·안 풀리면 위반 있음.
  고르게(soft)는 블록처럼 (최대 − 최소)를 그대로 벌점으로 둔다(evaluate는 FAIRNESS_TOLERANCE 이하를 위반으로 나열하지 않음).
"""

import json
import math
import random
import zlib
from datetime import date, timedelta
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from backend.domain.constants import HISTORY_DAYS
from backend.domain.convert import block_to_rules, rules_request
from backend.domain.models import Balance, ConstraintSpec, Rule, ScheduleRequest
from backend.gen_golden import solve_case
from backend.solver import evaluate, select, stats
from backend.solver.model import solve

GOLDEN = Path(__file__).parent / "golden"
BLOCK_CASES = json.loads((GOLDEN / "blocks-cases.json").read_text(encoding="utf-8"))
EXPR_CASES = json.loads((GOLDEN / "expr-convert-cases.json").read_text(encoding="utf-8"))
spec_adapter = TypeAdapter(ConstraintSpec)


def _ids(cases):
    return [c["id"] for c in cases]


# --- 골든 동등성 ---


def _block_req(case) -> ScheduleRequest:
    return ScheduleRequest.model_validate(case["request"])


def _shape_changed(req: ScheduleRequest) -> list[str]:
    """식으로 바꾸면 soft 위반량 모양이 달라지는 블록 id."""
    out = []
    for c in req.constraints:
        if not c.enabled or c.hardness != "soft":
            continue
        p = getattr(c, "params", None)
        if c.type == "count" and p.min is not None and p.max is not None and p.min != p.max:
            out.append(c.id)
        if c.type == "sequence" and p.run is not None and (p.min_len or 1) > 1:
            out.append(c.id)
    return out


def _hard_rule_violations(req: ScheduleRequest, a: dict) -> dict[str, list]:
    out = {}
    for c in req.constraints:
        if c.enabled and c.hardness == "hard" and c.type == "rule":
            vs = evaluate.evaluate_rule(req, a, c)
            if vs:
                out[c.id] = vs
    return out


FEASIBLE = [c for c in BLOCK_CASES if c["expected"]["status"] == "ok"]
INFEASIBLE = [c for c in BLOCK_CASES if c["expected"]["status"] == "infeasible"]


def test_no_golden_case_changes_soft_shape():
    # 지금 골든에는 위반량 모양이 바뀌는 soft 블록이 없어 모든 feasible 케이스의 목적값을 비교한다.
    # 생기면 그 케이스는 목적값 대신 hard 위반 0만 본다(test_golden_rules_objective_equal).
    assert {c["id"]: ids for c in FEASIBLE if (ids := _shape_changed(_block_req(c)))} == {}


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_golden_rules_objective_equal(case):
    block_req = _block_req(case)
    req = rules_request(block_req)
    assert {c.type for c in req.constraints} <= {"rule", "fixed_assignment"}
    out = solve_case(req)
    assert out["status"] == "ok" and out["optimal"]
    if not _shape_changed(block_req):
        assert out["objective"] == case["expected"]["objective"]
    assert _hard_rule_violations(req, out["assignments"]) == {}


@pytest.mark.parametrize("case", FEASIBLE, ids=_ids(FEASIBLE))
def test_golden_recorded_assignments_satisfy_hard_rules(case):
    req = rules_request(_block_req(case))
    assert _hard_rule_violations(req, case["expected"]["assignments"]) == {}


@pytest.mark.parametrize("case", INFEASIBLE, ids=_ids(INFEASIBLE))
def test_golden_rules_infeasible_same_conflicts(case):
    block_req = _block_req(case)
    origin = {r.id: c.id for c in block_req.constraints for r in block_to_rules(c)}
    out = solve_case(rules_request(block_req))
    assert out["status"] == "infeasible"
    assert {origin[i] for i in out["conflict_ids"]} == set(case["expected"]["conflict_ids"])


# --- 컴파일 = 평가 ---

START = date(2026, 11, 5)  # 목요일. 1=목 2=금 3=토 4=일 5=월 6=화 7=수
LENGTH = 7
NURSES = [
    {"id": "n1", "name": "가", "years": 5},
    {"id": "n2", "name": "나", "years": 2, "tags": ["신규"]},
    {"id": "n3", "name": "다", "years": 10, "tags": ["책임"]},
    {"id": "n4", "name": "라", "years": 1, "tags": ["신규"]},
    {"id": "n5", "name": "마", "years": 8, "tags": ["나이트전담", "책임"]},
]
CODES = ["D", "E", "N", "O"]


def cnt(shifts=None, not_in=None, **extra) -> dict:
    return {"shifts": {"in": shifts} if shifts else {"not_in": not_in}, **extra}


def cmp(left: dict, op: str, right) -> dict:
    return {"left": left, "op": op, "right": right}


def require(per: str, then: dict, when: dict | None = None, **for_each) -> dict:
    body = {"kind": "require", "for_each": {"per": per, **for_each}, "then": then}
    if when is not None:
        body["when"] = when
    return body


def rule(cid: str, body: dict, values: dict | None = None, hardness: str = "hard", priority: str = "normal") -> dict:
    return {
        "id": cid, "type": "rule", "scope": "ward", "hardness": hardness, "priority": priority, "source_text": cid,
        "values": {k: {"value": v, "label": k} for k, v in (values or {}).items()}, "body": body,
    }


# 설계 §2.6 예시와 그 밖의 식 모양(조건부, 짝, 세기끼리 비교, 요일 조건부 순서, 시간, 소수 값, 음수 offset)
FEATURE_RULES: list[dict] = [
    rule("cond-newbie-charge", require("day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge", 1),
                                       when=cmp(cnt(["N"], who={"tags": ["신규"]}), "ge", 1))),
    rule("pair-apart", require("day", cmp(cnt(["N"], who={"ids": ["n1", "n2"]}), "le", 1))),
    rule("pair-together", require("day", cmp(cnt(["D"], who={"ids": ["n1"]}), "eq", cnt(["D"], who={"ids": ["n2"]})))),
    rule("charge-ge-newbie", require("day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge",
                                               cnt(["N"], who={"tags": ["신규"]})))),
    rule("sun-night-mon-off", require("person_day", cmp(cnt(["O"], offset=(1, 1)), "eq", 1),
                                      when=cmp(cnt(["N"]), "ge", 1), days={"weekdays": [6]})),
    rule("any-when-all-then", require("person_day",
                                      {"all": [cmp(cnt(["D"], offset=(1, 1)), "eq", 0),
                                               cmp(cnt(["N"], offset=(-1, -1)), "le", 0)]},
                                      when={"any": [cmp(cnt(["N"]), "ge", 1), cmp(cnt(["E"]), "ge", 1)]})),
    rule("hours-person", require("person", cmp(cnt(not_in=["O"], measure="hours"), "le", {"value": "max"})),
         {"max": 36}),
    rule("period-nights", require("period", cmp(cnt(["N"]), "le", 6))),
    rule("fraction-off", require("person", cmp(cnt(["O"]), "ge", {"value": "min"})), {"min": 2.5}),
    rule("fraction-eq", require("person", cmp(cnt(["O"]), "eq", 2.5))),
    rule("two-nights-then-off", require("person_day", cmp(cnt(["O"]), "ge", 1),
                                        when=cmp(cnt(["N"], offset=(-2, -1)), "ge", 2))),
    rule("when-eq-multi", require("day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge", 1),
                                  when=cmp(cnt(["N"]), "eq", 2))),
    rule("when-all-then-any", require("person_day",
                                      {"any": [cmp(cnt(["O"], offset=(1, 2)), "ge", 1),
                                               cmp(cnt(["N"], offset=(1, 1)), "eq", 1)]},
                                      when={"all": [cmp(cnt(["N"]), "ge", 1),
                                                    cmp(cnt(["N"], offset=(-1, -1)), "ge", 1)]})),
    rule("hours-day-range", require("day", {"all": [cmp(cnt(not_in=["O"], measure="hours"), "ge", 16),
                                                    cmp(cnt(not_in=["O"], measure="hours"), "le", 24)]})),
    rule("hours-week-cmp", require("person_week", cmp(cnt(["N"], measure="hours"), "le", 12.5))),
    rule("window-weekend", require("person_window", cmp(cnt(not_in=["O"]), "le", 2), window=3,
                                   days={"kind": "weekend"})),
    rule("balance-hard", {"kind": "balance", "shifts": {"in": ["N"]}, "max_gap": {"value": "gap"}}, {"gap": 1}),
    rule("balance-hours", {"kind": "balance", "people": {"exclude_tags": ["나이트전담"]},
                           "shifts": {"not_in": ["O"]}, "measure": "hours"}, hardness="soft", priority="low"),
]


def _shape_rules() -> list[dict]:
    """변환표 모양(expr-convert-cases의 모양 케이스)의 식 규칙."""
    shapes = [c for c in EXPR_CASES if "/" not in c["name"]]
    out = []
    for c in shapes:
        for r in c["rules"]:
            if r["type"] == "rule":
                out.append({**r, "id": f"{c['name']}:{r['id']}"})
    return out


ALL_RULES = _shape_rules() + FEATURE_RULES


def _request(rng: random.Random, constraints: list[dict], carry: bool) -> ScheduleRequest:
    raw = {
        "nurses": NURSES,
        "period": {"start_date": START.isoformat(), "length": LENGTH},
        "holidays": [6],
        "constraints": constraints,
        "carry_over": [
            {"nurse_id": n["id"], "shifts": [rng.choice(CODES) for _ in range(rng.randint(1, 7))]}
            for n in NURSES if carry and rng.random() < 0.8
        ],
        "history": {
            "start_date": (START - timedelta(days=HISTORY_DAYS)).isoformat(),
            "rows": {n["id"]: [rng.choice(CODES) for _ in range(HISTORY_DAYS)] for n in NURSES[:3]},
        },
        "input_version": 0,
    }
    return ScheduleRequest.model_validate(raw)


def _fix_all(a: dict) -> list[dict]:
    return [
        {"id": f"fix-{nid}-{d}", "type": "fixed_assignment", "scope": "period", "hardness": "hard",
         "source_text": "고정", "params": {"nurse_id": nid, "day": d, "shift": code}}
        for nid, row in a.items()
        for d, code in enumerate(row, start=1)
    ]


def _random_rows(rng: random.Random, bias: str) -> dict:
    weights = [3 if c == bias else 1 for c in CODES]
    return {n["id"]: rng.choices(CODES, weights, k=LENGTH) for n in NURSES}


def _compile_penalty(req: ScheduleRequest, a: dict, r: Rule) -> int:
    """컴파일한 soft 규칙이 이 근무표에 매기는 벌점(가중치 전)."""
    body = r.body
    if isinstance(body, Balance):
        values = evaluate.balance_values(req, a, body)
        return math.ceil((max(values) - min(values)) / select.measure_unit(body.measure)) if len(values) > 1 else 0
    return sum(v.amount for v in evaluate.evaluate_rule(req, a, r))


def _schedules(seed: int):
    rng = random.Random(seed)
    for i, bias in enumerate(["N", "O", "D", "E", "N", "O"]):
        yield rng, _random_rows(rng, bias), i % 2 == 0


@pytest.mark.parametrize("raw", ALL_RULES, ids=[r["id"] for r in ALL_RULES])
def test_compiled_soft_objective_equals_evaluated_amounts(raw):
    soft_raw = {**raw, "hardness": "soft", "enabled": True}
    for rng, a, carry in _schedules(zlib.crc32(raw["id"].encode())):
        req = _request(rng, [soft_raw, *_fix_all(a)], carry)
        r = req.constraints[0]
        out = solve_case(req)
        assert out["status"] == "ok" and out["assignments"] == a
        assert out["objective"] == r.weight * _compile_penalty(req, a, r), (a, req.carry_over)


@pytest.mark.parametrize("raw", ALL_RULES, ids=[r["id"] for r in ALL_RULES])
def test_compiled_hard_feasible_iff_no_violation(raw):
    hard_raw = {**raw, "hardness": "hard", "enabled": True}
    for rng, a, carry in _schedules(zlib.crc32(raw["id"].encode()) + 1):
        req = _request(rng, [hard_raw, *_fix_all(a)], carry)
        violated = bool(evaluate.evaluate_rule(req, a, req.constraints[0]))
        out = solve_case(req, conflicts=False)
        assert out["status"] == ("infeasible" if violated else "ok"), (a, req.carry_over)


@pytest.mark.parametrize("raw", ALL_RULES, ids=[r["id"] for r in ALL_RULES])
def test_free_solve_keeps_hard_and_objective_matches(raw):
    """칸을 고정하지 않고 풀어도 hard 위반 0, soft 목적값은 평가한 위반량 × weight."""
    rng = random.Random(7)
    cov = [rule(f"cov-{c}", require("day", cmp(cnt([c]), "eq", 1))) for c in "DN"]
    req = _request(rng, [raw, *cov], carry=True)
    out = solve_case(req)
    if out["status"] == "infeasible":  # 작은 병동에서 규칙과 인원이 맞지 않으면 core에 그 규칙이 있어야 한다
        assert raw["id"] in out["conflict_ids"] or any(c.startswith("cov-") for c in out["conflict_ids"])
        return
    assert out["status"] == "ok" and out["optimal"]
    a = out["assignments"]
    assert _hard_rule_violations(req, a) == {}
    soft = [c for c in req.constraints if c.hardness == "soft"]
    assert out["objective"] == sum(c.weight * _compile_penalty(req, a, c) for c in soft)


# --- 새 기능: hard로 지켜지고, 불가능하면 core에 그 규칙 ---

FEATURE = {r["id"]: r for r in FEATURE_RULES}


def _fix(nid: str, d: int, code: str) -> dict:
    return {"id": f"fix-{nid}-{d}", "type": "fixed_assignment", "scope": "period", "hardness": "hard",
            "source_text": "고정", "params": {"nurse_id": nid, "day": d, "shift": code}}


def _plain(constraints: list[dict]) -> ScheduleRequest:
    raw = {
        "nurses": NURSES,
        "period": {"start_date": START.isoformat(), "length": LENGTH},
        "constraints": constraints,
        "input_version": 0,
    }
    return ScheduleRequest.model_validate(raw)


NO_CHARGE_NIGHT = rule("no-charge-n", require("person", cmp(cnt(["N"]), "le", 0), people={"tags": ["책임"]}))
INFEASIBLE_SETUPS = {
    "cond-newbie-charge": [NO_CHARGE_NIGHT, _fix("n2", 1, "N")],
    "charge-ge-newbie": [NO_CHARGE_NIGHT, _fix("n4", 2, "N")],
    "pair-apart": [_fix("n1", 2, "N"), _fix("n2", 2, "N")],
    "pair-together": [_fix("n1", 1, "D"), _fix("n2", 1, "E")],
    "sun-night-mon-off": [_fix("n1", 4, "N"), _fix("n1", 5, "D")],  # 4일 일요일 → 5일 월요일
}


@pytest.mark.parametrize("cid", list(INFEASIBLE_SETUPS))
def test_feature_rule_holds_when_solving(cid):
    cov = [rule(f"cov-{c}", require("day", cmp(cnt([c]), "ge", 1))) for c in "DEN"]
    req = _plain([FEATURE[cid], *cov, _fix("n2", 1, "N"), _fix("n4", 3, "N")])
    out = solve(req, deterministic=True)
    assert out.status == "ok"
    a = out.result.assignments
    assert _hard_rule_violations(req, a) == {}


@pytest.mark.parametrize("cid", list(INFEASIBLE_SETUPS))
def test_feature_rule_infeasible_core_contains_rule(cid):
    req = _plain([FEATURE[cid], *INFEASIBLE_SETUPS[cid]])
    out = solve(req)
    assert out.status == "infeasible"
    assert cid in {c.constraint_id for c in out.conflicts}
    assert all(c.type in ("rule", "fixed_assignment") for c in out.conflicts)


# --- 결과 통계: 규칙도 희망·기피로 센다 ---


def test_preference_summary_same_for_block_and_rules():
    case = next(c for c in BLOCK_CASES if c["id"] == "block-soft-prefs")
    block_req = _block_req(case)
    a = case["expected"]["assignments"]
    block_res = stats.compute_result(block_req, a, optimal=True)
    rule_res = stats.compute_result(rules_request(block_req), a, optimal=True)
    assert block_res.summary.preferences_total > 0
    assert rule_res.summary == block_res.summary
    assert {k: v.preference_rate for k, v in rule_res.stats.items()} == {
        k: v.preference_rate for k, v in block_res.stats.items()
    }
    assert [(v.constraint_id, v.nurse_id, v.day) for v in rule_res.soft_violations] == [
        (v.constraint_id, v.nurse_id, v.day) for v in block_res.soft_violations
    ]
