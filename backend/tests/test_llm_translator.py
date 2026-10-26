"""translator(mock 클라이언트), tool 정의, AnthropicClient 예외 매핑. 네트워크를 쓰지 않는다."""

import copy
import json
from datetime import date

import anthropic
import httpx2
import pytest

from backend.domain import constants
from backend.domain.models import (
    Leave,
    Nurse,
    Period,
    TranslateClarify,
    TranslateContext,
    TranslateOk,
    TranslateRequest,
    TranslateUnsupported,
)
from backend.llm.client import (
    AnthropicClient,
    LLMConfigError,
    LLMInvalidOutputError,
    LLMUnavailableError,
    ToolCallResult,
)
from backend.llm.prompts import TRANSLATE_SYSTEM, TRANSLATE_TOOL
from backend.llm.translator import translate

NURSES = [
    Nurse(id="n01", name="이영희", years=12),
    Nurse(id="n02", name="박민수", years=9),
    Nurse(id="n03", name="김민수", years=2),
    Nurse(id="n14", name="문가람", years=11, night_only=True),
]


def request(text: str, scope: str = "month") -> TranslateRequest:
    return TranslateRequest(
        text=text,
        scope=scope,
        context=TranslateContext(nurses=NURSES, period=Period(2026, 11), holidays=[5], today=date(2026, 10, 26)),
        input_version=7,
    )


def ok(tool_input: dict | None, stop_reason: str = "tool_use") -> ToolCallResult:
    return ToolCallResult(tool_input=tool_input, stop_reason=stop_reason, input_tokens=100, output_tokens=50)


class FakeClient:
    def __init__(self, *responses: ToolCallResult):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        self.calls.append({"system": system, "messages": copy.deepcopy(messages), "tool": tool})
        return self.responses.pop(0)


def c(type_: str, params: dict, source_text: str = "원문", hardness: str | None = None) -> dict:
    d = {"type": type_, "params": params, "source_text": source_text}
    if hardness is not None:
        d["hardness"] = hardness
    return d


def last_user_text(call: dict) -> str:
    content = call["messages"][-1]["content"]
    assert call["messages"][-1]["role"] == "user"
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


# --- 정상 경로 ---


