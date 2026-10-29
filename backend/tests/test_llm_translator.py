"""translator(mock 클라이언트), tool 정의, AnthropicClient 예외 매핑. 네트워크를 쓰지 않는다."""

import copy
import json
from datetime import date

import anthropic
import httpx2
import pytest

from backend.domain import constants
from backend.domain.models import (
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
    Nurse(id="n14", name="문가람", years=11, tags=["나이트전담"]),
]


NOV = Period(start_date=date(2026, 11, 1), length=30)
CROSS = Period(start_date=date(2026, 11, 23), length=14)  # 11/23(월) ~ 12/6(일)


def request(text: str, scope: str = "period", period: Period = NOV, holidays: list[int] | None = None, today: date = date(2026, 10, 26)) -> TranslateRequest:
    return TranslateRequest(
        text=text,
        scope=scope,
        context=TranslateContext(nurses=NURSES, period=period, holidays=[5] if holidays is None else holidays, today=today),
        input_version=7,
    )


def sent_context(call: dict) -> dict:
    body = call["messages"][0]["content"]
    return json.loads(body.split("<context>\n")[1].split("\n</context>")[0])


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


# --- 블록 초안 ---

NOT_OFF = {"not_in": ["O"]}


def count(params: dict, source_text: str = "원문", **extra) -> dict:
    return {"type": "count", "params": params, "source_text": source_text, **extra}


def seq(params: dict, source_text: str = "원문", **extra) -> dict:
    return {"type": "sequence", "params": params, "source_text": source_text, **extra}


def balance(params: dict, source_text: str = "원문", **extra) -> dict:
    return {"type": "balance", "params": params, "source_text": source_text, **extra}


def leave(nurse_id: str, days: list[int], source_text: str = "원문") -> dict:
    return count(
        {"people": {"ids": [nurse_id]}, "days": {"days": days}, "shifts": NOT_OFF, "per": "person", "max": 0},
        source_text,
    )


NIGHT_FAIR = balance({"people": {"exclude_tags": ["나이트전담"]}, "shifts": {"in": ["N"]}})
MID = {"code": "M", "name": "미드", "hours": 8, "start": "11:00"}


# --- 정상 경로 ---


def test_context_has_period_and_days():
    client = FakeClient(ok({"constraints": [NIGHT_FAIR]}))
    translate(request("나이트 공평하게"), client)
    context = sent_context(client.calls[0])
    assert context["today"] == "2026-10-26" and context["today_weekday"] == "Monday"
    assert context["period"] == {"start": "2026-11-01", "end": "2026-11-30", "length": 30}
    assert len(context["days"]) == 30
    assert context["days"][0] == {"day": 1, "date": "2026-11-01", "weekday": "Sun", "weekend": True}
    assert context["days"][4] == {"day": 5, "date": "2026-11-05", "weekday": "Thu", "weekend": True}  # 공휴일
    assert context["days"][5]["weekend"] is False
    assert context["weekend_and_holiday_days"][:3] == [1, 5, 7]
    assert context["holidays"] == [5]
    for old in ("period_start", "period_end", "period_length", "first_day_weekday", "target_month", "days_in_month"):
        assert old not in context


def test_context_has_config_tags_and_known_tags():
    nurses = [*NURSES[:3], Nurse(id="n04", name="정유진", years=5, tags=["책임"])]
    req = request("나이트 공평하게")
    req = req.model_copy(update={"context": req.context.model_copy(update={"nurses": nurses + NURSES[3:]})})
    client = FakeClient(ok({"constraints": [NIGHT_FAIR]}))
    translate(req, client)
    context = sent_context(client.calls[0])
    assert [s["code"] for s in context["config"]["shifts"]] == ["D", "E", "N", "O"]
    assert context["config"]["shifts"][0] == {"code": "D", "name": "데이", "hours": 8, "parts": [], "active": True}
    by_id = {n["id"]: n for n in context["nurses"]}
    assert by_id["n04"] == {"id": "n04", "years": 5, "tags": ["책임"]}
    assert by_id["n14"]["tags"] == ["나이트전담"]
    assert context["known_tags"] == ["나이트전담", "책임"]


def test_context_cross_month_period():
    client = FakeClient(ok({"constraints": [NIGHT_FAIR]}))
    translate(request("나이트 공평하게", period=CROSS, holidays=[], today=date(2026, 11, 20)), client)
    context = sent_context(client.calls[0])
    assert context["today_weekday"] == "Friday"
    assert context["period"] == {"start": "2026-11-23", "end": "2026-12-06", "length": 14}
    assert [d["day"] for d in context["days"]] == list(range(1, 15))
    assert context["days"][0] == {"day": 1, "date": "2026-11-23", "weekday": "Mon", "weekend": False}
    assert context["days"][8] == {"day": 9, "date": "2026-12-01", "weekday": "Tue", "weekend": False}
    assert context["days"][13]["date"] == "2026-12-06"
    assert context["weekend_and_holiday_days"] == [6, 7, 13, 14]


