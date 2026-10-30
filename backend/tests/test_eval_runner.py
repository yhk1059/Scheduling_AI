"""eval/run.py: 의미 기준 채점, 데이터셋 검증, mock 클라이언트 실행 집계, 게이트. 네트워크를 쓰지 않는다."""

import importlib.util
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.domain.convert import block_to_rules
from backend.llm.client import ToolCallResult

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("eval_run", ROOT / "eval" / "run.py")
run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run)


def count(params: dict, hardness: str | None = None, **extra) -> dict:
    c = {"type": "count", "params": params, **extra}
    if hardness:
        c["hardness"] = hardness
    return c


def leave(nurse_id: str, days: list[int], **extra) -> dict:
    """휴가 블록(변환표 8번 모양)."""
    params = {"people": {"ids": [nurse_id]}, "days": {"days": days}, "shifts": {"not_in": ["O"]}, "per": "person", "max": 0}
    return count(params, "hard", **extra)


NF = {"type": "balance", "hardness": "soft", "params": {"people": {"exclude_tags": ["나이트전담"]}, "shifts": {"in": ["N"]}}}


def seq(params: dict, hardness: str = "hard") -> dict:
    return {"type": "sequence", "hardness": hardness, "params": params}


# --- 채점(의미 기준) ---


def test_score_order_independent():
    a, b = leave("n01", [15]), NF
    assert run.score_constraints([a, b], [b, a]) == (2, 2, 2)


def test_score_sorts_days():
    assert run.score_constraints([leave("n01", [15, 16, 17])], [leave("n01", [17, 15, 16])]) == (1, 1, 1)


def test_score_ignores_id_source_text_weight_scope():
    actual = leave("n01", [15], id="abc", source_text="이영희 15일 휴가", weight=1, scope="period", enabled=True)
    assert run.score_constraints([leave("n01", [15])], [actual]) == (1, 1, 1)


def test_score_compares_hardness_and_params():
    hard = {**NF, "hardness": "hard"}
    assert run.score_constraints([NF], [hard]) == (0, 1, 1)
    assert run.score_constraints([leave("n01", [15])], [leave("n02", [15])]) == (0, 1, 1)


def test_score_multiset():
    assert run.score_constraints([leave("n01", [1]), leave("n01", [1])], [leave("n01", [1])]) == (1, 2, 1)


def test_score_fills_defaults():
    expected = count({"shifts": {"in": ["O"]}, "per": "person", "min": 8})
    actual = count({"people": {}, "days": {"kind": "all"}, "shifts": {"in": ["O"]}, "per": "person", "measure": "count", "min": 8}, "hard")
    assert run.score_constraints([expected], [actual]) == (1, 1, 1)


def test_score_rejects_template_expected():
    """기대값은 블록만 쓴다(템플릿은 step 5에서 모두 바꿨다)."""
    template = {"type": "leave", "hardness": "hard", "params": {"nurse_id": "n01", "days": [15, 16]}}
    with pytest.raises(ValidationError):
        run.score_constraints([template], [leave("n01", [16, 15])])


# 같은 규칙의 다른 모양은 일치


def test_same_rule_leave_per_person_vs_per_day():
    per_day = count({"people": {"ids": ["n01"]}, "days": {"days": [15, 16, 17]}, "shifts": {"not_in": ["O"]}, "per": "day", "max": 0}, "hard")
    assert run.score_constraints([leave("n01", [15, 16, 17])], [per_day]) == (1, 1, 1)


def test_same_rule_leave_as_off_exactly():
    off = count({"people": {"ids": ["n01"]}, "days": {"days": [15, 16, 17]}, "shifts": {"in": ["O"]}, "per": "person", "min": 3}, "hard")
    assert run.score_constraints([leave("n01", [15, 16, 17])], [off]) == (1, 1, 1)


def test_same_rule_in_vs_not_in():
    a = seq({"forbid": [[{"in": ["N"]}, {"in": ["D", "E"]}]]})
    b = seq({"forbid": [[{"in": ["N"]}, {"not_in": ["N", "O"]}]]})
    assert run.score_constraints([a], [b]) == (1, 1, 1)