def test_translate_two_rules_with_hardness():
    client = FakeClient(
        ok(
            {
                "constraints": [
                    c("off_after_night_block", {"days": 1}, "나이트 다음 날은 무조건 쉬게", "hard"),
                    c("max_consecutive_work", {"days": 5}, "가능하면 5일 넘게 연속 근무 안 하게", "soft"),
                ]
            }
        )
    )
    res = translate(request("나이트 다음 날은 무조건 쉬게, 가능하면 5일 넘게 연속 근무 안 하게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert res.input_version == 7
    a, b = res.constraints
    assert (a.type, a.hardness, a.scope, a.enabled, a.weight) == ("off_after_night_block", "hard", "ward", True, 1)
    assert (b.type, b.hardness, b.weight) == ("max_consecutive_work", "soft", constants.DEFAULT_WEIGHT)
    assert len(a.id) == 8 and a.id != b.id
    assert len(client.calls) == 1


def test_default_hardness_and_soft_weight():
    client = FakeClient(ok({"constraints": [c("night_fairness", {}), c("forbidden_sequence", {"first": "N", "second": "D"})]}))
    res = translate(request("나이트 고르게, 나이트 다음 데이 금지", "ward"), client)
    nf, fs = res.constraints
    assert (nf.hardness, nf.weight) == ("soft", constants.DEFAULT_SOFT_WEIGHTS["night_fairness"])
    assert (fs.hardness, fs.weight) == ("hard", 1)


def test_leave_forced_hard():
    client = FakeClient(ok({"constraints": [c("leave", {"nurse_id": "n01", "days": [15, 16, 17]}, "n01 15~17일 휴가", "soft")]}))
    res = translate(request("이영희 15~17일 휴가"), client)
    (leave,) = res.constraints
    assert isinstance(leave, Leave)
    assert leave.hardness == "hard"
    assert leave.weight == 1
    assert leave.source_text == "이영희 15~17일 휴가"  # 가명 복원


def test_pseudonymized_request_and_context():
    client = FakeClient(ok({"constraints": [c("leave", {"nurse_id": "n01", "days": [15]}, "n01 15일 휴가")]}))
    translate(request("이영희 15일 휴가"), client)
    call = client.calls[0]
    sent = json.dumps(call["messages"], ensure_ascii=False) + call["system"]
    for n in NURSES:
        assert n.name not in sent
    assert "n01 15일 휴가" in sent
    assert "2026-10-26" in sent  # 오늘
    assert call["tool"] is TRANSLATE_TOOL


# --- 재시도 ---


def test_schema_violation_then_success():
    client = FakeClient(
        ok({"constraints": [c("max_consecutive_nights", {"days": "많이"})]}),
        ok({"constraints": [c("max_consecutive_nights", {"days": 3})]}),
    )
    res = translate(request("나이트 3연속까지", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    retry_msg = last_user_text(client.calls[1])
    assert "days" in retry_msg  # 오류 위치 포함
    assert client.calls[1]["messages"][0] == client.calls[0]["messages"][0]


def test_retries_exhausted_raises():
    bad = ok({"constraints": [c("unknown_template", {})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    with pytest.raises(LLMInvalidOutputError):
        translate(request("이상한 규칙"), client)
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES


def test_no_tool_use_retries():
    client = FakeClient(ok(None, "end_turn"), ok({"constraints": [c("min_days_off", {"days": 8})]}))
    res = translate(request("한 달에 8일은 쉬게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2


def test_max_tokens_retries():
    client = FakeClient(
        ok({"constraints": [c("min_days_off", {"days": 8})]}, "max_tokens"),
        ok({"constraints": [c("min_days_off", {"days": 8})]}),
    )
    res = translate(request("한 달에 8일은 쉬게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    assert "잘" in last_user_text(client.calls[1])  # 응답이 잘렸다는 안내


def test_unknown_nurse_clarify():
    bad = ok({"constraints": [c("leave", {"nurse_id": "n99", "days": [3]})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("홍길동 3일 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert "명단" in res.question
    assert res.input_version == 7


def test_out_of_range_day_retry_then_clarify():
    bad = ok({"constraints": [c("fixed_assignment", {"nurse_id": "n02", "day": 32, "shift": "D"})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("박민수 32일 데이"), client)
    assert isinstance(res, TranslateClarify)
    assert "32" in res.question
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES
    assert "32" in last_user_text(client.calls[1])


def test_out_of_range_day_then_fixed():
    client = FakeClient(
        ok({"constraints": [c("leave", {"nurse_id": "n02", "days": [31]})]}),
        ok({"constraints": [c("leave", {"nurse_id": "n02", "days": [30]})]}),
    )
    res = translate(request("박민수 말일 휴가"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].params.days == [30]


# --- clarify / unsupported ---


def test_clarification_question_restored():
    client = FakeClient(ok({"constraints": [], "clarification_question": "n02와 n03 중 누구인가요?"}))
    res = translate(request("민수 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert res.question == "박민수와 김민수 중 누구인가요?"


def test_unsupported_reason():
    client = FakeClient(ok({"constraints": [], "unsupported_reason": "근무 시간 단위 규칙은 지원하지 않습니다"}))
    res = translate(request("데이는 7시 출근"), client)
    assert isinstance(res, TranslateUnsupported)
    assert res.reason == "근무 시간 단위 규칙은 지원하지 않습니다"


def test_empty_constraints_clarify():
    client = FakeClient(ok({"constraints": []}))
    res = translate(request("잘 부탁해"), client)
    assert isinstance(res, TranslateClarify)
    assert "구체적" in res.question


# --- prompts ---


def test_tool_schema_generated_from_models():
    assert TRANSLATE_TOOL["name"] == "submit_constraints"
    schema = TRANSLATE_TOOL["input_schema"]
    assert set(schema["properties"]) == {"constraints", "clarification_question", "unsupported_reason"}
    text = json.dumps(schema)
    for type_ in ("daily_coverage", "leave", "fixed_assignment", "shift_preference", "weekend_fairness"):
        assert type_ in text
    draft_props = [d["properties"] for d in schema["$defs"].values() if "source_text" in d.get("properties", {})]
    assert len(draft_props) == 12
    for props in draft_props:
        assert "id" not in props and "enabled" not in props and "weight" not in props


def test_system_prompt_covers_rules():
    for word in ("무조건", "가능하면", "clarification_question", "unsupported_reason", "다음 주", "3주차"):
        assert word in TRANSLATE_SYSTEM


# --- AnthropicClient 예외 매핑 ---

REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def status_error(cls, code: int):
    return cls("error", response=httpx2.Response(code, request=REQ), body=None)


@pytest.fixture
def sdk_client(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-secret")
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    return AnthropicClient()


def raise_on_create(client: AnthropicClient, monkeypatch, exc: Exception) -> None:
    def create(**_):
        raise exc

    monkeypatch.setattr(client._client.messages, "create", create)


def call(client: AnthropicClient):
    return client.call_tool(system="s", messages=[{"role": "user", "content": "x"}], tool=TRANSLATE_TOOL)


def test_missing_key_config_error(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(LLMConfigError):
        AnthropicClient()


def test_model_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-secret")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-x")
    assert AnthropicClient().model == "claude-x"
    monkeypatch.delenv("ANTHROPIC_MODEL")
    assert AnthropicClient().model == constants.DEFAULT_MODEL


def test_auth_error_maps_to_config(sdk_client, monkeypatch):
    raise_on_create(sdk_client, monkeypatch, status_error(anthropic.AuthenticationError, 401))
    with pytest.raises(LLMConfigError) as exc:
        call(sdk_client)
    assert "sk-test-secret" not in str(exc.value)


@pytest.mark.parametrize(
    "exc",
    [
        status_error(anthropic.RateLimitError, 429),
        status_error(anthropic.OverloadedError, 529),
        status_error(anthropic.InternalServerError, 500),
        anthropic.APITimeoutError(request=REQ),
        anthropic.APIConnectionError(request=REQ),
    ],
)
def test_unavailable_errors(sdk_client, monkeypatch, exc):
    raise_on_create(sdk_client, monkeypatch, exc)
    with pytest.raises(LLMUnavailableError) as err:
        call(sdk_client)
    assert "sk-test-secret" not in str(err.value)


class _Block:
    def __init__(self, type_, name=None, input_=None):
        self.type, self.name, self.input = type_, name, input_


class _Usage:
    input_tokens, output_tokens = 11, 22


class _Message:
    def __init__(self, content, stop_reason):
        self.content, self.stop_reason, self.usage = content, stop_reason, _Usage()


def test_call_tool_requests_tool_and_parses(sdk_client, monkeypatch):
    seen = {}

    def create(**kwargs):
        seen.update(kwargs)
        return _Message([_Block("text"), _Block("tool_use", "submit_constraints", {"constraints": []})], "tool_use")

    monkeypatch.setattr(sdk_client._client.messages, "create", create)
    res = call(sdk_client)
    assert res == ToolCallResult(tool_input={"constraints": []}, stop_reason="tool_use", input_tokens=11, output_tokens=22)
    # Sonnet 5.5는 강제 tool_choice(tool/any)를 400으로 거절한다 → auto + 단일 호출, 강제는 프롬프트와 재시도로
    assert seen["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    assert seen["max_tokens"] == constants.LLM_MAX_TOKENS
    assert seen["timeout"] == constants.LLM_TIMEOUT_S
    assert seen["model"] == constants.DEFAULT_MODEL
    assert "stream" not in seen


def test_call_tool_without_tool_use(sdk_client, monkeypatch):
    monkeypatch.setattr(sdk_client._client.messages, "create", lambda **_: _Message([_Block("text")], "max_tokens"))
    res = call(sdk_client)
    assert res.tool_input is None and res.stop_reason == "max_tokens"
