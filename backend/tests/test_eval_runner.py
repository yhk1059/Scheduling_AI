"""eval/run.py: 의미 기준 채점, 데이터셋 검증, mock 클라이언트 실행 집계, 게이트. 네트워크를 쓰지 않는다."""

import importlib.util
from collections import Counter
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.llm.client import ToolCallResult
from backend.tests import rules as R

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("eval_run", ROOT / "eval" / "run.py")
run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run)

score = run.score_constraints


def leave(employee_id: str, days: list[int], **extra) -> dict:
    """휴가 규칙(변환표 8번 모양)."""
    return R.leave("x", employee_id, days, **extra)


def forbid(*pattern: dict, **extra) -> dict:
    """금지 순서: 사람마다 d부터 pattern이 이어지면 안 된다."""
    then = {"any": [R.cmp(R.cnt(s, (i, i)), "eq", 0) for i, s in enumerate(pattern)]}
    return R.con("x", R.require("person_day", then), **extra)


C_ = {"in": ["C"]}
NF = R.balance("nf", C_)

# 블록(옛 기대값 모양). 채점기·데이터셋 검증이 거절하는지 볼 때만 쓴다
LEAVE_BLOCK = {"type": "count", "hardness": "hard", "params": {"people": {"ids": ["e01"]}, "days": {"days": [15]},
                                                               "shifts": {"not_in": ["O"]}, "per": "person", "max": 0}}
NF_BLOCK = {"type": "balance", "hardness": "soft", "params": {"shifts": {"in": ["C"]}}}
RUC_BLOCK = {"type": "sequence", "hardness": "hard", "params": {"run": {"in": ["C"]}, "max_len": 3}}


# --- 채점(의미 기준) ---


def test_score_order_independent():
    a, b = leave("e01", [15]), NF
    assert score([a, b], [b, a]) == (2, 2, 2)


def test_score_sorts_days():
    assert score([leave("e01", [15, 16, 17])], [leave("e01", [17, 15, 16])]) == (1, 1, 1)


def test_score_ignores_id_source_text_weight_scope():
    actual = leave("e01", [15], id="abc", source_text="이영희 15일 휴가", weight=1, scope="period", enabled=True)
    assert score([leave("e01", [15])], [actual]) == (1, 1, 1)


def test_score_compares_hardness_and_params():
    hard = {**NF, "hardness": "hard"}
    assert score([NF], [hard]) == (0, 1, 1)
    assert score([leave("e01", [15])], [leave("e02", [15])]) == (0, 1, 1)


def test_score_multiset():
    assert score([leave("e01", [1]), leave("e01", [1])], [leave("e01", [1])]) == (1, 2, 1)


def test_score_fills_defaults():
    expected = R.min_off("x", 8)
    then = R.cmp(R.cnt(R.O, measure="count"), "ge", {"value": "min"})
    actual = R.con("x", R.require("person", then, days={"kind": "all"}), {"min": {"value": 8, "label": "최소 휴무 일수"}},
                   priority="normal", enabled=True)
    assert score([expected], [actual]) == (1, 1, 1)


def test_score_rejects_template_expected():
    """기대값은 식 규칙만 쓴다."""
    template = {"type": "leave", "hardness": "hard", "params": {"employee_id": "e01", "days": [15, 16]}}
    with pytest.raises(ValidationError):
        run.score_constraints([template], [leave("e01", [16, 15])])


@pytest.mark.parametrize(
    "block, rule",
    [(LEAVE_BLOCK, leave("e01", [15])), (NF_BLOCK, NF), (RUC_BLOCK, R.max_run("x", C_, 3))],
    ids=("count", "balance", "sequence"),
)
def test_score_rejects_block_specs(block, rule):
    """채점기는 블록을 받지 않는다."""
    with pytest.raises(ValidationError):
        run.score_constraints([block], [rule])


# 같은 규칙의 다른 모양은 일치


def test_same_rule_leave_per_person_vs_per_day():
    per_day = R.count("x", R.WORK, "day", hi=0, people={"ids": ["e01"]}, days={"days": [15, 16, 17]})
    assert score([leave("e01", [15, 16, 17])], [per_day]) == (1, 1, 1)


def test_same_rule_leave_as_off_exactly():
    off = R.count("x", R.O, "person", lo=3, people={"ids": ["e01"]}, days={"days": [15, 16, 17]})
    assert score([leave("e01", [15, 16, 17])], [off]) == (1, 1, 1)


