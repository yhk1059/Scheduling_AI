"""explainer(mock 클라이언트)와 결정적 대체 설명. 네트워크와 솔버를 쓰지 않는다."""

import copy
import json
from datetime import date

import pytest

from backend.domain import constants
from backend.domain.models import Conflict, Employee, Period, ScheduleRequest
from backend.llm.client import LLMInvalidOutputError, ToolCallResult
from backend.llm.explainer import explain, fallback_explanation
from backend.llm.prompts import EXPLAIN_SYSTEM, EXPLAIN_TOOL
from backend.tests import rules

EMPLOYEES = [
    Employee(id="e01", name="이영희"),
    Employee(id="e02", name="박민수"),
    Employee(id="e03", name="김지훈", tags=["리더"]),
]

COVERAGE = rules.count("cov", {"in": ["D"]}, "day", 3, 3, days={"kind": "weekend"}, source_text="주말 D 최소 3명")
LEAVE = rules.leave("lv1", "e01", [14, 15], source_text="이영희 14~15일 휴가")
FIXED = rules.fixed("fx1", "e02", 14, "N", source_text="박민수 14일 N 고정")
UNRELATED = rules.forbid("seq", "N", "D", source_text="나이트 다음 날 데이 금지")

REQUEST = ScheduleRequest(
    employees=EMPLOYEES,
    period=Period(start_date=date(2026, 11, 1), length=30),
    holidays=[5],
    constraints=[COVERAGE, LEAVE, FIXED, UNRELATED],
    input_version=3,
)
CONFLICTS = [
    Conflict(constraint_id="cov", type="rule", source_text="주말 D 최소 3명"),
    Conflict(constraint_id="lv1", type="rule", source_text="이영희 14~15일 휴가"),
    Conflict(constraint_id="fx1", type="fixed_assignment", source_text="박민수 14일 N 고정"),
]

TEXT = "e01의 14~15일 휴가 때문에 주말 데이 인원 3명을 채울 수 없습니다. e02도 14일 나이트로 고정되어 있습니다."


def ok(tool_input: dict | None, stop_reason: str = "tool_use") -> ToolCallResult:
    return ToolCallResult(tool_input=tool_input, stop_reason=stop_reason, input_tokens=100, output_tokens=50)


class FakeClient:
    def __init__(self, *responses: ToolCallResult):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        self.calls.append({"system": system, "messages": copy.deepcopy(messages), "tool": tool})
        return self.responses.pop(0)


def proposal(title: str, *changes: dict, description: str = "설명") -> dict:
    return {"title": title, "description": description, "changes": list(changes)}


def disable(cid: str) -> dict:
    return {"action": "disable", "constraint_id": cid}


def set_value(cid: str, name: str, value: float) -> dict:
    return {"action": "set_value", "constraint_id": cid, "name": name, "value": value}


def set_hardness(cid: str, hardness: str = "soft") -> dict:
    return {"action": "set_hardness", "constraint_id": cid, "hardness": hardness}


THREE = [
    proposal("주말 D 최소 2명으로", set_value("cov", "min", 2)),
    proposal("e02 고정 해제", disable("fx1")),
    proposal("주말 D 인원을 soft로", set_hardness("cov")),
]


# --- 정상 경로 ---


def test_explain_text_and_three_proposals():
    client = FakeClient(ok({"text": TEXT, "proposals": THREE}))
    text, proposals = explain(REQUEST, CONFLICTS, client)

    assert text.startswith("이영희의 14~15일 휴가")
    assert "박민수도" in text
    assert [p.title for p in proposals] == ["주말 D 최소 2명으로", "박민수 고정 해제", "주말 D 인원을 soft로"]
    assert proposals[1].changes[0].action == "disable"
    assert proposals[1].changes[0].constraint_id == "fx1"
    assert all(p.verified_summary is None for p in proposals)
    assert len(client.calls) == 1


def test_update_action_is_schema_error_and_retried():
    """블록용 update(params 교체)는 없어졌다(ADR-019 ★7). 스키마 오류로 다시 묻는다."""
    old = {"action": "update", "constraint_id": "cov", "params": {"min": 2}}
    client = FakeClient(
        ok({"text": TEXT, "proposals": [proposal("옛 형식", old)]}),
        ok({"text": TEXT, "proposals": [proposal("정상", set_value("cov", "min", 2))]}),
    )
    _, proposals = explain(REQUEST, CONFLICTS, client)
    assert len(client.calls) == 2
    assert "action" in client.calls[1]["messages"][-1]["content"]
    assert [p.title for p in proposals] == ["정상"]


