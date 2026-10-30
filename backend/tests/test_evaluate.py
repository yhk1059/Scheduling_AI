"""식 규칙을 근무표 위에서 평가(ADR-019, 설계 §2.2~§2.4·§3). 식 의미의 단일 기준이다."""

from datetime import date, timedelta

from backend.domain.constants import HISTORY_DAYS
from backend.domain.models import Rule, ScheduleRequest
from backend.solver import stats
from backend.solver.evaluate import Instance, RuleViolation, evaluate_rule, instances

START = date(2026, 11, 5)  # 목요일. 1=목 2=금 3=토 4=일 5=월 … 14=수
EMPLOYEES = [
    {"id": "n1", "name": "가"},
    {"id": "n2", "name": "나", "tags": ["신규"]},
    {"id": "n3", "name": "다", "tags": ["책임"]},
    {"id": "n4", "name": "라", "tags": ["신규"]},
    {"id": "n5", "name": "마"},
    {"id": "n6", "name": "바", "tags": ["책임"]},
]


def req(length: int = 14, carry: dict | None = None, history: dict | None = None, **extra) -> ScheduleRequest:
    raw = {
        "employees": EMPLOYEES,
        "period": {"start_date": START.isoformat(), "length": length},
        "holidays": [6],
        "carry_over": [{"employee_id": k, "shifts": v} for k, v in (carry or {}).items()],
        "input_version": 0,
        **extra,
    }
    if history is not None:
        raw["history"] = {"start_date": (START - timedelta(days=HISTORY_DAYS)).isoformat(), "rows": history}
    return ScheduleRequest.model_validate(raw)


def rule(body: dict, values: dict | None = None, hardness: str = "hard", cid: str = "r") -> Rule:
    raw = {
        "id": cid, "type": "rule", "scope": "shop", "hardness": hardness, "source_text": "원문",
        "values": {k: {"value": v, "label": k} for k, v in (values or {}).items()}, "body": body,
    }
    return Rule.model_validate(raw)


def require(per: str, then: dict, when: dict | None = None, **for_each) -> dict:
    body = {"kind": "require", "for_each": {"per": per, **for_each}, "then": then}
    if when is not None:
        body["when"] = when
    return body


def cnt(shifts: list[str] | None = None, not_in: list[str] | None = None, **extra) -> dict:
    return {"shifts": {"in": shifts} if shifts else {"not_in": not_in}, **extra}


def cmp(left: dict, op: str, right) -> dict:
    return {"left": left, "op": op, "right": right}


def rows(**patterns: str) -> dict[str, list[str]]:
    """사람마다 근무 문자열. 빠진 사람은 모두 O."""
    length = len(next(iter(patterns.values())))
    return {n["id"]: list(patterns.get(n["id"], "O" * length)) for n in EMPLOYEES}


def keys(vs: list[RuleViolation]) -> list[tuple[str | None, tuple[int, ...]]]:
    return [(v.instance.employee_id, v.instance.days) for v in vs]


# --- 범위와 인스턴스 ---


def test_instances_period_person_day():
    r = req()
    assert instances(r, rule(require("period", cmp(cnt(["D"]), "le", 99)))) == [Instance(None, ())]
    people = instances(r, rule(require("person", cmp(cnt(["D"]), "le", 99), people={"tags": ["신규"]})))
    assert people == [Instance("n2", ()), Instance("n4", ())]
    days = instances(r, rule(require("day", cmp(cnt(["D"]), "le", 99), days={"kind": "weekend"})))
    assert days == [Instance(None, (d,)) for d in (3, 4, 6, 10, 11)]  # 토·일 + 공휴일 6


def test_person_day_instances_reach_into_carry_only_when_counting_period_cells():
    r = req(carry={"n1": ["O", "N", "N"]})
    # offset (0, 1): 시작 전날(0)의 인스턴스는 1일 칸을 센다. -1 이하는 기간 칸이 없어 평가하지 않는다
    body = require("person_day", {"any": [cmp(cnt(["N"], offset=[0, 0]), "eq", 0), cmp(cnt(["D"], offset=[1, 1]), "eq", 0)]},
                   people={"ids": ["n1"]})
    assert [i.days[0] for i in instances(r, rule(body))] == list(range(0, 15))
    # offset 없음(0, 0): 기간 날짜만
    body = require("person_day", cmp(cnt(["N"]), "le", 1), people={"ids": ["n1"]})
    assert [i.days[0] for i in instances(r, rule(body))] == list(range(1, 15))