def test_same_rule_in_vs_not_in():
    a = forbid(C_, {"in": ["A", "M"]})
    b = forbid(C_, {"not_in": ["C", "O"]})
    assert score([a], [b]) == (1, 1, 1)


def test_same_rule_selector_list_order():
    a = R.count("x", {"in": ["A", "M"]}, "person", hi=0, people={"ids": ["e01", "e02"]}, days={"weekdays": [0, 4]}, hardness="soft")
    b = R.count("x", {"in": ["M", "A"]}, "person", hi=0, people={"ids": ["e02", "e01"]}, days={"weekdays": [4, 0]}, hardness="soft")
    assert score([a], [b]) == (1, 1, 1)


def test_same_rule_fixed_vs_count():
    fixed = {"type": "fixed_assignment", "hardness": "hard", "params": {"employee_id": "e03", "day": 25, "shift": "C"}}
    once = R.count("x", C_, "person", lo=1, people={"ids": ["e03"]}, days={"days": [25]})
    assert score([fixed], [once]) == (1, 1, 1)


def test_same_rule_off_after_night_vs_forbid():
    after = R.off_after("x", 1, after=C_)
    assert score([after], [forbid(C_, {"not_in": ["C", "O"]})]) == (1, 1, 1)


# 식 규칙: 같은 규칙의 다른 식 모양은 일치(위반은 evaluate.evaluate_rule로 센다)

O_ = {"in": ["O"]}
WORK_ = {"not_in": ["O"]}


def cnt(shifts: dict, **extra) -> dict:
    return {**extra, "shifts": shifts}


def cmp(left: dict, op: str, right) -> dict:
    return {"left": left, "op": op, "right": right}


def rule(for_each: dict, then: dict, when: dict | None = None, values: dict | None = None, **extra) -> dict:
    body = {"kind": "require", "for_each": for_each, "then": then, **({"when": when} if when else {})}
    return {"type": "rule", **extra, **({"values": values} if values else {}), "body": body}


def val(value: float, label: str = "값") -> dict:
    return {"value": value, "label": label}


PAIR_LE = rule({"per": "day"}, cmp(cnt(C_, who={"ids": ["e01", "e02"]}), "le", 1))


def test_same_rule_pair_forbid_le_vs_when():
    when_form = rule({"per": "day"}, cmp(cnt(C_, who={"ids": ["e02"]}), "eq", 0), when=cmp(cnt(C_, who={"ids": ["e01"]}), "ge", 1))
    assert score([PAIR_LE], [when_form]) == (1, 1, 1)


def test_same_rule_window_vs_offset():
    window = rule({"per": "person_window", "window": 4}, cmp(cnt(C_), "le", {"value": "max_len"}), values={"max_len": val(3, "최대 연속 마감")})
    back = rule({"per": "person_day"}, cmp(cnt(C_, offset=[-3, 0]), "le", 3))
    fwd = rule({"per": "person_day"}, cmp(cnt(C_, offset=[0, 3]), "le", 3))
    assert score([window], [back]) == (1, 1, 1)
    assert score([window], [fwd]) == (1, 1, 1)


def test_same_rule_leave_person_vs_person_day():
    person = rule(
        {"per": "person", "people": {"ids": ["e01"]}, "days": {"days": [15, 16, 17]}},
        cmp(cnt(WORK_), "le", {"value": "max"}),
        values={"max": val(0, "최대 횟수")},
    )
    person_day = rule({"per": "person_day", "people": {"ids": ["e01"]}, "days": {"days": [15, 16, 17]}}, cmp(cnt(O_), "eq", 1))
    day = rule({"per": "day", "days": {"days": [15, 16, 17]}}, cmp(cnt(WORK_, who={"ids": ["e01"]}), "le", 0))
    assert score([person], [person_day]) == (1, 1, 1)
    assert score([person], [day]) == (1, 1, 1)


def test_same_rule_expr_in_vs_not_in():
    a = rule({"per": "person_day"}, {"any": [cmp(cnt(C_, offset=[0, 0]), "eq", 0), cmp(cnt({"in": ["A", "M"]}, offset=[1, 1]), "eq", 0)]})
    b = rule({"per": "person_day"}, {"any": [cmp(cnt(C_, offset=[0, 0]), "eq", 0), cmp(cnt({"not_in": ["C", "O"]}, offset=[1, 1]), "eq", 0)]})
    assert score([a], [b]) == (1, 1, 1)