def test_request_is_pseudonymized_and_uses_tool():
    client = FakeClient(ok({"text": TEXT, "proposals": []}))
    explain(REQUEST, CONFLICTS, client)

    call = client.calls[0]
    assert call["system"] == EXPLAIN_SYSTEM
    assert call["tool"] is EXPLAIN_TOOL
    body = call["messages"][0]["content"]
    assert "이영희" not in body and "박민수" not in body
    assert "e01 14~15일 휴가" in body
    # 충돌 제약만 넣고, 충돌과 무관한 제약은 넣지 않는다
    assert '"cov"' in body and '"lv1"' in body and '"fx1"' in body
    assert '"seq"' not in body
    assert '"hardness": "hard"' in body
    assert '"employee_count": 3' in body
    assert '"not_in": ["O"]' in body  # 식 셀렉터(별칭 그대로)
    context = json.loads(body.split("<context>\n")[1].split("\n</context>")[0])
    assert context["period"] == {"start": "2026-11-01", "end": "2026-11-30", "length": 30}
    assert len(context["days"]) == 30
    assert context["days"][13] == {"day": 14, "date": "2026-11-14"}
    for old in ("target_month", "days_in_month", "period_start", "period_end", "period_length"):
        assert old not in context
    assert context["weekend_and_holiday_days"][:4] == [1, 5, 7, 8]
    assert [s["code"] for s in context["config"]["shifts"]] == ["D", "E", "N", "O"]
    assert context["config"]["shifts"][2] == {"code": "N", "name": "나이트", "hours": 8, "parts": [], "active": True}
    assert {"id": "e03", "tags": ["리더"]} in context["employees"]


def test_context_days_cross_month():
    req = REQUEST.model_copy(update={"period": Period(start_date=date(2026, 11, 23), length=14), "holidays": []})
    client = FakeClient(ok({"text": TEXT, "proposals": []}))
    explain(req, CONFLICTS, client)
    body = client.calls[0]["messages"][0]["content"]
    context = json.loads(body.split("<context>\n")[1].split("\n</context>")[0])
    assert context["period"] == {"start": "2026-11-23", "end": "2026-12-06", "length": 14}
    assert context["days"][8] == {"day": 9, "date": "2026-12-01"}


def test_tool_schema_from_pydantic():
    schema = EXPLAIN_TOOL["input_schema"]
    assert EXPLAIN_TOOL["name"] == "submit_explanation"
    assert set(schema["properties"]) == {"text", "proposals"}
    assert "discriminator" not in json.dumps(schema)


def test_prompt_instructions():
    assert "휴가" in EXPLAIN_SYSTEM and "마지막 수단" in EXPLAIN_SYSTEM
    assert "fixed_assignment" in EXPLAIN_SYSTEM and "disable" in EXPLAIN_SYSTEM
    assert "config.shifts" in EXPLAIN_SYSTEM
    for word in ("balance", "not_in"):
        assert word in EXPLAIN_SYSTEM
    for old in ("daily_coverage", "night_fairness", "sequence", '"update"', "블록"):
        assert old not in EXPLAIN_SYSTEM
    assert "11/30" in EXPLAIN_SYSTEM and "days" in EXPLAIN_SYSTEM
    assert "대상 월" not in EXPLAIN_SYSTEM and "이번 달" not in EXPLAIN_SYSTEM


# --- 후처리 ---


def test_drop_proposal_with_unknown_constraint_id():
    props = [
        proposal("없는 제약", disable("nope")),
        proposal("충돌 아닌 제약", disable("seq")),
        proposal("일부만 없는 id", disable("fx1"), disable("ghost")),
        proposal("정상", disable("lv1")),
    ]
    client = FakeClient(ok({"text": TEXT, "proposals": props}))
    _, proposals = explain(REQUEST, CONFLICTS, client)

    assert [p.title for p in proposals] == ["정상"]


def test_drop_invalid_changes():
    props = [
        proposal("없는 값 이름", set_value("cov", "max", 2)),
        proposal("음수 값", set_value("lv1", "max", -1)),
        proposal("고정 칸 값", set_value("fx1", "min", 1)),
        proposal("고정 칸 가능하면", set_hardness("fx1")),
        proposal("정상", set_value("cov", "min", 2)),
    ]
    client = FakeClient(ok({"text": TEXT, "proposals": props}))
    _, proposals = explain(REQUEST, CONFLICTS, client)

    assert [p.title for p in proposals] == ["정상"]
    assert proposals[0].changes[0].value == 2


