"""explainer(mock 클라이언트)와 결정적 대체 설명. 네트워크와 솔버를 쓰지 않는다."""

import copy
import json
from datetime import date

import pytest

from backend.domain import constants
from backend.domain.models import Conflict, Nurse, Period, ScheduleRequest
from backend.llm.client import LLMInvalidOutputError, ToolCallResult
from backend.llm.explainer import explain, fallback_explanation
from backend.llm.prompts import EXPLAIN_SYSTEM, EXPLAIN_TOOL

NURSES = [
    Nurse(id="n01", name="이영희", years=12),
    Nurse(id="n02", name="박민수", years=9),
    Nurse(id="n03", name="김지훈", years=2),
]

COVERAGE = {
    "id": "cov",
    "scope": "ward",
    "type": "daily_coverage",
    "params": {"shift": "D", "day_kind": "weekend", "min": 3, "max": 3},
    "source_text": "주말 D 최소 3명",
}
LEAVE = {
    "id": "lv1",
    "scope": "period",
    "type": "leave",
    "params": {"nurse_id": "n01", "days": [14, 15]},
    "source_text": "이영희 14~15일 휴가",
}
FIXED = {
    "id": "fx1",
    "scope": "period",
    "type": "fixed_assignment",
    "params": {"nurse_id": "n02", "day": 14, "shift": "N"},
    "source_text": "박민수 14일 N 고정",
}
UNRELATED = {
    "id": "seq",
    "scope": "ward",
    "type": "forbidden_sequence",
    "params": {"first": "N", "second": "D"},
    "source_text": "나이트 다음 날 데이 금지",
}

REQUEST = ScheduleRequest(
    nurses=NURSES,
    period=Period(start_date=date(2026, 11, 1), length=30),
    holidays=[5],
    constraints=[COVERAGE, LEAVE, FIXED, UNRELATED],
    input_version=3,
)
CONFLICTS = [
    Conflict(constraint_id="cov", type="daily_coverage", source_text="주말 D 최소 3명"),
    Conflict(constraint_id="lv1", type="leave", source_text="이영희 14~15일 휴가"),
    Conflict(constraint_id="fx1", type="fixed_assignment", source_text="박민수 14일 N 고정"),
]

TEXT = "n01의 14~15일 휴가 때문에 주말 데이 인원 3명을 채울 수 없습니다. n02도 14일 나이트로 고정되어 있습니다."


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


def update(cid: str, params: dict | None = None, hardness: str | None = None) -> dict:
    d: dict = {"action": "update", "constraint_id": cid}
    if params is not None:
        d["params"] = params
    if hardness is not None:
        d["hardness"] = hardness
    return d


THREE = [
    proposal("주말 D 최소 2명으로", update("cov", {"min": 2, "max": 3})),
    proposal("n02 고정 해제", disable("fx1")),
    proposal("주말 D 인원을 soft로", update("cov", hardness="soft")),
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


def test_update_params_are_merged_into_full_template_params():
    client = FakeClient(ok({"text": TEXT, "proposals": [proposal("완화", update("cov", {"min": 2}))]}))
    _, proposals = explain(REQUEST, CONFLICTS, client)

    assert proposals[0].changes[0].params == {"shift": "D", "day_kind": "weekend", "min": 2, "max": 3}


def test_request_is_pseudonymized_and_uses_tool():
    client = FakeClient(ok({"text": TEXT, "proposals": []}))
    explain(REQUEST, CONFLICTS, client)

    call = client.calls[0]
    assert call["system"] == EXPLAIN_SYSTEM
    assert call["tool"] is EXPLAIN_TOOL
    body = call["messages"][0]["content"]
    assert "이영희" not in body and "박민수" not in body
    assert "n01 14~15일 휴가" in body
    # 충돌 제약만 넣고, 충돌과 무관한 제약은 넣지 않는다
    assert '"cov"' in body and '"lv1"' in body and '"fx1"' in body
    assert "seq" not in body
    assert '"hardness": "hard"' in body
    assert '"nurse_count": 3' in body
    context = json.loads(body.split("<context>\n")[1].split("\n</context>")[0])
    assert (context["period_start"], context["period_end"], context["period_length"]) == ("2026-11-01", "2026-11-30", 30)
    assert "target_month" not in context
    assert context["weekend_and_holiday_days"][:4] == [1, 5, 7, 8]


def test_tool_schema_from_pydantic():
    schema = EXPLAIN_TOOL["input_schema"]
    assert EXPLAIN_TOOL["name"] == "submit_explanation"
    assert set(schema["properties"]) == {"text", "proposals"}
    assert "discriminator" not in json.dumps(schema)


def test_prompt_instructions():
    assert "leave" in EXPLAIN_SYSTEM and "마지막 수단" in EXPLAIN_SYSTEM
    assert "fixed_assignment" in EXPLAIN_SYSTEM and "disable" in EXPLAIN_SYSTEM
    assert "update" in EXPLAIN_SYSTEM


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


def test_drop_update_with_invalid_params():
    props = [
        proposal("min > max", update("cov", {"min": 5, "max": 3})),
        proposal("모르는 키", update("cov", {"minimum": 2})),
        proposal("잘못된 근무", update("fx1", {"shift": "X"})),
        proposal("범위 밖 날짜", update("lv1", {"days": [40]})),
        proposal("명단에 없는 간호사", update("lv1", {"nurse_id": "n99"})),
        proposal("빈 update", update("cov")),
        proposal("정상", update("lv1", {"days": [15]})),
    ]
    client = FakeClient(ok({"text": TEXT, "proposals": props}))
    _, proposals = explain(REQUEST, CONFLICTS, client)

    assert [p.title for p in proposals] == ["정상"]
    assert proposals[0].changes[0].params == {"nurse_id": "n01", "days": [15]}


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
    props = [proposal("n01 휴가 하루 줄이기", update("lv1", {"days": [15]}), description="n01의 14일을 근무로 돌립니다.")]
    client = FakeClient(ok({"text": "n01과 n02가 겹칩니다. n03은 무관합니다.", "proposals": props}))
    text, proposals = explain(REQUEST, CONFLICTS, client)

    assert text == "이영희과 박민수가 겹칩니다. 김지훈은 무관합니다."
    assert proposals[0].title == "이영희 휴가 하루 줄이기"
    assert proposals[0].description == "이영희의 14일을 근무로 돌립니다."
    # params의 nurse_id는 id로 남는다
    assert proposals[0].changes[0].params["nurse_id"] == "n01"


# --- 결정적 대체 경로 ---


def test_fallback_lists_conflict_source_texts():
    text = fallback_explanation(REQUEST, CONFLICTS)
    assert text == "다음 규칙들이 동시에 지켜질 수 없습니다: “주말 D 최소 3명”, “이영희 14~15일 휴가”, “박민수 14일 N 고정”."


def test_fallback_empty_conflicts():
    assert fallback_explanation(REQUEST, []) == "원인을 특정하지 못했습니다. 규칙을 하나씩 꺼서 확인해 주세요."


def test_explainer_does_not_import_solver():
    import backend.llm.explainer as mod

    source = open(mod.__file__, encoding="utf-8").read()
    assert "solver" not in source
