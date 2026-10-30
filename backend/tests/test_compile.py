"""식 규칙 → CP-SAT 컴파일(ADR-019, 설계 §3). 의미의 기준은 evaluate.py다.

- 골든(솔버 회귀 기준)은 test_golden이 solver-cases.json으로 본다.
- 컴파일 = 평가: 모든 칸을 고정한 근무표에서 soft 목적값 = Σ 위반량 × weight, hard는 풀리면 위반 0·안 풀리면 위반 있음.
  고르게(soft)는 블록처럼 (최대 − 최소)를 그대로 벌점으로 둔다(evaluate는 FAIRNESS_TOLERANCE 이하를 위반으로 나열하지 않음).
"""

import math
import random
import zlib
from datetime import date, timedelta

import pytest
from pydantic import TypeAdapter

from backend.domain.constants import HISTORY_DAYS
from backend.domain.models import Balance, ConstraintSpec, Rule, ScheduleRequest
from backend.gen_golden import solve_case
from backend.solver import evaluate, select
from backend.solver.model import solve
from backend.tests import rules as R

spec_adapter = TypeAdapter(ConstraintSpec)


def _hard_rule_violations(req: ScheduleRequest, a: dict) -> dict[str, list]:
    out = {}
    for c in req.constraints:
        if c.enabled and c.hardness == "hard" and c.type == "rule":
            vs = evaluate.evaluate_rule(req, a, c)
            if vs:
                out[c.id] = vs
    return out


# --- 컴파일 = 평가 ---

START = date(2026, 11, 5)  # 목요일. 1=목 2=금 3=토 4=일 5=월 6=화 7=수
LENGTH = 7
NURSES = [
    {"id": "n1", "name": "가"},
    {"id": "n2", "name": "나", "tags": ["신규"]},
    {"id": "n3", "name": "다", "tags": ["책임"]},
    {"id": "n4", "name": "라", "tags": ["신규"]},
    {"id": "n5", "name": "마", "tags": ["책임"]},
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
    rule("balance-hours", {"kind": "balance", "people": {"exclude_tags": ["신규"]},
                           "shifts": {"not_in": ["O"]}, "measure": "hours"}, hardness="soft", priority="low"),
]


def _forbid(cid: str, patterns: list[dict], people: dict | None = None, **extra) -> dict:
    """금지 패턴: 사람·날마다 칸 중 하나는 패턴과 다르다."""
    then = {"any": [R.cmp(R.cnt(s, (i, i)), "eq", 0) for i, s in enumerate(patterns)]}
    return R.con(cid, R.require("person_day", then, people=people), **extra)


_D, _E, _N, _O, _WORK = {"in": ["D"]}, {"in": ["E"]}, R.N, R.O, R.WORK

# 식 모양마다 하나씩(세기, 금지 순서, 연속 구간, 끝난 뒤 휴무, 고르게, 기본 규칙)
SHAPE_RULES: dict[str, list[dict]] = {
    "count-day-min": [R.count("c", _D, "day", 3)],
    "count-day-max": [R.count("c", _E, "day", hi=4, days={"kind": "weekend"})],
    "count-day-min-max": [R.count("c", _D, "day", 3, 4, days={"kind": "weekday"})],
    "count-day-eq": [R.count("c", _N, "day", 2, 2)],
    "count-day-people": [R.count("c", _E, "day", 1, people={"tags": ["책임"]})],
    "count-day-hours": [R.count("c", _WORK, "day", hi=80, measure="hours")],
    "count-person-min": [R.count("c", _O, "person", 8)],
    "count-person-max-soft": [R.count("c", _N, "person", hi=0, hardness="soft", scope="period", priority="high",
                                      people={"ids": ["n1"]}, days={"kind": "weekend"})],
    "count-person-leave": [R.leave("c", "n1", [3, 4, 5])],
    "count-person-week-hours": [R.weekly_hours("c", 52)],
    "count-person-window": [R.window_off("c", 7, people={"exclude_tags": ["신규"]})],
    "count-disabled": [R.count("c", _O, "person", 8, enabled=False)],
    "forbid-1": [R.forbid("s", "N", "D")],
    "forbid-2-split": [R.forbid("s", "N", "D", hardness="soft", priority="high"),
                       R.forbid("s-2", "N", "E", hardness="soft", priority="high")],
    "forbid-3-long": [_forbid("s", [_N, _O, _D], people={"tags": ["신규"]})],
    "run-max-len-night": [R.max_nights("s", 3)],
    "run-max-len-work": [R.max_work("s", 5)],
    "run-min-len": [R.min_run("s", _N, 2)],
    "run-min-max-split": [R.max_nights("s", 3), R.min_run("s-2", _N, 2)],
    "after-then-off-1": [R.off_after("s", 1)],
    "after-then-off-2": [R.off_after("s", 2, hardness="soft")],
    "balance-soft": [R.night_fair("b")],
    "balance-hard-gap": [R.balance("b", _N, 0, hardness="hard")],
    "balance-hours-no-history": [R.balance("b", _WORK, days={"kind": "weekend"}, measure="hours", with_history=False)],
    "default-coverage": [R.count("cov-D", _D, "day", 3, 3, default=True)],
}


def _shape_rules() -> list[dict]:
    return [{**r, "id": f"{name}:{r['id']}"} for name, rs in SHAPE_RULES.items() for r in rs]


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