def test_proposals_truncated_to_max():
    props = [proposal(f"제안{i}", disable("fx1")) for i in range(5)]
    client = FakeClient(ok({"text": TEXT, "proposals": props}))
    _, proposals = explain(REQUEST, CONFLICTS, client)

    assert len(proposals) == constants.MAX_PROPOSALS
    assert [p.title for p in proposals] == ["제안0", "제안1", "제안2"]


def test_truncation_keeps_valid_proposals_after_dropped_ones():
    props = [proposal("나쁨", disable("nope"))] + [proposal(f"제안{i}", disable("fx1")) for i in range(3)]
    client = FakeClient(ok({"text": TEXT, "proposals": props}))
    _, proposals = explain(REQUEST, CONFLICTS, client)

    assert [p.title for p in proposals] == ["제안0", "제안1", "제안2"]


# --- 재시도 ---


def test_retry_then_success():
    client = FakeClient(
        ok({"text": TEXT, "proposals": [{"title": "x"}]}),
        ok(None),
        ok({"text": TEXT, "proposals": THREE}),
    )
    text, proposals = explain(REQUEST, CONFLICTS, client)

    assert len(client.calls) == 3
    assert len(proposals) == 3
    retry_msg = client.calls[1]["messages"][-1]
    assert retry_msg["role"] == "user" and "오류" in retry_msg["content"]
    assert client.calls[1]["messages"][-2]["role"] == "assistant"


def test_max_tokens_is_retried():
    client = FakeClient(ok({"text": TEXT, "proposals": []}, stop_reason="max_tokens"), ok({"text": TEXT, "proposals": []}))
    explain(REQUEST, CONFLICTS, client)
    assert len(client.calls) == 2


def test_retries_exhausted_raises():
    bad = ok({"proposals": []})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    with pytest.raises(LLMInvalidOutputError):
        explain(REQUEST, CONFLICTS, client)
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES


# --- 이름 복원 ---


def test_names_restored_in_text_title_description():
    props = [proposal("e01 휴가를 가능하면으로", set_hardness("lv1"), description="e01의 14일을 근무로 돌릴 수 있게 합니다.")]
    client = FakeClient(ok({"text": "e01과 e02가 겹칩니다. e03은 무관합니다.", "proposals": props}))
    text, proposals = explain(REQUEST, CONFLICTS, client)

    assert text == "이영희과 박민수가 겹칩니다. 김지훈은 무관합니다."
    assert proposals[0].title == "이영희 휴가를 가능하면으로"
    assert proposals[0].description == "이영희의 14일을 근무로 돌릴 수 있게 합니다."
    assert proposals[0].changes[0].constraint_id == "lv1"


# --- 식 규칙: 값·끄기·가능하면만 ---

COV_RULE = {
    "id": "cov-r",
    "scope": "shop",
    "type": "rule",
    "default": True,
    "values": {"min": {"value": 3, "label": "인원"}},
    "body": {
        "kind": "require",
        "for_each": {"per": "day", "days": {"kind": "weekend"}},
        "then": {"left": {"shifts": {"in": ["D"]}}, "op": "eq", "right": {"value": "min"}},
    },
    "source_text": "주말 데이 3명",
}
MAX_NIGHTS = {
    "id": "mx",
    "scope": "shop",
    "type": "rule",
    "values": {"max_len": {"value": 3, "label": "최대 연속 나이트"}},
    "body": {
        "kind": "require",
        "for_each": {"per": "person_window", "window": 4},
        "then": {"left": {"shifts": {"in": ["N"]}}, "op": "le", "right": {"value": "max_len"}},
    },
    "source_text": "나이트 3연속까지",
}
RULE_REQUEST = ScheduleRequest(
    employees=EMPLOYEES,
    period=Period(start_date=date(2026, 11, 1), length=30),
    holidays=[5],
    constraints=[COV_RULE, MAX_NIGHTS, LEAVE, FIXED, UNRELATED],
    input_version=4,
)
RULE_CONFLICTS = [
    Conflict(constraint_id="cov-r", type="rule", source_text="주말 데이 3명"),
    Conflict(constraint_id="mx", type="rule", source_text="나이트 3연속까지"),
    Conflict(constraint_id="lv1", type="rule", source_text="이영희 14~15일 휴가"),
    Conflict(constraint_id="fx1", type="fixed_assignment", source_text="박민수 14일 N 고정"),
]


def explain_rules(*props: dict) -> list:
    client = FakeClient(ok({"text": TEXT, "proposals": list(props)}))
    _, proposals = explain(RULE_REQUEST, RULE_CONFLICTS, client)
    return proposals