def test_same_rule_value_names_ignored():
    a = rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["A"]}), "ge", {"value": "min"}), values={"min": val(3, "최소 인원")})
    b = rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["A"]}), "ge", {"value": "need"}), values={"need": val(3, "오픈 인원")})
    c = rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["A"]}), "ge", 3))
    assert score([a], [b]) == (1, 1, 1)
    assert score([a], [c]) == (1, 1, 1)


def test_same_rule_block_vs_expr():
    # 변환표 모양(구간 뒤 휴무)과 손으로 쓴 다른 식 모양이 같다
    after = R.off_after("x", 1, after=C_)
    forbid = rule({"per": "person_day"}, {"any": [cmp(cnt(C_, offset=[0, 0]), "eq", 0), cmp(cnt({"not_in": ["C", "O"]}, offset=[1, 1]), "eq", 0)]})
    assert score([after], [forbid]) == (1, 1, 1)


@pytest.mark.parametrize(
    "actual",
    [
        rule({"per": "day"}, cmp(cnt(C_, who={"ids": ["e01", "e03"]}), "le", 1)),  # 대상 하나 다름
        rule({"per": "day"}, cmp(cnt(C_, who={"ids": ["e01", "e02"]}), "le", 0)),  # 숫자 하나 다름
        rule({"per": "day"}, cmp(cnt({"in": ["M"]}, who={"ids": ["e01", "e02"]}), "le", 1)),  # 근무 다름
        rule({"per": "day", "days": {"kind": "weekend"}}, cmp(cnt(C_, who={"ids": ["e01", "e02"]}), "le", 1)),  # 날 다름
        rule({"per": "day"}, cmp(cnt(C_, who={"ids": ["e01", "e02"]}), "le", 1), hardness="soft"),  # 반드시/가능하면
    ],
)
def test_expr_different_rule_mismatch(actual):
    assert score([PAIR_LE], [actual]) == (0, 1, 1)


@pytest.mark.parametrize(
    "expected, actual",
    [
        # 조건부: 조건 태그·결과 태그·인원
        (rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "ge", 1), when=cmp(cnt(C_, who={"tags": ["신입"]}), "ge", 1)),
         rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "ge", 1))),
        (rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "ge", 1), when=cmp(cnt(C_, who={"tags": ["신입"]}), "ge", 1)),
         rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "ge", 2), when=cmp(cnt(C_, who={"tags": ["신입"]}), "ge", 1))),
        # 세기끼리 비교 방향
        (rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "ge", cnt(C_, who={"tags": ["신입"]}))),
         rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "le", cnt(C_, who={"tags": ["신입"]})))),
        # 요일 조건부 순서: 일요일 ↔ 토요일
        (rule({"per": "person_day", "days": {"weekdays": [6]}}, cmp(cnt(O_, offset=[1, 1]), "eq", 1), when=cmp(cnt(C_, offset=[0, 0]), "ge", 1)),
         rule({"per": "person_day", "days": {"weekdays": [5]}}, cmp(cnt(O_, offset=[1, 1]), "eq", 1), when=cmp(cnt(C_, offset=[0, 0]), "ge", 1))),
        # 범위 필요 인원 3~4 ↔ 3 이상
        (rule({"per": "day", "days": {"kind": "weekday"}}, {"all": [cmp(cnt({"in": ["A"]}), "ge", 3), cmp(cnt({"in": ["A"]}), "le", 4)]}),
         rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["A"]}), "ge", 3))),
    ],
)
def test_expr_shapes_mismatch(expected, actual):
    assert score([expected], [actual]) == (0, 1, 1)


# 숫자나 대상이 하나 다르면 불일치


@pytest.mark.parametrize(
    "expected, actual",
    [
        (leave("e01", [15, 16, 17]), leave("e01", [15, 16])),
        (leave("e01", [15]), leave("e01", [16])),
        (R.min_off("x", 8), R.min_off("x", 9)),
        (R.max_run("x", C_, 3), R.max_run("x", C_, 4)),
        (R.off_after("x", 2, after=C_), R.off_after("x", 1, after=C_)),
        (R.min_run("x", C_, 2), R.min_run("x", C_, 3)),
        (R.count("x", {"in": ["A"]}, "day", 3, 4, days={"kind": "weekday"}),
         R.count("x", {"in": ["A"]}, "day", 3, 3, days={"kind": "weekday"})),
        (R.weekly_hours("x", 52), R.weekly_hours("x", 40)),
        (R.window_off("x", 7), R.window_off("x", 8)),
        (R.count("x", {"in": ["A"]}, "day", lo=1, people={"tags": ["리더"]}),
         R.count("x", {"in": ["A"]}, "day", lo=1, people={"tags": ["신입"]})),
    ],
)
def test_different_rule_mismatch(expected, actual):
    assert score([expected], [actual]) == (0, 1, 1)