def test_week_and_window_boundaries_follow_count_blocks():
    r = req(carry={"n1": ["D", "D", "D", "D"]})  # 이월 -3..0 = 일..수 → 1일(목)이 있는 주는 월(−2)부터
    weeks = instances(r, rule(require("person_week", cmp(cnt(["D"]), "le", 5), people={"ids": ["n1", "n2"]})))
    assert weeks == [
        Instance("n1", (-2, -1, 0, 1, 2, 3, 4)),
        Instance("n1", tuple(range(5, 12))),
        Instance("n1", (12, 13, 14)),  # 잘린 끝 주는 기간 안만
        Instance("n2", (1, 2, 3, 4)),  # 이월이 없으면 기간 첫날부터
        Instance("n2", tuple(range(5, 12))),
        Instance("n2", (12, 13, 14)),
    ]
    windows = instances(r, rule(require("person_window", cmp(cnt(["D"]), "le", 5), people={"ids": ["n1"]}, window=7)))
    assert windows[0] == Instance("n1", tuple(range(-3, 4)))  # 꽉 찬 창만, 이월 포함
    assert windows[-1] == Instance("n1", tuple(range(8, 15)))
    assert len(windows) == 18 - 7 + 1


# --- 세는 칸 ---


def test_day_count_and_who():
    a = rows(n1="DDOOOOOOOOOOOO", n2="DOOOOOOOOOOOOO", n3="OD" + "O" * 12)
    body = require("day", cmp(cnt(["D"], who={"tags": ["신규", "책임"]}), "ge", 1), days={"days": [1, 2, 3]})
    assert keys(evaluate_rule(req(), a, rule(body))) == [(None, (3,))]  # 1: n2, 2: n3, 3: 아무도 없음


def test_value_ref_and_soft_amount_is_distance():
    a = rows(n1="D" * 14)
    body = require("person", cmp(cnt(["O"]), "ge", {"value": "min"}), people={"ids": ["n1", "n2"]})
    (v,) = evaluate_rule(req(), a, rule(body, {"min": 4}, hardness="soft"))
    assert v == RuleViolation(Instance("n1", ()), 4)
    body = require("day", {"all": [cmp(cnt(["D"]), "ge", 2), cmp(cnt(["D"]), "le", 3)]}, days={"days": [1]})
    assert [v.amount for v in evaluate_rule(req(), a, rule(body))] == [1]  # 그리고/또는은 1


def test_hours_amount_rounds_up_to_base_shift():
    a = rows(n1="DDDDDDDOOOOOOO")  # 첫 주(1~4) 4일 = 32시간, 둘째 주(5~11) 3일 = 24시간
    body = require("person_week", cmp(cnt(not_in=["O"], measure="hours"), "le", 20), people={"ids": ["n1"]})
    vs = evaluate_rule(req(), a, rule(body, hardness="soft"))
    assert [(v.instance.days[0], v.amount) for v in vs] == [(1, 2), (5, 1)]  # 12시간 → 2단위, 4시간 → 1단위


def test_unknown_days_count_as_zero():
    # n1 이월 1일(0 = N), 그 앞(-1)과 기간 뒤(15)는 모른다
    r = req(carry={"n1": ["N"]})
    a = rows(n1="D" + "O" * 13)
    nd = require("person_day", {"any": [cmp(cnt(["N"], offset=[0, 0]), "eq", 0), cmp(cnt(["D"], offset=[1, 1]), "eq", 0)]},
                 people={"ids": ["n1"]})
    assert keys(evaluate_rule(r, a, rule(nd))) == [("n1", (0,))]  # 이월 N → 1일 D
    # 그날까지 3일 중 N 2개 이상: -1은 모르니 0으로 센다(0일 N 하나뿐)
    before = require("person_day", cmp(cnt(["N"], offset=[-2, 0]), "ge", 2), people={"ids": ["n1"]}, days={"days": [1]})
    assert keys(evaluate_rule(r, a, rule(before))) == [("n1", (1,))]
    after = require("person_day", cmp(cnt(not_in=["O"], offset=[0, 1]), "ge", 1), people={"ids": ["n1"]},
                    days={"days": [14]})
    assert keys(evaluate_rule(r, a, rule(after))) == [("n1", (14,))]  # 14일 O, 15일은 모름 → 0