def test_rule_context_has_expression_values_and_source_text():
    client = FakeClient(ok({"text": TEXT, "proposals": []}))
    explain(RULE_REQUEST, RULE_CONFLICTS, client)
    body = client.calls[0]["messages"][0]["content"]
    items = json.loads(body.split("<conflicts>\n")[1].split("\n</conflicts>")[0])
    cov = next(x for x in items if x["id"] == "cov-r")
    assert cov["type"] == "rule" and cov["hardness"] == "hard"
    assert cov["values"] == {"min": {"value": 3, "label": "인원"}}
    assert cov["body"]["for_each"] == {"per": "day", "days": {"kind": "weekend"}}  # 기본값은 빼고 보낸다
    assert cov["body"]["then"]["right"] == {"value": "min"}
    assert cov["source_text"] == "주말 데이 3명"
    assert "params" not in cov
    fx = next(x for x in items if x["id"] == "fx1")
    assert fx["params"] == {"employee_id": "e02", "day": 14, "shift": "N"}  # 칸 고정은 그대로 params


def test_set_value_kept_with_name_and_value():
    (p,) = explain_rules(proposal("최대 연속 나이트 3 → 4", set_value("mx", "max_len", 4)))
    (change,) = p.changes
    assert (change.action, change.constraint_id, change.name, change.value) == ("set_value", "mx", "max_len", 4)
    assert change.hardness is None


def test_set_value_max_run_out_of_window_bounds_rejected():
    """최대 연속은 창도 값+1로 바뀐다. 창이 상한(14일)을 넘는 값은 버린다."""
    props = explain_rules(proposal("14", set_value("mx", "max_len", 14)), proposal("13", set_value("mx", "max_len", 13)))
    assert [p.title for p in props] == ["13"]


def test_set_hardness_and_disable_on_rule_kept():
    props = explain_rules(proposal("가능하면으로", set_hardness("mx")), proposal("끄기", disable("cov-r")))
    assert [p.changes[0].action for p in props] == ["set_hardness", "disable"]
    assert props[0].changes[0].hardness == "soft"


def test_rule_structure_changes_rejected():
    props = explain_rules(
        proposal("없는 값 이름", set_value("mx", "min", 2)),
        proposal("음수 값", set_value("cov-r", "min", -1)),
        proposal("정상과 함께여도", set_value("mx", "max_len", 4), set_value("cov-r", "max", 2)),
        proposal("정상", set_value("cov-r", "min", 2)),
    )
    assert [p.title for p in props] == ["정상"]


def test_set_value_and_set_hardness_rejected_for_fixed():
    props = explain_rules(
        proposal("고정 칸 값", set_value("fx1", "min", 1)),
        proposal("고정 칸 가능하면", set_hardness("fx1")),
        proposal("고정 칸 해제는 그대로", disable("fx1")),
    )
    assert [p.title for p in props] == ["고정 칸 해제는 그대로"]


def test_set_value_without_name_is_schema_error_and_retried():
    bad = {"action": "set_value", "constraint_id": "mx", "value": 4}
    client = FakeClient(
        ok({"text": TEXT, "proposals": [proposal("이름 없음", bad)]}),
        ok({"text": TEXT, "proposals": [proposal("정상", set_value("mx", "max_len", 4))]}),
    )
    _, proposals = explain(RULE_REQUEST, RULE_CONFLICTS, client)
    assert len(client.calls) == 2
    assert "set_value" in client.calls[1]["messages"][-1]["content"]
    assert [p.title for p in proposals] == ["정상"]


def test_prompt_explains_rules_and_relaxation_kinds():
    for word in ("for_each", "when", "then", "values", "label", "set_value", "set_hardness", "해설자"):
        assert word in EXPLAIN_SYSTEM
    assert "구조" in EXPLAIN_SYSTEM and "바꾸지 않는다" in EXPLAIN_SYSTEM


# --- 결정적 대체 경로 ---


def test_fallback_lists_conflict_source_texts():
    text = fallback_explanation(REQUEST, CONFLICTS)
    assert text == (
        "다음 규칙들이 동시에 지켜질 수 없습니다: “주말 D 최소 3명”, “이영희 14~15일 휴가”, “박민수 14일 N 고정”."
    )


def test_fallback_empty_conflicts():
    assert fallback_explanation(REQUEST, []) == "원인을 특정하지 못했습니다. 규칙을 하나씩 꺼서 확인해 주세요."


def test_explainer_does_not_import_solver():
    import backend.llm.explainer as mod

    source = open(mod.__file__, encoding="utf-8").read()
    assert "solver" not in source