def test_score_compares_priority_only_when_soft():
    soft = R.min_off("x", 8, hardness="soft")
    assert score([{**soft, "priority": "high"}], [soft]) == (0, 1, 1)
    hard = R.min_off("x", 8)
    assert score([{**hard, "priority": "high"}], [hard]) == (1, 1, 1)


def test_score_rare_violation_distinguished_by_flips():
    # 무작위 근무표에서 한 칸이 정확히 맞기는 드물다. 기대 규칙의 대상 칸을 뒤집은 근무표로 구분한다
    a = R.count("x", {"in": ["A"]}, "person", lo=1, people={"ids": ["e01"]}, days={"days": [15]}, hardness="soft")
    b = R.count("x", {"in": ["M"]}, "person", lo=1, people={"ids": ["e01"]}, days={"days": [15]}, hardness="soft")
    assert score([a], [b]) == (0, 1, 1)


def test_schedules_deterministic():
    case_ = {"id": "x", "today": "2026-10-26", "scope": "shop", "text": "t", "expected": {"status": "ok", "constraints": [leave("e01", [3])]}}
    expected = [run._spec(leave("e01", [3]))]
    s1 = run.judge_schedules(case_, run.judge_config([]), expected)
    s2 = run.judge_schedules(case_, run.judge_config([]), expected)
    assert len(s1) >= run.K_RANDOM
    assert [a for _, a in s1] == [a for _, a in s2]
    assert all(r.carry_over for r, _ in s1)  # 이월 포함


# --- 근무 형태 변경 채점 ---

P = {"action": "add", "shift": {"code": "P", "name": "피크", "hours": 3, "start": "11:00", "end": "14:00"}}
AC = {"action": "add", "shift": {"code": "AC", "name": "더블", "hours": 12, "parts": ["A", "C"]}}


def test_score_config_changes():
    renamed = {"action": "add", "shift": {"code": "P", "name": "피크 근무", "hours": 3, "start": "11:00", "end": "14:00"}}
    assert run.score_config_changes([P], [renamed]) == (1, 1, 1)
    assert run.score_config_changes([P], [{"action": "add", "shift": {**P["shift"], "hours": 4}}]) == (0, 1, 1)
    assert run.score_config_changes([P], [{"action": "add", "shift": {**P["shift"], "end": "15:00"}}]) == (0, 1, 1)  # 시각이 다르면 다른 근무
    assert run.score_config_changes([AC], [{"action": "add", "shift": {**AC["shift"], "parts": ["C", "A"]}}]) == (1, 1, 1)
    assert run.score_config_changes([P, AC], [AC]) == (1, 2, 1)


def test_score_constraints_with_new_code():
    config = run.judge_config([AC])
    a = R.count("x", {"in": ["AC"]}, "person", hi=2)
    b = R.count("x", {"in": ["AC"]}, "person", hi=3)
    assert score([a], [a], config=config) == (1, 1, 1)
    assert score([a], [b], config=config) == (0, 1, 1)
    # 더블 AC가 있어도 in [A, C] ↔ not_in [M, O]는 같다(AC는 A·C를 센다)
    x = R.count("x", {"in": ["A", "C"]}, "day", hi=10)
    y = R.count("x", {"not_in": ["M", "O"]}, "day", hi=10)
    assert score([x], [y], config=config) == (1, 1, 1)


# --- 데이터셋 검증 ---


def case(id_: str, expected: dict, **extra) -> dict:
    return {"id": id_, "set": "basic", "today": "2026-10-26", "scope": "period", "text": "t", "expected": expected, **extra}