def test_same_rule_selector_list_order():
    a = count({"people": {"ids": ["n01", "n02"]}, "days": {"weekdays": [0, 4]}, "shifts": {"in": ["D", "E"]}, "per": "person", "max": 0}, "soft")
    b = count({"people": {"ids": ["n02", "n01"]}, "days": {"weekdays": [4, 0]}, "shifts": {"in": ["E", "D"]}, "per": "person", "max": 0}, "soft")
    assert run.score_constraints([a], [b]) == (1, 1, 1)


def test_same_rule_fixed_vs_count():
    fixed = {"type": "fixed_assignment", "hardness": "hard", "params": {"nurse_id": "n03", "day": 25, "shift": "N"}}
    block = count({"people": {"ids": ["n03"]}, "days": {"days": [25]}, "shifts": {"in": ["N"]}, "per": "person", "min": 1}, "hard")
    assert run.score_constraints([fixed], [block]) == (1, 1, 1)


def test_same_rule_off_after_night_vs_forbid():
    after = seq({"after": {"in": ["N"]}, "then_off": 1})
    forbid = seq({"forbid": [[{"in": ["N"]}, {"not_in": ["N", "O"]}]]})
    assert run.score_constraints([after], [forbid]) == (1, 1, 1)


# 식 규칙: 같은 규칙의 다른 식 모양은 일치(위반은 evaluate.evaluate_rule로 센다)

N_ = {"in": ["N"]}
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


PAIR_LE = rule({"per": "day"}, cmp(cnt(N_, who={"ids": ["n01", "n02"]}), "le", 1))


def test_same_rule_pair_forbid_le_vs_when():
    when_form = rule({"per": "day"}, cmp(cnt(N_, who={"ids": ["n02"]}), "eq", 0), when=cmp(cnt(N_, who={"ids": ["n01"]}), "ge", 1))
    assert run.score_constraints([PAIR_LE], [when_form]) == (1, 1, 1)


def test_same_rule_window_vs_offset():
    window = rule({"per": "person_window", "window": 4}, cmp(cnt(N_), "le", {"value": "max_len"}), values={"max_len": val(3, "최대 연속 나이트")})
    back = rule({"per": "person_day"}, cmp(cnt(N_, offset=[-3, 0]), "le", 3))
    fwd = rule({"per": "person_day"}, cmp(cnt(N_, offset=[0, 3]), "le", 3))
    assert run.score_constraints([window], [back]) == (1, 1, 1)
    assert run.score_constraints([window], [fwd]) == (1, 1, 1)


def test_same_rule_leave_person_vs_person_day():
    person = rule(
        {"per": "person", "people": {"ids": ["n01"]}, "days": {"days": [15, 16, 17]}},
        cmp(cnt(WORK_), "le", {"value": "max"}),
        values={"max": val(0, "최대 횟수")},
    )
    person_day = rule({"per": "person_day", "people": {"ids": ["n01"]}, "days": {"days": [15, 16, 17]}}, cmp(cnt(O_), "eq", 1))
    day = rule({"per": "day", "days": {"days": [15, 16, 17]}}, cmp(cnt(WORK_, who={"ids": ["n01"]}), "le", 0))
    assert run.score_constraints([person], [person_day]) == (1, 1, 1)
    assert run.score_constraints([person], [day]) == (1, 1, 1)


def test_same_rule_expr_in_vs_not_in():
    a = rule({"per": "person_day"}, {"any": [cmp(cnt(N_, offset=[0, 0]), "eq", 0), cmp(cnt({"in": ["D", "E"]}, offset=[1, 1]), "eq", 0)]})
    b = rule({"per": "person_day"}, {"any": [cmp(cnt(N_, offset=[0, 0]), "eq", 0), cmp(cnt({"not_in": ["N", "O"]}, offset=[1, 1]), "eq", 0)]})
    assert run.score_constraints([a], [b]) == (1, 1, 1)


def test_same_rule_value_names_ignored():
    a = rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["D"]}), "ge", {"value": "min"}), values={"min": val(3, "최소 인원")})
    b = rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["D"]}), "ge", {"value": "need"}), values={"need": val(3, "데이 인원")})
    c = rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["D"]}), "ge", 3))
    assert run.score_constraints([a], [b]) == (1, 1, 1)
    assert run.score_constraints([a], [c]) == (1, 1, 1)