def test_when_false_is_not_a_violation():
    a = rows(n1="NDOOOOOOOOOOOO", n2="DOOOOOOOOOOOOO")
    body = require("person_day", cmp(cnt(["O"], offset=[1, 1]), "eq", 1), when=cmp(cnt(["N"]), "ge", 1))
    assert keys(evaluate_rule(req(), a, rule(body))) == [("n1", (1,))]


# --- 고르게 ---


def test_balance_soft_tolerance_and_hard_gap():
    a = rows(n1="NN" + "O" * 12, n2="N" + "O" * 13)
    soft = rule({"kind": "balance", "people": {"ids": ["n1", "n2"]}, "shifts": {"in": ["N"]}}, hardness="soft")
    assert evaluate_rule(req(), a, soft) == []  # 차이 1 ≤ FAIRNESS_TOLERANCE
    hard = rule({"kind": "balance", "people": {"ids": ["n1", "n2"]}, "shifts": {"in": ["N"]}, "max_gap": {"value": "g"}},
                {"g": 0})
    assert evaluate_rule(req(), a, hard) == [RuleViolation(Instance(None, ()), 1)]


def test_balance_counts_history():
    a = rows(n1="N" + "O" * 13, n2="N" + "O" * 13)
    hist = {"n1": ["N"] * 3 + ["O"] * 25}
    body = {"kind": "balance", "people": {"ids": ["n1", "n2"]}, "shifts": {"in": ["N"]}}
    (v,) = evaluate_rule(req(history=hist), a, rule(body))
    assert v.amount == 3
    no_hist = {**body, "with_history": False}
    assert evaluate_rule(req(history=hist), a, rule(no_hist)) == []


# --- 설계 §2.6 새로 표현되는 규칙 ---
# 1=목 2=금 3=토 4=일 5=월


def test_example_conditional_newbie_night_needs_charge():
    a = rows(n2="NNO" + "O" * 11, n3="ONO" + "O" * 11, n4="OON" + "O" * 11)
    body = require("day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge", 1), when=cmp(cnt(["N"], who={"tags": ["신규"]}), "ge", 1))
    assert keys(evaluate_rule(req(), a, rule(body))) == [(None, (1,)), (None, (3,))]


def test_example_pair_not_same_night():
    a = rows(n1="NNO" + "O" * 11, n2="NON" + "O" * 11)
    body = require("day", cmp(cnt(["N"], who={"ids": ["n1", "n2"]}), "le", 1))
    assert keys(evaluate_rule(req(), a, rule(body))) == [(None, (1,))]


def test_example_pair_day_together():
    a = rows(n1="DDO" + "O" * 11, n2="DOD" + "O" * 11)
    body = require("day", cmp(cnt(["D"], who={"ids": ["n1"]}), "eq", cnt(["D"], who={"ids": ["n2"]})))
    assert keys(evaluate_rule(req(), a, rule(body))) == [(None, (2,)), (None, (3,))]


def test_example_count_vs_count():
    a = rows(n2="NN" + "O" * 12, n4="N" + "O" * 13, n3="NO" + "O" * 12)
    body = require("day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge", cnt(["N"], who={"tags": ["신규"]})))
    vs = evaluate_rule(req(), a, rule(body, hardness="soft"))
    assert [(v.instance.days, v.amount) for v in vs] == [((1,), 1), ((2,), 1)]  # 1: 책임 1 < 신규 2, 2: 0 < 1


def test_example_weekend_night_then_monday_off():
    # 4=일 N → 5=월 D(위반). 1=목 N → 2=금 D는 대상 요일이 아니다
    a = rows(n1="NDOND" + "O" * 9)
    body = require("person_day", cmp(cnt(["O"], offset=[1, 1]), "eq", 1), when=cmp(cnt(["N"]), "ge", 1),
                   people={"ids": ["n1"]}, days={"weekdays": [6]})
    assert keys(evaluate_rule(req(), a, rule(body))) == [("n1", (4,))]


def test_example_night_block_two_to_three():
    a = rows(n1="ONOONNNNOO" + "O" * 4, n2="ONNOO" + "O" * 9)
    min_len = require("person_day", cmp(cnt(not_in=["N"], offset=[1, 1]), "eq", 0),
                      when={"all": [cmp(cnt(not_in=["N"], offset=[-1, -1]), "ge", 1), cmp(cnt(["N"]), "ge", 1)]})
    max_len = require("person_window", cmp(cnt(["N"]), "le", {"value": "max_len"}), window=4)
    assert keys(evaluate_rule(req(), a, rule(min_len))) == [("n1", (2,))]  # 2일 단독 나이트
    assert keys(evaluate_rule(req(), a, rule(max_len, {"max_len": 3}))) == [("n1", (5, 6, 7, 8))]