def test_validate_dataset_ok():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("e01", [15])]}, holidays=[5]),
        case("b", {"status": "clarify"}),
        case("c", {"status": "ok", "config_changes": [P]}, set="config"),
        case("d", {"status": "ok", "config_changes": [AC], "constraints": [R.count("x", {"in": ["AC"]}, "person", hi=2)]}, set="config"),
        case("e", {"status": "ok", "constraints": [R.count("x", {"in": ["A"]}, "day", lo=1, people={"tags": ["리더"]})]}),
        case("f", {"status": "ok", "constraints": [{"type": "fixed_assignment", "params": {"employee_id": "e03", "day": 25, "shift": "C"}}]}),
        case("g", {"status": "ok", "constraints": [PAIR_LE]}, set="pair"),
        case("h", {"status": "ok", "constraints": [rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["리더"]}), "ge", 1), when=cmp(cnt(C_, who={"tags": ["신입"]}), "ge", 1))]}, set="pair"),
    ]
    assert run.validate_dataset(cases) == []


@pytest.mark.parametrize(
    "cases",
    [
        [case("a", {"status": "clarify"}), case("a", {"status": "clarify"})],  # id 중복
        [case("a", {"status": "maybe"})],  # status 값
        [case("a", {"status": "ok", "constraints": [leave("e99", [15])]})],  # 명단 밖
        [case("a", {"status": "ok", "constraints": [leave("e01", [31])]})],  # 11월 31일
        [case("a", {"status": "ok", "constraints": [{"type": "nope", "params": {}}]})],  # 식 밖
        [case("a", {"status": "ok", "constraints": [{"type": "leave", "hardness": "hard", "params": {"employee_id": "e01", "days": [15]}}]})],  # 템플릿
        [case("a", {"status": "ok", "constraints": [LEAVE_BLOCK]})],  # 블록(식으로 바꾸지 않은 기대값)
        [case("a", {"status": "ok", "constraints": [rule({"per": "day"}, cmp(cnt(C_), "le", 1), values={"max": val(1)})]})],  # 안 쓰는 값
        [case("a", {"status": "ok", "constraints": [rule({"per": "person"}, cmp(cnt(C_, offset=[0, 1]), "le", 1))]})],  # person 범위 offset
        [case("a", {"status": "ok", "constraints": [rule({"per": "day"}, cmp(cnt(C_, who={"tags": ["프리셉터"]}), "ge", 1))]})],  # who에 없는 태그
        [case("a", {"status": "ok", "constraints": []})],  # ok인데 제약·설정 변경 없음
        [case("a", {"status": "clarify", "constraints": [leave("e01", [15])]})],  # clarify인데 제약 있음
        [case("a", {"status": "unsupported", "config_changes": [P]})],  # unsupported인데 설정 변경 있음
        [case("a", {"status": "clarify"}, holidays=[40])],
        [case("a", {"status": "clarify"}, scope="year")],
        [case("a", {"status": "clarify"}, set="other")],  # set 값
        [{k: v for k, v in case("a", {"status": "clarify"}).items() if k != "set"}],  # set 없음
        [case("a", {"status": "ok", "constraints": [R.count("x", {"in": ["X"]}, "day", lo=1)]})],  # 없는 코드
        [case("a", {"status": "ok", "config_changes": [{"action": "add", "shift": {"code": "A", "name": "오픈", "hours": 6, "start": "09:00", "end": "15:00"}}]})],  # 있는 코드 add
        [case("a", {"status": "ok", "constraints": [R.count("x", {"in": ["A"]}, "day", lo=1, people={"tags": ["프리셉터"]})]})],  # 없는 태그
    ],
)
def test_validate_dataset_errors(cases):
    assert run.validate_dataset(cases)


def test_eval_shop_is_sample():
    # eval 매장은 샘플 매장 그대로다: 기본 근무조, 리더 3명, 신입 2명
    shop = run._shop()
    assert [(s["code"], s["start"], s["end"]) for s in shop["config"]["shifts"]] == [
        ("A", "09:00", "15:00"), ("M", "12:00", "18:00"), ("C", "17:00", "23:00"), ("O", None, None)]
    tags = {n["id"]: n["tags"] for n in shop["employees"]}
    assert sum("리더" in t for t in tags.values()) == 3
    assert sum("신입" in t for t in tags.values()) == 2


CROSS = {"start_date": "2026-11-23", "length": 14}