def test_same_rule_block_vs_expr():
    # 블록(옛 기대값)은 식으로 바꿔 같은 단위로 비교한다
    after = seq({"after": {"in": ["N"]}, "then_off": 1})
    forbid = rule({"per": "person_day"}, {"any": [cmp(cnt(N_, offset=[0, 0]), "eq", 0), cmp(cnt({"not_in": ["N", "O"]}, offset=[1, 1]), "eq", 0)]})
    assert run.score_constraints([after], [forbid]) == (1, 1, 1)


@pytest.mark.parametrize(
    "actual",
    [
        rule({"per": "day"}, cmp(cnt(N_, who={"ids": ["n01", "n03"]}), "le", 1)),  # 대상 하나 다름
        rule({"per": "day"}, cmp(cnt(N_, who={"ids": ["n01", "n02"]}), "le", 0)),  # 숫자 하나 다름
        rule({"per": "day"}, cmp(cnt({"in": ["E"]}, who={"ids": ["n01", "n02"]}), "le", 1)),  # 근무 다름
        rule({"per": "day", "days": {"kind": "weekend"}}, cmp(cnt(N_, who={"ids": ["n01", "n02"]}), "le", 1)),  # 날 다름
        rule({"per": "day"}, cmp(cnt(N_, who={"ids": ["n01", "n02"]}), "le", 1), hardness="soft"),  # 반드시/가능하면
    ],
)
def test_expr_different_rule_mismatch(actual):
    assert run.score_constraints([PAIR_LE], [actual]) == (0, 1, 1)


@pytest.mark.parametrize(
    "expected, actual",
    [
        # 조건부: 조건 태그·결과 태그·인원
        (rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "ge", 1), when=cmp(cnt(N_, who={"tags": ["신규"]}), "ge", 1)),
         rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "ge", 1))),
        (rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "ge", 1), when=cmp(cnt(N_, who={"tags": ["신규"]}), "ge", 1)),
         rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "ge", 2), when=cmp(cnt(N_, who={"tags": ["신규"]}), "ge", 1))),
        # 세기끼리 비교 방향
        (rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "ge", cnt(N_, who={"tags": ["신규"]}))),
         rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "le", cnt(N_, who={"tags": ["신규"]})))),
        # 요일 조건부 순서: 일요일 ↔ 토요일
        (rule({"per": "person_day", "days": {"weekdays": [6]}}, cmp(cnt(O_, offset=[1, 1]), "eq", 1), when=cmp(cnt(N_, offset=[0, 0]), "ge", 1)),
         rule({"per": "person_day", "days": {"weekdays": [5]}}, cmp(cnt(O_, offset=[1, 1]), "eq", 1), when=cmp(cnt(N_, offset=[0, 0]), "ge", 1))),
        # 범위 필요 인원 3~4 ↔ 3 이상
        (rule({"per": "day", "days": {"kind": "weekday"}}, {"all": [cmp(cnt({"in": ["D"]}), "ge", 3), cmp(cnt({"in": ["D"]}), "le", 4)]}),
         rule({"per": "day", "days": {"kind": "weekday"}}, cmp(cnt({"in": ["D"]}), "ge", 3))),
    ],
)
def test_expr_shapes_mismatch(expected, actual):
    assert run.score_constraints([expected], [actual]) == (0, 1, 1)


# 숫자나 대상이 하나 다르면 불일치