def test_balance_amount_matches_spread():
    a = rows(n1="NNNN" + "O" * 10, n2="O" * 14)
    body = {"kind": "balance", "people": {"ids": ["n1", "n2"]}, "shifts": {"in": ["N"]}, "with_history": False}
    assert evaluate_rule(req(), a, rule(body, hardness="soft")) == [RuleViolation(Instance(None, ()), 4)]
    hours = {**body, "shifts": {"not_in": ["O"]}, "measure": "hours"}
    assert evaluate_rule(req(), a, rule(hours, hardness="soft"))[0].amount == 4  # 32시간 = 기본 근무 4개


# --- stats 연결 ---


def test_stats_violations_for_rule_use_evaluate():
    a = rows(n1="D" * 14)
    body = require("day", cmp(cnt(["D"]), "ge", {"value": "min"}), days={"days": [1, 2]})
    r = rule(body, {"min": 2}, hardness="soft", cid="cov")
    vs = stats.violations(req(), a, r)
    assert [(v.constraint_id, v.employee_id, v.day) for v in vs] == [("cov", None, 1), ("cov", None, 2)]
    assert vs[0].detail == "데이 1명 (기준 2명 이상)"


def test_stats_preference_rule_lists_each_day_like_block():
    a = rows(n1="NDNDOOOOOOOOOO")
    avoid = require("person", cmp(cnt(["N"]), "le", {"value": "max"}), people={"ids": ["n1"]}, days={"days": [1, 2, 3]})
    vs = stats.violations(req(), a, rule(avoid, {"max": 0}, hardness="soft"))
    assert [(v.employee_id, v.day, v.detail) for v in vs] == [
        ("n1", 1, "나이트 배정 (기준 배정 안 함)"),
        ("n1", 3, "나이트 배정 (기준 배정 안 함)"),
    ]
    want = require("person", cmp(cnt(["D"]), "ge", {"value": "min"}), people={"ids": ["n1"]}, days={"days": [1, 2, 3]})
    vs = stats.violations(req(), a, rule(want, {"min": 3}, hardness="soft"))
    assert [(v.day, v.detail) for v in vs] == [(1, "데이 아님 (기준 데이)"), (3, "데이 아님 (기준 데이)")]


def test_describe_violation_general_forms():
    a = rows(n1="DDDDDDDOOOOOOO", n2="NN" + "O" * 12, n3="O" * 14)
    r = req()
    week = rule(require("person_week", cmp(cnt(not_in=["O"], measure="hours"), "le", 20), people={"ids": ["n1"]}))
    assert stats.violations(r, a, week)[0].detail == "주 근무 32시간 (기준 20시간 이하)"
    vs_count = rule(require("day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge", cnt(["N"], who={"tags": ["신규"]})),
                            days={"days": [1]}))
    assert stats.violations(r, a, vs_count)[0].detail == "책임 나이트 0명 (기준 신규 나이트 1명 이상)"
    pair = rule(require("day", {"any": [cmp(cnt(["N"], who={"ids": ["n2"]}), "eq", 0), cmp(cnt(["D"], who={"ids": ["n1"]}), "eq", 0)]},
                        days={"days": [1]}))
    assert stats.violations(r, a, pair)[0].detail == "나 나이트 1명 (기준 0명) · 가 데이 1명 (기준 0명)"
    bal = rule({"kind": "balance", "people": {"ids": ["n1", "n3"]}, "shifts": {"in": ["D"]}, "with_history": False})
    assert stats.violations(r, a, bal)[0].detail == "데이 개수 편차 7"


def test_compute_result_lists_soft_rules():
    a = rows(n1="D" * 14)
    body = require("person", cmp(cnt(["O"]), "ge", {"value": "min"}), people={"ids": ["n1"]})
    r = req(constraints=[rule(body, {"min": 4}, hardness="soft").model_dump(mode="json")])
    res = stats.compute_result(r, a, optimal=True)
    assert [(v.constraint_id, v.employee_id, v.day) for v in res.soft_violations] == [("r", "n1", None)]
    assert res.soft_violations[0].detail == "휴무 0일 (기준 4일 이상)"