def test_validate_dataset_uses_case_period():
    # 14일 기간에는 15일이 없고, 기본(샘플) 28일 기간에는 있다
    assert run.validate_dataset([case("a", {"status": "ok", "constraints": [leave("e01", [15])]}, period=CROSS)])
    assert run.validate_dataset([case("a", {"status": "ok", "constraints": [leave("e01", [9, 10, 11])]}, period=CROSS)]) == []


@pytest.mark.parametrize("period", [{"start_date": "2026-11-23"}, {"start_date": "x", "length": 14}, {"start_date": "2026-11-23", "length": 40}])
def test_validate_dataset_bad_period(period):
    assert run.validate_dataset([case("a", {"status": "clarify"}, period=period)])


def test_request_period_from_case_or_sample():
    shop = run._shop()
    req = run._request(case("a", {"status": "clarify"}, period=CROSS), shop)
    assert (req.context.period.start_date.isoformat(), req.context.period.length) == ("2026-11-23", 14)
    req = run._request(case("a", {"status": "clarify"}), shop)
    assert req.context.period.model_dump(mode="json") == shop["period"]


def test_real_dataset_has_cross_month_cases():
    cases = [c for c in run.load_dataset(run.DATASET) if "period" in c]
    assert len(cases) >= 4
    assert all(run.Period(**c["period"]).date_of(1).month != run.Period(**c["period"]).date_of(c["period"]["length"]).month for c in cases)


def test_real_dataset_valid():
    cases = run.load_dataset(run.DATASET)
    assert run.validate_dataset(cases) == []
    assert 80 <= len(cases) <= 110
    sets = Counter(c["set"] for c in cases)
    assert sets["time-window"] >= 10
    assert sets["hours"] >= 5
    assert all(sets[s] >= 5 for s in ("tag", "conditional", "pair"))


def test_real_dataset_is_rules():
    types = {c["type"] for case_ in run.load_dataset(run.DATASET) for c in case_["expected"].get("constraints", [])}
    assert types <= {"rule", "fixed_assignment"}


def test_real_dataset_speaks_shop():
    # 옛 근무 코드와 간호 말이 남지 않는다
    for c in run.load_dataset(run.DATASET):
        assert not {"D", "E", "N"} & _codes(c["expected"]), c["id"]
        assert not any(w in c["text"] for w in ("나이트", "이브닝", "데이", "간호", "병동", "쌤", "선생님")), c["id"]


def _codes(node) -> set[str]:
    """기대값에 나온 근무 코드."""
    if isinstance(node, list):
        return set().union(*map(_codes, node)) if node else set()
    if not isinstance(node, dict):
        return set()
    own = set(node.get("in") or []) | set(node.get("not_in") or []) | ({node["shift"]} if isinstance(node.get("shift"), str) else set())
    return own | _codes(list(node.values()))


def test_real_dataset_time_window_shapes():
    # 덮는 근무조 하나, 여럿, 구간이 나뉘는 복합(규칙 2개 이상), 덮는 근무조 없음(clarify)
    cases = [c for c in run.load_dataset(run.DATASET) if c["set"] == "time-window"]
    code_sets = {frozenset(c["left"]["shifts"]["in"]) for case_ in cases for c in _window_cmps(case_)}
    assert {frozenset("A"), frozenset("M"), frozenset("C"), frozenset("AM"), frozenset("MC")} <= code_sets
    assert any(len(c["expected"].get("constraints", [])) >= 2 for c in cases)
    assert any(c["expected"]["status"] == "clarify" for c in cases)


def _window_cmps(case_: dict) -> list[dict]:
    out = []
    for rule_ in case_["expected"].get("constraints", []):
        then = rule_["body"]["then"]
        out += then.get("all", [then])
    return out


# --- mock 실행 ---


def ok(tool_input: dict) -> ToolCallResult:
    return ToolCallResult(tool_input=tool_input, stop_reason="tool_use", input_tokens=100, output_tokens=20)


class FakeClient:
    model = "fake-model"

    def __init__(self, *responses: ToolCallResult):
        self.responses = list(responses)

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        return self.responses.pop(0)


def draft(rule: dict) -> dict:
    """규칙 dict를 translator가 받는 규칙 초안(RuleDraft)으로."""
    return {k: v for k, v in rule.items() if k not in _SERVER_FIELDS}


def leave_draft(employee_id: str, days) -> dict:
    return draft(leave(employee_id, days))


_SERVER_FIELDS = {"id", "scope", "enabled", "default", "type", "weight"}
NF_DRAFT = draft(R.balance("nf", C_, hardness="hard"))