@pytest.mark.parametrize(
    "expected, actual",
    [
        (leave("n01", [15, 16, 17]), leave("n01", [15, 16])),
        (leave("n01", [15]), leave("n01", [16])),
        (count({"shifts": {"in": ["O"]}, "per": "person", "min": 8}), count({"shifts": {"in": ["O"]}, "per": "person", "min": 9})),
        (seq({"run": {"in": ["N"]}, "max_len": 3}), seq({"run": {"in": ["N"]}, "max_len": 4})),
        (seq({"after": {"in": ["N"]}, "then_off": 2}), seq({"after": {"in": ["N"]}, "then_off": 1})),
        (seq({"run": {"in": ["N"]}, "min_len": 2}), seq({"run": {"in": ["N"]}, "min_len": 3})),
        (count({"days": {"kind": "weekday"}, "shifts": {"in": ["D"]}, "per": "day", "min": 3, "max": 4}),
         count({"days": {"kind": "weekday"}, "shifts": {"in": ["D"]}, "per": "day", "min": 3, "max": 3})),
        (count({"people": {"min_years": 3}, "shifts": {"in": ["N"]}, "per": "day", "min": 1}),
         count({"people": {"min_years": 4}, "shifts": {"in": ["N"]}, "per": "day", "min": 1})),
        (count({"shifts": {"not_in": ["O"]}, "per": "person_week", "measure": "hours", "max": 52}),
         count({"shifts": {"not_in": ["O"]}, "per": "person_week", "measure": "hours", "max": 40})),
        (count({"shifts": {"in": ["O"]}, "per": "person_window", "window": 7, "min": 1}),
         count({"shifts": {"in": ["O"]}, "per": "person_window", "window": 8, "min": 1})),
        (count({"people": {"tags": ["책임"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1}),
         count({"people": {"tags": ["신규"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1})),
        (NF, {"type": "balance", "hardness": "soft", "params": {"shifts": {"in": ["N"]}}}),
    ],
)
def test_different_rule_mismatch(expected, actual):
    assert run.score_constraints([expected], [actual]) == (0, 1, 1)


def test_score_compares_priority_only_when_soft():
    soft = count({"shifts": {"in": ["O"]}, "per": "person", "min": 8}, "soft")
    assert run.score_constraints([{**soft, "priority": "high"}], [soft]) == (0, 1, 1)
    hard = count({"shifts": {"in": ["O"]}, "per": "person", "min": 8}, "hard")
    assert run.score_constraints([{**hard, "priority": "high"}], [hard]) == (1, 1, 1)


def test_score_rare_violation_distinguished_by_flips():
    # 무작위 근무표에서 한 칸이 정확히 맞기는 드물다. 기대 블록의 대상 칸을 뒤집은 근무표로 구분한다
    a = count({"people": {"ids": ["n01"]}, "days": {"days": [15]}, "shifts": {"in": ["D"]}, "per": "person", "min": 1}, "soft")
    b = count({"people": {"ids": ["n01"]}, "days": {"days": [15]}, "shifts": {"in": ["E"]}, "per": "person", "min": 1}, "soft")
    assert run.score_constraints([a], [b]) == (0, 1, 1)


def test_schedules_deterministic():
    case_ = {"id": "x", "today": "2026-10-26", "scope": "ward", "text": "t", "expected": {"status": "ok", "constraints": [leave("n01", [3])]}}
    expected = run._as_rules([run._spec(leave("n01", [3]))])
    s1 = run.judge_schedules(case_, run.judge_config([]), expected)
    s2 = run.judge_schedules(case_, run.judge_config([]), expected)
    assert len(s1) >= run.K_RANDOM
    assert [a for _, a in s1] == [a for _, a in s2]
    assert all(r.carry_over for r, _ in s1)  # 이월 포함


# --- 근무 형태 변경 채점 ---

M = {"action": "add", "shift": {"code": "M", "name": "미드", "hours": 8, "start": "11:00"}}
DE = {"action": "add", "shift": {"code": "DE", "name": "더블", "hours": 16, "parts": ["D", "E"]}}


def test_score_config_changes():
    renamed = {"action": "add", "shift": {"code": "M", "name": "미드 근무", "hours": 8}}
    assert run.score_config_changes([M], [renamed]) == (1, 1, 1)
    assert run.score_config_changes([M], [{"action": "add", "shift": {**M["shift"], "hours": 9}}]) == (0, 1, 1)
    assert run.score_config_changes([DE], [{"action": "add", "shift": {**DE["shift"], "parts": ["E", "D"]}}]) == (1, 1, 1)
    assert run.score_config_changes([M, DE], [DE]) == (1, 2, 1)


def test_score_constraints_with_new_code():
    config = run.judge_config([DE])
    a = count({"shifts": {"in": ["DE"]}, "per": "person", "max": 2})
    b = count({"shifts": {"in": ["DE"]}, "per": "person", "max": 3})
    assert run.score_constraints([a], [a], config=config) == (1, 1, 1)
    assert run.score_constraints([a], [b], config=config) == (0, 1, 1)
    # 더블 DE가 있어도 in [D, E] ↔ not_in [N, O]는 같다(DE는 D·E를 센다)
    x = count({"shifts": {"in": ["D", "E"]}, "per": "day", "max": 10})
    y = count({"shifts": {"not_in": ["N", "O"]}, "per": "day", "max": 10})
    assert run.score_constraints([x], [y], config=config) == (1, 1, 1)


# --- 데이터셋 검증 ---


def case(id_: str, expected: dict, **extra) -> dict:
    return {"id": id_, "set": "legacy", "today": "2026-10-26", "scope": "period", "text": "t", "expected": expected, **extra}


def as_rules(*blocks: dict) -> list[dict]:
    """블록을 데이터셋 기대값 형식(식 규칙)으로(convert_dataset.py와 같은 변환)."""
    return [run._dump(r) for b in blocks for r in block_to_rules(run._spec(b))]


def test_validate_dataset_ok():
    cases = [
        case("a", {"status": "ok", "constraints": as_rules(leave("n01", [15]))}, holidays=[5]),
        case("b", {"status": "clarify"}),
        case("c", {"status": "ok", "config_changes": [M]}, set="new"),
        case("d", {"status": "ok", "config_changes": [DE], "constraints": as_rules(count({"shifts": {"in": ["DE"]}, "per": "person", "max": 2}))}, set="new"),
        case("e", {"status": "ok", "constraints": as_rules(count({"people": {"tags": ["책임"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1}))}),
        case("f", {"status": "ok", "constraints": [{"type": "fixed_assignment", "params": {"nurse_id": "n03", "day": 25, "shift": "N"}}]}),
        case("g", {"status": "ok", "constraints": [PAIR_LE]}, set="expr"),
        case("h", {"status": "ok", "constraints": [rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["책임"]}), "ge", 1), when=cmp(cnt(N_, who={"tags": ["신규"]}), "ge", 1))]}, set="expr"),
    ]
    assert run.validate_dataset(cases) == []


@pytest.mark.parametrize(
    "cases",
    [
        [case("a", {"status": "clarify"}), case("a", {"status": "clarify"})],  # id 중복
        [case("a", {"status": "maybe"})],  # status 값
        [case("a", {"status": "ok", "constraints": as_rules(leave("n99", [15]))})],  # 명단 밖
        [case("a", {"status": "ok", "constraints": as_rules(leave("n01", [31]))})],  # 11월 31일
        [case("a", {"status": "ok", "constraints": [{"type": "nope", "params": {}}]})],  # 식 밖
        [case("a", {"status": "ok", "constraints": [{"type": "leave", "hardness": "hard", "params": {"nurse_id": "n01", "days": [15]}}]})],  # 템플릿
        [case("a", {"status": "ok", "constraints": [leave("n01", [15])]})],  # 블록(식으로 바꾸지 않은 기대값)
        [case("a", {"status": "ok", "constraints": [rule({"per": "day"}, cmp(cnt(N_), "le", 1), values={"max": val(1)})]})],  # 안 쓰는 값
        [case("a", {"status": "ok", "constraints": [rule({"per": "person"}, cmp(cnt(N_, offset=[0, 1]), "le", 1))]})],  # person 범위 offset
        [case("a", {"status": "ok", "constraints": [rule({"per": "day"}, cmp(cnt(N_, who={"tags": ["프리셉터"]}), "ge", 1))]})],  # who에 없는 태그
        [case("a", {"status": "ok", "constraints": []})],  # ok인데 제약·설정 변경 없음
        [case("a", {"status": "clarify", "constraints": [leave("n01", [15])]})],  # clarify인데 제약 있음
        [case("a", {"status": "unsupported", "config_changes": [M]})],  # unsupported인데 설정 변경 있음
        [case("a", {"status": "clarify"}, holidays=[40])],
        [case("a", {"status": "clarify"}, scope="year")],
        [case("a", {"status": "clarify"}, set="other")],  # set 값
        [{k: v for k, v in case("a", {"status": "clarify"}).items() if k != "set"}],  # set 없음
        [case("a", {"status": "ok", "constraints": as_rules(count({"shifts": {"in": ["M"]}, "per": "day", "min": 1}))})],  # 없는 코드
        [case("a", {"status": "ok", "config_changes": [{"action": "add", "shift": {"code": "D", "name": "데이", "hours": 8}}]})],  # 있는 코드 add
        [case("a", {"status": "ok", "constraints": as_rules(count({"people": {"tags": ["프리셉터"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1}))})],  # 없는 태그
    ],
)
def test_validate_dataset_errors(cases):
    assert run.validate_dataset(cases)


def test_eval_ward_tags():
    ward = run._ward()
    tags = {n["id"]: n.get("tags", []) for n in ward["nurses"]}
    assert sum("책임" in t for t in tags.values()) == 2
    assert sum("신규" in t for t in tags.values()) == 3
    assert {i for i, t in tags.items() if "나이트전담" in t} == {"n14", "n15"}


CROSS = {"start_date": "2026-11-23", "length": 14}


def test_validate_dataset_uses_case_period():
    # 14일 기간에는 15일이 없고, 기본(샘플) 30일 기간에는 있다
    assert run.validate_dataset([case("a", {"status": "ok", "constraints": as_rules(leave("n01", [15]))}, period=CROSS)])
    assert run.validate_dataset([case("a", {"status": "ok", "constraints": as_rules(leave("n01", [9, 10, 11]))}, period=CROSS)]) == []


@pytest.mark.parametrize("period", [{"start_date": "2026-11-23"}, {"start_date": "x", "length": 14}, {"start_date": "2026-11-23", "length": 40}])
def test_validate_dataset_bad_period(period):
    assert run.validate_dataset([case("a", {"status": "clarify"}, period=period)])


def test_request_period_from_case_or_sample():
    ward = run._ward()
    req = run._request(case("a", {"status": "clarify"}, period=CROSS), ward)
    assert (req.context.period.start_date.isoformat(), req.context.period.length) == ("2026-11-23", 14)
    req = run._request(case("a", {"status": "clarify"}), ward)
    assert req.context.period.model_dump(mode="json") == ward["period"]


def test_real_dataset_has_cross_month_cases():
    cases = [c for c in run.load_dataset(run.DATASET) if "period" in c]
    assert len(cases) >= 4
    assert all(run.Period(**c["period"]).date_of(1).month != run.Period(**c["period"]).date_of(c["period"]["length"]).month for c in cases)


def test_real_dataset_valid():
    cases = run.load_dataset(run.DATASET)
    assert run.validate_dataset(cases) == []
    sets = [c["set"] for c in cases]
    assert sets.count("legacy") == 49  # 기존 케이스 전부(w·h·m·c·u 44건 + 기간 경계 p 5건)
    assert sets.count("new") == 30
    assert sets.count("expr") >= 20


def test_real_dataset_is_rules():
    # 기존 케이스는 convert_dataset.py로 기계 변환한 식 규칙(블록·템플릿 type이 남지 않는다)
    types = {c["type"] for case_ in run.load_dataset(run.DATASET) for c in case_["expected"].get("constraints", [])}
    assert types <= {"rule", "fixed_assignment"}


def test_real_dataset_pair_rules_supported():
    # ADR-019: 짝 규칙은 이제 식으로 세운다(옛 unsupported 기대값을 바꿨다)
    by_id = {c["id"]: c for c in run.load_dataset(run.DATASET)}
    assert by_id["u01"]["expected"]["status"] == "ok"
    assert by_id["b29"]["expected"]["status"] == "ok"
    assert {c["expected"]["status"] for c in by_id.values() if c["set"] == "expr"} == {"ok", "clarify", "unsupported"}


def test_convert_dataset_blocks_to_rules():
    spec = importlib.util.spec_from_file_location("convert_dataset", ROOT / "eval" / "convert_dataset.py")
    conv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(conv)
    block_case = case("a", {"status": "ok", "constraints": [seq({"run": {"in": ["N"]}, "min_len": 2, "max_len": 3})]})
    out = conv.convert_case(block_case, run._ward())
    assert [c["type"] for c in out["expected"]["constraints"]] == ["rule", "rule"]
    assert out["set"] == "legacy"
    assert conv.convert_case(out, run._ward()) == out  # 여러 번 실행해도 같다


# --- mock 실행 ---


def ok(tool_input: dict) -> ToolCallResult:
    return ToolCallResult(tool_input=tool_input, stop_reason="tool_use", input_tokens=100, output_tokens=20)


class FakeClient:
    model = "fake-model"

    def __init__(self, *responses: ToolCallResult):
        self.responses = list(responses)

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        return self.responses.pop(0)


def draft(type_: str, params: dict, hardness: str | None = None) -> dict:
    d = {"type": type_, "params": params, "source_text": "원문"}
    if hardness:
        d["hardness"] = hardness
    return d


def leave_draft(nurse_id: str, days) -> dict:
    """translator가 내는 블록 모양의 휴가."""
    params = {"people": {"ids": [nurse_id]}, "days": {"days": days}, "shifts": {"not_in": ["O"]}, "per": "person", "max": 0}
    return draft("count", params)


NF_DRAFT = draft("balance", {"people": {"exclude_tags": ["나이트전담"]}, "shifts": {"in": ["N"]}}, "hard")
_SERVER_FIELDS = {"id", "scope", "enabled", "default", "type", "weight"}


BAD_RULE = {"body": {"kind": "require", "for_each": {"per": "person"}, "then": "많이"}, "source_text": "원문"}  # 스키마 위반


def rules(*blocks: dict) -> list[dict]:
    """블록 초안을 translator가 받는 규칙 초안(RuleDraft)으로(설계 §2.5 변환표)."""
    return [r.model_dump(mode="json", exclude=_SERVER_FIELDS) for b in blocks for r in block_to_rules(run._spec(b))]


def test_score_compares_expected_with_draft_actual():
    block = {**leave_draft("n01", [16, 15]), "hardness": "hard"}
    del block["source_text"]
    assert run.score_constraints([leave("n01", [15, 16])], [block]) == (1, 1, 1)
    assert run.score_constraints([NF], [{**NF_DRAFT, "hardness": "soft"}]) == (1, 1, 1)
    assert run.score_constraints([NF], [NF_DRAFT]) == (0, 1, 1)


def test_run_cases_aggregates():
    cases = [
        case(
            "a",
            {"status": "ok", "constraints": [leave("n01", [15, 16]), NF]},
            scope="ward",
        ),
        case("b", {"status": "clarify"}),
    ]
    client = FakeClient(
        ok({"rules": [BAD_RULE]}),  # 스키마 위반 → 재시도
        ok({"rules": rules(leave_draft("n01", [16, 15]), NF_DRAFT)}),
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
        case("a", {"status": "ok", "constraints": [leave("n01", [15])]}),
        case("b", {"status": "ok", "constraints": [leave("n02", [3])]}),
    ]
    bad = ok({"rules": [BAD_RULE]})
    client = FakeClient(ok({"rules": rules(leave_draft("n01", [15]))}), bad, bad, bad)
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
    results = run.run_cases(cases, FakeClient(ok({"rules": rules(leave_draft("n01", [1]))})))
    out = tmp_path / "results.md"
    run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "fake-model" in text and "| a |" in text and "clarify" in text


def test_run_case_config_changes():
    de_rule = count({"shifts": {"in": ["DE"]}, "per": "person", "max": 2})
    cases = [case("a", {"status": "ok", "config_changes": [DE], "constraints": [de_rule]}, set="new", scope="ward")]
    client = FakeClient(ok({"config_changes": [DE], "rules": rules(draft("count", de_rule["params"]))}))
    (r,) = run.run_cases(cases, client)
    assert (r.tp, r.n_expected, r.n_actual, r.exact, r.set) == (2, 2, 2, True, "new")
    assert r.actual_changes == [DE["shift"] | {"start": None, "active": True}]

    client = FakeClient(ok({"config_changes": [DE], "rules": rules(draft("count", {**de_rule["params"], "max": 3}))}))
    (r,) = run.run_cases(cases, client)
    assert (r.tp, r.exact) == (1, False)


def test_aggregate_by_set_and_gate():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("n01", [15])]}),
        case("b", {"status": "clarify"}),
        case("c", {"status": "unsupported"}, set="new"),
    ]
    client = FakeClient(
        ok({"rules": rules(leave_draft("n01", [15]))}),
        ok({"clarification_question": "누구?"}),
        ok({"clarification_question": "뭐?"}),
    )
    results = run.run_cases(cases, client)
    by_set = run.aggregate_by_set(results)
    assert by_set["legacy"]["exact_match_rate"] == 1.0 and by_set["legacy"]["cases"] == 2
    assert by_set["new"]["exact_match_rate"] == 0.0
    failures = run.gate_failures(run.aggregate(results), by_set)
    assert any(f.startswith("new") for f in failures) and not any(f.startswith("legacy") for f in failures)