def test_translate_blocks_with_hardness_and_priority():
    client = FakeClient(
        ok(
            {
                "constraints": [
                    seq({"after": {"in": ["N"]}, "then_off": 1}, "나이트 다음 날은 무조건 쉬게", hardness="hard"),
                    seq({"run": NOT_OFF, "max_len": 5}, "웬만하면 5일 넘게 연속 근무 안 하게", hardness="soft", priority="high"),
                ]
            }
        )
    )
    res = translate(request("나이트 다음 날은 무조건 쉬게, 웬만하면 5일 넘게 연속 근무 안 하게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert res.input_version == 7
    assert res.config_changes == []
    a, b = res.constraints
    assert (a.type, a.hardness, a.scope, a.enabled) == ("sequence", "hard", "ward", True)
    assert a.params.after.in_ == ["N"] and a.params.then_off == 1
    assert (b.hardness, b.priority, b.weight) == ("soft", "high", constants.PRIORITY_WEIGHTS["high"])
    assert len(a.id) == 8 and a.id != b.id
    assert len(client.calls) == 1


def test_default_hardness_and_priority():
    client = FakeClient(
        ok({"constraints": [NIGHT_FAIR, seq({"forbid": [[{"in": ["N"]}, {"in": ["D"]}]]})]})
    )
    res = translate(request("나이트 고르게, 나이트 다음 데이 금지", "ward"), client)
    nf, fs = res.constraints
    assert (nf.type, nf.hardness, nf.priority, nf.weight) == ("balance", "soft", "low", constants.PRIORITY_WEIGHTS["low"])
    assert (fs.type, fs.hardness, fs.priority) == ("sequence", "hard", "normal")


def test_leave_block_and_pseudonym_restored():
    client = FakeClient(ok({"constraints": [leave("n01", [15, 16, 17], "n01 15~17일 휴가")]}))
    res = translate(request("이영희 15~17일 휴가"), client)
    (rule,) = res.constraints
    assert rule.type == "count" and rule.hardness == "hard" and rule.scope == "period"
    assert rule.params.people.ids == ["n01"] and rule.params.max == 0
    assert rule.source_text == "이영희 15~17일 휴가"  # 가명 복원


def test_config_change_with_dependent_block():
    client = FakeClient(
        ok(
            {
                "config_changes": [{"action": "add", "shift": MID}],
                "constraints": [
                    count({"days": {"kind": "weekday"}, "shifts": {"in": ["M"]}, "per": "day", "min": 1}, "평일 미드 1명")
                ],
            }
        )
    )
    res = translate(request("미드 근무 M 11시~19시 추가하고 평일엔 미드 1명", "ward"), client)
    assert isinstance(res, TranslateOk)
    (change,) = res.config_changes
    assert change.action == "add" and change.shift.code == "M" and change.shift.hours == 8
    assert res.constraints[0].params.shifts.in_ == ["M"]


def test_config_change_only_is_ok():
    double = {"code": "DE", "name": "더블", "hours": 16, "parts": ["D", "E"]}
    client = FakeClient(ok({"config_changes": [{"action": "add", "shift": double}]}))
    res = translate(request("D+E 더블 허용", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints == [] and res.config_changes[0].shift.parts == ["D", "E"]


def test_config_change_update_existing():
    client = FakeClient(ok({"config_changes": [{"action": "update", "shift": {"code": "N", "name": "나이트", "hours": 10}}]}))
    res = translate(request("나이트는 10시간", "ward"), client)
    assert res.config_changes[0].shift.hours == 10


@pytest.mark.parametrize(
    "change",
    [
        {"action": "add", "shift": {"code": "D", "name": "데이", "hours": 8}},  # 이미 있음
        {"action": "update", "shift": {"code": "M", "name": "미드", "hours": 8}},  # 없는 코드
        {"action": "update", "shift": {"code": "O", "name": "쉼", "hours": 0}},  # 휴무는 바꿀 수 없음
        {"action": "add", "shift": {"code": "DM", "name": "더블", "hours": 16, "parts": ["D", "M"]}},  # 없는 parts
    ],
)
def test_invalid_config_change_retry_then_clarify(change):
    bad = ok({"config_changes": [change]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("근무 바꿔줘", "ward"), client)
    assert isinstance(res, TranslateClarify)
    assert "근무" in res.question
    assert "config_changes" in last_user_text(client.calls[1])


def test_config_change_over_code_limit_clarify():
    extra = [{"action": "add", "shift": {"code": f"X{i}", "name": f"근무{i}", "hours": 8}} for i in range(constants.MAX_SHIFT_CODES - 3)]
    bad = ok({"config_changes": extra})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("근무 많이 추가", "ward"), client)
    assert isinstance(res, TranslateClarify)
    assert str(constants.MAX_SHIFT_CODES) in last_user_text(client.calls[1])


def test_pseudonymized_request_and_context():
    client = FakeClient(ok({"constraints": [leave("n01", [15], "n01 15일 휴가")]}))
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
        ok({"constraints": [seq({"run": {"in": ["N"]}, "max_len": "많이"})]}),
        ok({"constraints": [seq({"run": {"in": ["N"]}, "max_len": 3})]}),
    )
    res = translate(request("나이트 3연속까지", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    retry_msg = last_user_text(client.calls[1])
    assert "max_len" in retry_msg  # 오류 위치 포함
    assert client.calls[1]["messages"][0] == client.calls[0]["messages"][0]


@pytest.mark.parametrize(
    "draft",
    [
        {"type": "leave", "params": {"nurse_id": "n01", "days": [3]}, "source_text": "x"},  # 템플릿은 더 이상 받지 않는다
        {"type": "fixed_assignment", "params": {"nurse_id": "n01", "day": 3, "shift": "D"}, "source_text": "x"},
        {"type": "unknown", "params": {}, "source_text": "x"},
    ],
)
def test_non_block_output_retries_then_raises(draft):
    bad = ok({"constraints": [draft]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    with pytest.raises(LLMInvalidOutputError):
        translate(request("이상한 규칙"), client)
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES


def test_no_tool_use_retries():
    min_off = count({"shifts": {"in": ["O"]}, "per": "person", "min": 8})
    client = FakeClient(ok(None, "end_turn"), ok({"constraints": [min_off]}))
    res = translate(request("한 달에 8일은 쉬게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2


def test_max_tokens_retries():
    min_off = count({"shifts": {"in": ["O"]}, "per": "person", "min": 8})
    client = FakeClient(ok({"constraints": [min_off]}, "max_tokens"), ok({"constraints": [min_off]}))
    res = translate(request("한 달에 8일은 쉬게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    assert "잘" in last_user_text(client.calls[1])  # 응답이 잘렸다는 안내


def test_unknown_nurse_clarify():
    bad = ok({"constraints": [leave("n99", [3])]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("홍길동 3일 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert "명단" in res.question
    assert res.input_version == 7


def test_unknown_code_retry_then_clarify():
    bad = ok({"constraints": [count({"shifts": {"in": ["M"]}, "per": "day", "min": 1})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("미드 1명씩", "ward"), client)
    assert isinstance(res, TranslateClarify)
    assert "M" in res.question
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES
    assert "M" in last_user_text(client.calls[1])


def test_unknown_code_then_fixed_with_config_change():
    rule = count({"shifts": {"in": ["M"]}, "per": "day", "min": 1})
    client = FakeClient(
        ok({"constraints": [rule]}),
        ok({"constraints": [rule], "config_changes": [{"action": "add", "shift": MID}]}),
    )
    res = translate(request("미드 근무 만들고 매일 1명", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert [c.shift.code for c in res.config_changes] == ["M"]


def test_unknown_tag_clarify():
    bad = ok({"constraints": [count({"people": {"tags": ["책임"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("책임 간호사 1명은 데이에", "ward"), client)
    assert isinstance(res, TranslateClarify)
    assert "책임" in res.question
    assert "책임" in last_user_text(client.calls[1])


def test_empty_people_clarify():
    # 3년차 이상 아무도 없는 연차 범위 → 사람 0명
    bad = ok({"constraints": [count({"people": {"min_years": 30}, "shifts": {"in": ["D"]}, "per": "day", "min": 1})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("30년차 이상 1명은 데이에", "ward"), client)
    assert isinstance(res, TranslateClarify)
    assert "간호사가 없어요" in res.question


def test_empty_days_clarify():
    # 11/2(월)·11/3(화) 중 토요일 → 0일
    bad = ok({"constraints": [count({"days": {"days": [2, 3], "weekdays": [5]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("2~3일 토요일 데이 1명", "period"), client)
    assert isinstance(res, TranslateClarify)
    assert "날이 없어요" in res.question


def test_night_only_tag_with_nobody_is_empty_target():
    req = request("나이트 전담은 나이트만")
    nurses = [n.model_copy(update={"tags": []}) for n in NURSES]
    req = req.model_copy(update={"context": req.context.model_copy(update={"nurses": nurses})})
    rule = count({"people": {"tags": ["나이트전담"]}, "shifts": {"not_in": ["N", "O"]}, "per": "person", "max": 0})
    client = FakeClient(*[ok({"constraints": [rule]})] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(req, client)
    assert isinstance(res, TranslateClarify)
    assert "나이트전담" in res.question


def test_exclude_night_only_tag_is_known_even_if_unused():
    nurses = [n.model_copy(update={"tags": []}) for n in NURSES]
    req = request("나이트 고르게", "ward")
    req = req.model_copy(update={"context": req.context.model_copy(update={"nurses": nurses})})
    res = translate(req, FakeClient(ok({"constraints": [NIGHT_FAIR]})))
    assert isinstance(res, TranslateOk)


def test_staffing_more_than_people_clarify():
    # 3년차 이상은 n01, n02, n14 세 명뿐인데 하루 4명
    bad = ok({"constraints": [count({"people": {"min_years": 3}, "shifts": {"in": ["D"]}, "per": "day", "min": 4})]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("3년차 이상 데이 4명", "ward"), client)
    assert isinstance(res, TranslateClarify)
    assert "4" in res.question and "3" in res.question


def test_out_of_range_day_retry_then_clarify():
    bad = ok({"constraints": [leave("n02", [32])]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("박민수 32일 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert "32" in res.question
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES
    assert "32" in last_user_text(client.calls[1])


def test_day_outside_cross_month_period_clarify():
    bad = ok({"constraints": [leave("n03", [15])]})
    client = FakeClient(*[bad] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(request("김민수 15일 휴가", period=CROSS, holidays=[]), client)
    assert isinstance(res, TranslateClarify)
    assert "15" in res.question and "기간" in res.question
    assert "1..14" in last_user_text(client.calls[1])


def test_out_of_range_day_then_fixed():
    client = FakeClient(ok({"constraints": [leave("n02", [31])]}), ok({"constraints": [leave("n02", [30])]}))
    res = translate(request("박민수 말일 휴가"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].params.days.days == [30]


# --- clarify / unsupported ---


def test_clarification_question_restored():
    client = FakeClient(ok({"constraints": [], "clarification_question": "n02와 n03 중 누구인가요?"}))
    res = translate(request("민수 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert res.question == "박민수와 김민수 중 누구인가요?"


def test_unsupported_reason():
    client = FakeClient(ok({"constraints": [], "unsupported_reason": "같이 근무하지 않게 하는 규칙은 지원하지 않습니다"}))
    res = translate(request("n01과 n02는 같은 날 근무 안 넣게"), client)
    assert isinstance(res, TranslateUnsupported)
    assert res.reason == "같이 근무하지 않게 하는 규칙은 지원하지 않습니다"


def test_empty_constraints_clarify():
    client = FakeClient(ok({"constraints": []}))
    res = translate(request("잘 부탁해"), client)
    assert isinstance(res, TranslateClarify)
    assert "구체적" in res.question


# --- prompts ---


def test_tool_schema_generated_from_models():
    assert TRANSLATE_TOOL["name"] == "submit_constraints"
    schema = TRANSLATE_TOOL["input_schema"]
    assert set(schema["properties"]) == {"constraints", "config_changes", "clarification_question", "unsupported_reason"}
    text = json.dumps(schema)
    for word in ("count", "sequence", "balance", "not_in", "person_window", "then_off", "priority", "parts"):
        assert word in text
    for old in ("daily_coverage", "leave", "fixed_assignment", "shift_preference", "weekend_fairness"):
        assert f'"{old}"' not in text
    draft_props = [d["properties"] for d in schema["$defs"].values() if "source_text" in d.get("properties", {})]
    assert len(draft_props) == 3
    for props in draft_props:
        assert "id" not in props and "enabled" not in props and "weight" not in props and "scope" not in props
        assert "hardness" in props and "priority" in props


def test_system_prompt_covers_rules():
    for word in ("무조건", "가능하면", "clarification_question", "unsupported_reason", "다음 주", "3주차"):
        assert word in TRANSLATE_SYSTEM
    for word in ("config.shifts", "parts", "not_in", "config_changes", "known_tags", "priority", "제일 중요", "웬만하면"):
        assert word in TRANSLATE_SYSTEM
    for word in ("52시간", "7일", "after", "then_off", "person_week", "person_window", "같이", "세 근무"):
        assert word in TRANSLATE_SYSTEM


def test_system_prompt_uses_period_dates():
    for word in ("기간 전체", "days", "date", "기간 밖", '"period"'):
        assert word in TRANSLATE_SYSTEM
    for old in ("한 달", "대상 월", "템플릿 12개"):
        assert old not in TRANSLATE_SYSTEM


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