BAD_RULE = {"body": {"kind": "require", "for_each": {"per": "person"}, "then": "많이"}, "source_text": "원문"}  # 스키마 위반


def test_score_compares_expected_with_draft_actual():
    actual = {**leave_draft("e01", [16, 15]), "type": "rule"}
    del actual["source_text"]
    assert score([leave("e01", [15, 16])], [actual]) == (1, 1, 1)
    assert score([NF], [{**NF_DRAFT, "type": "rule", "hardness": "soft"}]) == (1, 1, 1)
    assert score([NF], [{**NF_DRAFT, "type": "rule"}]) == (0, 1, 1)


def test_run_cases_aggregates():
    cases = [
        case(
            "a",
            {"status": "ok", "constraints": [leave("e01", [15, 16]), NF]},
            scope="shop",
        ),
        case("b", {"status": "clarify"}),
    ]
    client = FakeClient(
        ok({"rules": [BAD_RULE]}),  # 스키마 위반 → 재시도
        ok({"rules": [leave_draft("e01", [16, 15]), NF_DRAFT]}),
        ok({"unsupported_reason": "템플릿 없음"}),
    )
    results = run.run_cases(cases, client)
    m = run.aggregate(results)

    a, b = results
    assert (a.status, a.retries, a.tp, a.n_expected, a.n_actual, a.exact) == ("ok", 1, 1, 2, 2, False)
    assert (b.status, b.retries, b.exact) == ("unsupported", 0, False)

    assert m["cases"] == 2
    assert m["schema_valid_rate"] == 1.0
    assert m["status_accuracy"] == 0.5
    assert m["precision"] == 0.5 and m["recall"] == 0.5 and m["f1"] == 0.5
    assert m["exact_match_rate"] == 0.0
    assert m["clarify_accuracy"] == 0.0
    assert m["unsupported_accuracy"] is None
    assert m["avg_retries"] == 0.5
    assert m["input_tokens"] == 300 and m["output_tokens"] == 60


def test_run_cases_exact_and_error():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("e01", [15])]}),
        case("b", {"status": "ok", "constraints": [leave("e02", [3])]}),
    ]
    bad = ok({"rules": [BAD_RULE]})
    client = FakeClient(ok({"rules": [leave_draft("e01", [15])]}), bad, bad, bad)
    results = run.run_cases(cases, client)
    m = run.aggregate(results)

    assert results[0].exact is True
    assert results[1].status is None and "LLMInvalidOutputError" in results[1].error
    assert m["schema_valid_rate"] == 0.5
    assert m["exact_match_rate"] == 0.5
    assert m["recall"] == 0.5 and m["precision"] == 1.0
    assert m["avg_retries"] == 1.0  # (0 + 2) / 2


def test_write_results(tmp_path):
    cases = [case("a", {"status": "clarify"})]
    results = run.run_cases(cases, FakeClient(ok({"rules": [leave_draft("e01", [1])]})))
    out = tmp_path / "results.md"
    run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "fake-model" in text and "| a |" in text and "clarify" in text


def test_run_case_config_changes():
    de_rule = R.count("x", {"in": ["AC"]}, "person", hi=2)
    cases = [case("a", {"status": "ok", "config_changes": [AC], "constraints": [de_rule]}, set="config", scope="shop")]
    client = FakeClient(ok({"config_changes": [AC], "rules": [draft(de_rule)]}))
    (r,) = run.run_cases(cases, client)
    assert (r.tp, r.n_expected, r.n_actual, r.exact, r.set) == (2, 2, 2, True, "config")
    assert r.actual_changes == [AC["shift"] | {"start": None, "end": None, "active": True}]

    client = FakeClient(ok({"config_changes": [AC], "rules": [draft(R.count("x", {"in": ["AC"]}, "person", hi=3))]}))
    (r,) = run.run_cases(cases, client)
    assert (r.tp, r.exact) == (1, False)


def test_aggregate_by_set_and_gate():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("e01", [15])]}),
        case("b", {"status": "clarify"}),
        case("c", {"status": "unsupported"}, set="time-window"),
    ]
    client = FakeClient(
        ok({"rules": [leave_draft("e01", [15])]}),
        ok({"clarification_question": "누구?"}),
        ok({"clarification_question": "뭐?"}),
    )
    results = run.run_cases(cases, client)
    by_set = run.aggregate_by_set(results)
    assert by_set["basic"]["exact_match_rate"] == 1.0 and by_set["basic"]["cases"] == 2
    assert by_set["time-window"]["exact_match_rate"] == 0.0
    failures = run.gate_failures(run.aggregate(results), by_set)
    assert any(f.startswith("전체") for f in failures) and any(f.startswith("time-window") for f in failures)