def by_set(**rates) -> dict:
    return {s: {"exact_match_rate": r, "cases": n} for s, (r, n) in rates.items()}


def test_gate_targets():
    assert run.GATE_EXACT == {"legacy": 0.95, "new": 0.95, "expr": 0.85}
    assert run.GATE_PRIOR_EXACT == 0.95 and run.PRIOR_SETS == ("legacy", "new")
    assert run.GATE_SCHEMA_VALID == 1.0
    ok_metrics = {"schema_valid_rate": 1.0}
    assert run.gate_failures(ok_metrics, by_set(legacy=(0.96, 49), new=(0.96, 30), expr=(0.85, 20))) == []
    assert run.gate_failures({"schema_valid_rate": 0.99}, by_set(legacy=(1.0, 49), new=(1.0, 30), expr=(1.0, 20)))
    assert any("expr" in f for f in run.gate_failures(ok_metrics, by_set(legacy=(1.0, 49), new=(1.0, 30), expr=(0.8, 20))))
    assert any("new" in f for f in run.gate_failures(ok_metrics, by_set(legacy=(1.0, 49), new=(0.9, 30), expr=(1.0, 20))))
    assert any("expr" in f for f in run.gate_failures(ok_metrics, by_set(legacy=(1.0, 49), new=(1.0, 30))))  # set이 없으면 미달