def test_gate_targets():
    assert run.GATE_TOTAL_EXACT == 0.9
    assert run.GATE_EXACT == {"time-window": 0.9}
    tw = lambda rate: {"time-window": {"exact_match_rate": rate, "cases": 10}}  # noqa: E731
    assert run.gate_failures({"exact_match_rate": 0.9}, tw(0.9)) == []
    assert run.gate_failures({"exact_match_rate": 0.89}, tw(1.0))
    assert run.gate_failures({"exact_match_rate": 1.0}, tw(0.8))
    assert run.gate_failures({"exact_match_rate": 1.0}, {})  # time-window를 돌리지 않으면 미달


def test_gate_report_prints_sets_and_verdict():
    good = {"exact_match_rate": 0.95, "schema_valid_rate": 1.0}
    sets = {"basic": {"exact_match_rate": 1.0, "cases": 2}, "time-window": {"exact_match_rate": 0.9, "cases": 10}}
    text = "\n".join(run.gate_report(good, sets))
    assert "basic 100.0% (2개)" in text and "time-window 90.0% (10개)" in text
    assert "전체 ≥ 90%" in text and "합격" in text and "불합격" not in text
    assert "불합격" in "\n".join(run.gate_report({"exact_match_rate": 0.5, "schema_valid_rate": 1.0}, sets))


def test_write_results_set_table(tmp_path):
    cases = [case("a", {"status": "clarify"}), case("b", {"status": "clarify"}, set="hours")]
    results = run.run_cases(cases, FakeClient(ok({"clarification_question": "?"}), ok({"clarification_question": "?"})))
    out = tmp_path / "results.md"
    run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "## 묶음별 정확도" in text and "| basic |" in text and "| hours |" in text and "불합격" in text


def test_write_results_history(tmp_path):
    cases = [case("a", {"status": "clarify"}), case("b", {"status": "clarify"}, set="pair")]
    out = tmp_path / "results.md"
    for _ in range(2):
        results = run.run_cases(cases, FakeClient(ok({"clarification_question": "?"}), ok({"clarification_question": "?"})))
        run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "| pair |" in text
    history = text.split("## 실행 이력", 1)[1].split("\n## ", 1)[0]
    assert sum(line.startswith("| 20") for line in history.splitlines()) == 2  # 실행마다 한 줄씩 쌓인다


def test_write_results_drops_old_history_rows(tmp_path):
    # 묶음이 다른 옛 이력 행은 열이 맞지 않아 옮기지 않는다
    out = tmp_path / "results.md"
    out.write_text("## 실행 이력\n\n| 2026-10-30 | `m` | 105 | 98% | 100% | 100% | 98% | 100% | 통과 |\n", encoding="utf-8")
    assert run._history_rows(out) == []


def test_gate_exit_1(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(run, "load_local_env", lambda *a, **k: None)
    monkeypatch.setattr(run, "RESULTS", tmp_path / "results.md")
    monkeypatch.setattr(run, "AnthropicClient", lambda: FakeClient(*[ok({"unsupported_reason": "x"})] * 200))
    monkeypatch.setattr(run, "_select", lambda cases, ids, limit: cases[:2])
    assert run.main(["--gate"]) == 1
    assert (tmp_path / "results.md").exists()


# --- CLI ---


def test_dry_run_exit_0(capsys):
    assert run.main(["--dry-run"]) == 0


def test_missing_key_exit_2(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(run, "load_local_env", lambda *a, **k: None)
    assert run.main(["--limit", "1"]) == 2
    assert "ANTHROPIC_API_KEY가 없습니다" in capsys.readouterr().err


def test_score_keeps_forbid_pattern_order():
    ca, cm, ac = (forbid({"in": [x]}, {"in": [y]}) for x, y in ("CA", "CM", "AC"))
    # 금지 패턴 여럿은 패턴마다 규칙이라 규칙 단위로 맞춘다
    assert score([ca, cm], [cm, ca]) == (2, 2, 2)
    assert score([ca], [ac]) == (0, 1, 1)