def test_gate_prior_total():
    # 기존 79건 합산: legacy 47/49 + new 28/30 = 75/79 = 94.9% < 95%
    rates = by_set(legacy=(47 / 49, 49), new=(28 / 30, 30), expr=(1.0, 20))
    failures = run.gate_failures({"schema_valid_rate": 1.0}, rates)
    assert any("기존" in f for f in failures)


def test_write_results_set_table(tmp_path):
    cases = [case("a", {"status": "clarify"}), case("b", {"status": "clarify"}, set="new")]
    results = run.run_cases(cases, FakeClient(ok({"clarification_question": "?"}), ok({"clarification_question": "?"})))
    out = tmp_path / "results.md"
    run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "## set별 지표" in text and "| legacy |" in text and "| new |" in text


def test_write_results_history(tmp_path):
    cases = [case("a", {"status": "clarify"}), case("b", {"status": "clarify"}, set="expr")]
    out = tmp_path / "results.md"
    for _ in range(2):
        results = run.run_cases(cases, FakeClient(ok({"clarification_question": "?"}), ok({"clarification_question": "?"})))
        run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "| expr |" in text
    history = text.split("## 실행 이력", 1)[1].split("\n## ", 1)[0]
    assert sum(line.startswith("| 20") for line in history.splitlines()) == 2  # 실행마다 한 줄씩 쌓인다


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
    def forbid(*patterns):
        return {"type": "sequence", "hardness": "hard", "params": {"forbid": [[{"in": [a]}, {"in": [b]}] for a, b in patterns]}}

    # 금지 패턴 여럿은 패턴마다 규칙으로 나뉘어 규칙 단위로 맞춘다
    assert run.score_constraints([forbid(("N", "D"), ("N", "E"))], [forbid(("N", "E"), ("N", "D"))]) == (2, 2, 2)
    assert run.score_constraints([forbid(("N", "D"))], [forbid(("D", "N"))]) == (0, 1, 1)
