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
    Rule,
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
from backend.llm.prompts import TRANSLATE_EXAMPLES, TRANSLATE_SYSTEM, TRANSLATE_TOOL, RuleDraft, TranslatorOutput
from backend.llm.pseudonym import restore
from backend.llm.translator import translate

NURSES = [
    Nurse(id="n01", name="이영희"),
    Nurse(id="n02", name="박민수"),
    Nurse(id="n03", name="김민수"),
    Nurse(id="n14", name="문가람", tags=["주방"]),
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


def last_user_text(call: dict) -> str:
    content = call["messages"][-1]["content"]
    assert call["messages"][-1]["role"] == "user"
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


# --- 규칙 초안 ---

NOT_OFF = {"not_in": ["O"]}
N, D = {"in": ["N"]}, {"in": ["D"]}


def n(shifts: dict, **extra) -> dict:
    return {**extra, "shifts": shifts}


def cmp(left: dict, op: str, right) -> dict:
    return {"left": left, "op": op, "right": right}


def rule(for_each: dict, then: dict, when: dict | None = None, values: dict | None = None, source_text: str = "원문", **extra) -> dict:
    body: dict = {"kind": "require", "for_each": for_each, "then": then}
    if when is not None:
        body["when"] = when
    return {"body": body, "values": values or {}, "source_text": source_text, **extra}


def balance(source_text: str = "원문", **body) -> dict:
    return {"body": {"kind": "balance", **body}, "source_text": source_text}


def val(value: float, label: str = "값") -> dict:
    return {"value": value, "label": label}


def leave(nurse_id: str, days: list[int], source_text: str = "원문") -> dict:
    return rule(
        {"per": "person", "people": {"ids": [nurse_id]}, "days": {"days": days}},
        cmp(n(NOT_OFF), "le", {"value": "max"}),
        values={"max": val(0, "최대 횟수")},
        source_text=source_text,
        hardness="hard",
    )


def staffing(shifts: dict, at_least: float, who: dict | None = None, days: dict | None = None) -> dict:
    for_each = {"per": "day", **({"days": days} if days else {})}
    left = n(shifts, **({"who": who} if who else {}))
    return rule(for_each, cmp(left, "ge", {"value": "min"}), values={"min": val(at_least, "최소 인원")})


NIGHT_FAIR = balance(shifts=N)
MID = {"code": "M", "name": "미드", "hours": 8, "start": "11:00"}
AFTER_NIGHT = rule(
    {"per": "person_day"},
    cmp(n(NOT_OFF, offset=[1, 1]), "eq", 0),
    when={"all": [cmp(n(N, offset=[0, 0]), "ge", 1), cmp(n({"not_in": ["N"]}, offset=[1, 1]), "ge", 1)]},
    source_text="나이트 다음 날은 무조건 쉬게",
    hardness="hard",
)
TAGGED = [
    Nurse(id="n01", name="이영희", tags=["책임"]),
    Nurse(id="n02", name="박민수"),
    Nurse(id="n03", name="김민수", tags=["신규"]),
    Nurse(id="n04", name="정유진", tags=["책임"]),
    Nurse(id="n05", name="최지훈", tags=["신규"]),
    Nurse(id="n14", name="문가람", tags=["주방"]),
]


def tagged_request(text: str, scope: str = "ward") -> TranslateRequest:
    req = request(text, scope)
    return req.model_copy(update={"context": req.context.model_copy(update={"nurses": TAGGED})})


def retry_then_clarify(output: dict, req: TranslateRequest) -> tuple:
    client = FakeClient(*[ok(output)] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(req, client)
    assert isinstance(res, TranslateClarify)
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES
    return res, last_user_text(client.calls[1])


# --- 정상 경로 ---


def test_context_has_period_and_days():
    client = FakeClient(ok({"rules": [NIGHT_FAIR]}))
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
    nurses = [*NURSES[:3], Nurse(id="n04", name="정유진", tags=["책임"])]
    req = request("나이트 공평하게")
    req = req.model_copy(update={"context": req.context.model_copy(update={"nurses": nurses + NURSES[3:]})})
    client = FakeClient(ok({"rules": [NIGHT_FAIR]}))
    translate(req, client)
    context = sent_context(client.calls[0])
    assert [s["code"] for s in context["config"]["shifts"]] == ["D", "E", "N", "O"]
    assert context["config"]["shifts"][0] == {"code": "D", "name": "데이", "hours": 8, "parts": [], "active": True}
    by_id = {n["id"]: n for n in context["nurses"]}
    assert by_id["n04"] == {"id": "n04", "tags": ["책임"]}
    assert by_id["n14"]["tags"] == ["주방"]
    assert context["known_tags"] == ["주방", "책임"]


def test_context_cross_month_period():
    client = FakeClient(ok({"rules": [NIGHT_FAIR]}))
    translate(request("나이트 공평하게", period=CROSS, holidays=[], today=date(2026, 11, 20)), client)
    context = sent_context(client.calls[0])
    assert context["today_weekday"] == "Friday"
    assert context["period"] == {"start": "2026-11-23", "end": "2026-12-06", "length": 14}
    assert [d["day"] for d in context["days"]] == list(range(1, 15))
    assert context["days"][0] == {"day": 1, "date": "2026-11-23", "weekday": "Mon", "weekend": False}
    assert context["days"][8] == {"day": 9, "date": "2026-12-01", "weekday": "Tue", "weekend": False}
    assert context["days"][13]["date"] == "2026-12-06"
    assert context["weekend_and_holiday_days"] == [6, 7, 13, 14]


def test_translate_rules_with_hardness_and_priority():
    max_work = rule(
        {"per": "person_window", "window": 6},
        cmp(n(NOT_OFF), "le", {"value": "max_len"}),
        values={"max_len": val(5, "최대 연속 근무")},
        source_text="웬만하면 5일 넘게 연속 근무 안 하게",
        hardness="soft",
        priority="high",
    )
    client = FakeClient(ok({"rules": [AFTER_NIGHT, max_work]}))
    res = translate(request("나이트 다음 날은 무조건 쉬게, 웬만하면 5일 넘게 연속 근무 안 하게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert res.input_version == 7
    assert res.config_changes == []
    a, b = res.constraints
    assert isinstance(a, Rule) and isinstance(b, Rule)
    assert (a.type, a.hardness, a.scope, a.enabled, a.default) == ("rule", "hard", "ward", True, False)
    assert a.body.when.all[0].left.offset == (0, 0)
    assert (b.hardness, b.priority, b.weight) == ("soft", "high", constants.PRIORITY_WEIGHTS["high"])
    assert b.values["max_len"].value == 5 and b.values["max_len"].label == "최대 연속 근무"
    assert len(a.id) == 8 and a.id != b.id
    assert len(client.calls) == 1


def test_default_hardness_and_priority():
    forbid = rule({"per": "person_day"}, {"any": [cmp(n(N, offset=[0, 0]), "eq", 0), cmp(n(D, offset=[1, 1]), "eq", 0)]})
    client = FakeClient(ok({"rules": [NIGHT_FAIR, forbid]}))
    res = translate(request("나이트 고르게, 나이트 다음 데이 금지", "ward"), client)
    nf, fs = res.constraints
    assert (nf.body.kind, nf.hardness, nf.priority, nf.weight) == ("balance", "soft", "low", constants.PRIORITY_WEIGHTS["low"])
    assert (fs.body.kind, fs.hardness, fs.priority) == ("require", "hard", "normal")


def test_leave_rule_and_pseudonym_restored():
    client = FakeClient(ok({"rules": [leave("n01", [15, 16, 17], "n01 15~17일 휴가")]}))
    res = translate(request("이영희 15~17일 휴가"), client)
    (r,) = res.constraints
    assert r.type == "rule" and r.hardness == "hard" and r.scope == "period"
    assert r.body.for_each.people.ids == ["n01"] and r.values["max"].value == 0
    assert r.source_text == "이영희 15~17일 휴가"  # 가명 복원


@pytest.mark.parametrize("text,output", TRANSLATE_EXAMPLES, ids=[t for t, _ in TRANSLATE_EXAMPLES])
def test_prompt_examples_become_cards(text, output):
    # 프롬프트의 모양별 예시가 그대로 검증을 통과해 카드(식 규칙)가 된다
    rules = [{**r, "source_text": text} for r in output["rules"]]
    client = FakeClient(ok({**output, "rules": rules}))
    res = translate(tagged_request(text), client)
    assert isinstance(res, TranslateOk), res
    assert len(res.constraints) == len(rules)
    assert all(isinstance(r, Rule) and r.source_text == restore(text, TAGGED) for r in res.constraints)
    assert len(res.config_changes) == len(output.get("config_changes", []))


def test_conditional_and_pair_rules_are_ok():
    conditional = rule(
        {"per": "day"},
        cmp(n(N, who={"tags": ["책임"]}), "ge", {"value": "min"}),
        when=cmp(n(N, who={"tags": ["신규"]}), "ge", 1),
        values={"min": val(1, "최소 책임 인원")},
    )
    apart = rule({"per": "day"}, cmp(n(N, who={"ids": ["n01", "n02"]}), "le", 1))
    together = rule({"per": "day"}, cmp(n(D, who={"ids": ["n01"]}), "eq", n(D, who={"ids": ["n02"]})))
    client = FakeClient(ok({"rules": [conditional, apart, together]}))
    res = translate(tagged_request("신규가 나이트면 책임도, n01·n02 나이트 따로, 데이는 같이"), client)
    assert isinstance(res, TranslateOk)
    c, a, t = res.constraints
    assert c.body.when.left.who.tags == ["신규"]
    assert a.body.then.left.who.ids == ["n01", "n02"]
    assert t.body.then.right.who.ids == ["n02"]


def test_config_change_with_dependent_rule():
    client = FakeClient(
        ok(
            {
                "config_changes": [{"action": "add", "shift": MID}],
                "rules": [staffing({"in": ["M"]}, 1, days={"kind": "weekday"})],
            }
        )
    )
    res = translate(request("미드 근무 M 11시~19시 추가하고 평일엔 미드 1명", "ward"), client)
    assert isinstance(res, TranslateOk)
    (change,) = res.config_changes
    assert change.action == "add" and change.shift.code == "M" and change.shift.hours == 8
    assert res.constraints[0].body.then.left.shifts.in_ == ["M"]


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
    res, retry = retry_then_clarify({"config_changes": [change]}, request("근무 바꿔줘", "ward"))
    assert "근무" in res.question
    assert "config_changes" in retry


def test_config_change_over_code_limit_clarify():
    extra = [{"action": "add", "shift": {"code": f"X{i}", "name": f"근무{i}", "hours": 8}} for i in range(constants.MAX_SHIFT_CODES - 3)]
    _, retry = retry_then_clarify({"config_changes": extra}, request("근무 많이 추가", "ward"))
    assert str(constants.MAX_SHIFT_CODES) in retry


def test_pseudonymized_request_and_context():
    client = FakeClient(ok({"rules": [leave("n01", [15], "n01 15일 휴가")]}))
    translate(request("이영희 15일 휴가"), client)
    call = client.calls[0]
    sent = json.dumps(call["messages"], ensure_ascii=False) + call["system"]
    for nurse in NURSES:
        assert nurse.name not in sent
    assert "n01 15일 휴가" in sent
    assert "2026-10-26" in sent  # 오늘
    assert call["tool"] is TRANSLATE_TOOL


# --- 재시도 ---


def test_schema_violation_then_success():
    bad = rule({"per": "person_window", "window": 4}, cmp(n(N), "le", "많이"))
    good = rule({"per": "person_window", "window": 4}, cmp(n(N), "le", 3))
    client = FakeClient(ok({"rules": [bad]}), ok({"rules": [good]}))
    res = translate(request("나이트 3연속까지", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    retry_msg = last_user_text(client.calls[1])
    assert "rules.0.body" in retry_msg  # 오류 위치 포함
    assert client.calls[1]["messages"][0] == client.calls[0]["messages"][0]


@pytest.mark.parametrize(
    "output",
    [
        {"constraints": [{"type": "count", "params": {"shifts": D, "per": "day", "min": 1}, "source_text": "x"}]},  # 블록은 더 이상 받지 않는다
        {"rules": [{"type": "fixed_assignment", "params": {"nurse_id": "n01", "day": 3, "shift": "D"}, "source_text": "x"}]},
        {"rules": [{"body": {"kind": "code", "python": "model.Add(x == 1)"}, "source_text": "x"}]},  # 실행 코드
        # 재귀 식: 조건 안의 조건은 스키마에 없다
        {"rules": [rule({"per": "day"}, {"all": [{"any": [cmp(n(D), "ge", 1), cmp(n(N), "ge", 1)]}, cmp(n(D), "ge", 1)]})]},
    ],
)
def test_non_rule_output_retries_then_raises(output):
    client = FakeClient(*[ok(output)] * (1 + constants.LLM_MAX_RETRIES))
    with pytest.raises(LLMInvalidOutputError):
        translate(request("이상한 규칙"), client)
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES


def test_no_tool_use_retries():
    min_off = rule({"per": "person"}, cmp(n({"in": ["O"]}), "ge", 8))
    client = FakeClient(ok(None, "end_turn"), ok({"rules": [min_off]}))
    res = translate(request("한 달에 8일은 쉬게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2


def test_max_tokens_retries():
    min_off = rule({"per": "person"}, cmp(n({"in": ["O"]}), "ge", 8))
    client = FakeClient(ok({"rules": [min_off]}, "max_tokens"), ok({"rules": [min_off]}))
    res = translate(request("한 달에 8일은 쉬게", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    assert "잘" in last_user_text(client.calls[1])  # 응답이 잘렸다는 안내


def test_unknown_nurse_clarify():
    res, _ = retry_then_clarify({"rules": [leave("n99", [3])]}, request("홍길동 3일 휴가"))
    assert "명단" in res.question
    assert res.input_version == 7


def test_unknown_nurse_in_count_who_clarify():
    apart = rule({"per": "day"}, cmp(n(N, who={"ids": ["n01", "n99"]}), "le", 1))
    res, retry = retry_then_clarify({"rules": [apart]}, request("둘은 나이트 따로", "ward"))
    assert "명단" in res.question and "n99" in retry


def test_unknown_code_retry_then_clarify():
    res, retry = retry_then_clarify({"rules": [staffing({"in": ["M"]}, 1)]}, request("미드 1명씩", "ward"))
    assert "M" in res.question
    assert "M" in retry


def test_unknown_code_then_fixed_with_config_change():
    r = staffing({"in": ["M"]}, 1)
    client = FakeClient(
        ok({"rules": [r]}),
        ok({"rules": [r], "config_changes": [{"action": "add", "shift": MID}]}),
    )
    res = translate(request("미드 근무 만들고 매일 1명", "ward"), client)
    assert isinstance(res, TranslateOk)
    assert [c.shift.code for c in res.config_changes] == ["M"]


def test_unknown_tag_clarify():
    res, retry = retry_then_clarify({"rules": [staffing(D, 1, who={"tags": ["책임"]})]}, request("책임 간호사 1명은 데이에", "ward"))
    assert "책임" in res.question
    assert "책임" in retry


def test_unknown_tag_in_when_clarify():
    conditional = rule({"per": "day"}, cmp(n(N), "ge", 2), when=cmp(n(N, who={"tags": ["신규"]}), "ge", 1))
    res, _ = retry_then_clarify({"rules": [conditional]}, request("신규 나이트면 2명", "ward"))
    assert "신규" in res.question


def test_missing_value_ref_retry_then_clarify():
    bad = rule({"per": "day"}, cmp(n(D), "ge", {"value": "min"}), values={"max": val(3)})
    res, retry = retry_then_clarify({"rules": [bad]}, request("데이 3명", "ward"))
    assert "min" in retry and "values" in retry
    assert res.question


def test_offset_outside_day_scope_retry_then_clarify():
    bad = rule({"per": "person"}, cmp(n(N, offset=[1, 1]), "eq", 0))
    res, retry = retry_then_clarify({"rules": [bad]}, request("나이트 다음 날", "ward"))
    assert "offset" in retry and "person" in retry
    assert res.question


def test_missing_value_ref_then_fixed():
    bad = rule({"per": "day"}, cmp(n(D), "ge", {"value": "min"}))
    good = staffing(D, 3)
    client = FakeClient(ok({"rules": [bad]}), ok({"rules": [good]}))
    res = translate(request("데이 3명", "ward"), client)
    assert isinstance(res, TranslateOk) and res.constraints[0].values["min"].value == 3


def test_empty_people_clarify():
    # 이영희는 주방 태그가 아님 → 세기 who 0명
    res, _ = retry_then_clarify({"rules": [staffing(D, 1, who={"ids": ["n01"], "tags": ["주방"]})]}, request("주방 이영희 1명은 데이에", "ward"))
    assert "간호사가 없어요" in res.question


def test_empty_scope_people_clarify():
    min_off = rule({"per": "person", "people": {"ids": ["n01"], "tags": ["주방"]}}, cmp(n({"in": ["O"]}), "ge", 8))
    res, retry = retry_then_clarify({"rules": [min_off]}, request("주방 이영희 8일 휴무", "ward"))
    assert "간호사가 없어요" in res.question
    assert "for_each.people" in retry


def test_empty_days_clarify():
    # 11/2(월)·11/3(화) 중 토요일 → 0일
    bad = staffing(D, 1, days={"days": [2, 3], "weekdays": [5]})
    res, _ = retry_then_clarify({"rules": [bad]}, request("2~3일 토요일 데이 1명", "period"))
    assert "날이 없어요" in res.question


def test_staffing_more_than_people_clarify():
    # 주방을 빼면 n01, n02, n03 세 명뿐인데 하루 4명
    res, _ = retry_then_clarify({"rules": [staffing(D, 4, who={"exclude_tags": ["주방"]})]}, request("주방 빼고 데이 4명", "ward"))
    assert "4" in res.question and "3" in res.question


def test_staffing_contradiction_inside_all():
    both = rule(
        {"per": "day"},
        {"all": [cmp(n(D), "ge", {"value": "min"}), cmp(n(D), "le", {"value": "max"})]},
        values={"min": val(5), "max": val(6)},
    )
    res, _ = retry_then_clarify({"rules": [both]}, request("데이 5~6명", "ward"))
    assert "5" in res.question and "4" in res.question  # 명단 4명


def test_staffing_contradiction_ignores_any_and_when():
    # 또는의 한쪽, 조건(when)은 모순 검사에서 보지 않는다
    either = rule({"per": "day"}, {"any": [cmp(n(D), "ge", 9), cmp(n(N), "ge", 1)]})
    conditional = rule({"per": "day"}, cmp(n(N), "ge", 1), when=cmp(n(D), "ge", 9))
    res = translate(request("이상하지만 가능", "ward"), FakeClient(ok({"rules": [either, conditional]})))
    assert isinstance(res, TranslateOk)


def test_out_of_range_day_retry_then_clarify():
    res, retry = retry_then_clarify({"rules": [leave("n02", [32])]}, request("박민수 32일 휴가"))
    assert "32" in res.question
    assert "32" in retry


def test_day_outside_cross_month_period_clarify():
    res, retry = retry_then_clarify({"rules": [leave("n03", [15])]}, request("김민수 15일 휴가", period=CROSS, holidays=[]))
    assert "15" in res.question and "기간" in res.question
    assert "1..14" in retry


def test_out_of_range_day_then_fixed():
    client = FakeClient(ok({"rules": [leave("n02", [31])]}), ok({"rules": [leave("n02", [30])]}))
    res = translate(request("박민수 말일 휴가"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].body.for_each.days.days == [30]


# --- clarify / unsupported ---


def test_clarification_question_restored():
    client = FakeClient(ok({"rules": [], "clarification_question": "n02와 n03 중 누구인가요?"}))
    res = translate(request("민수 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert res.question == "박민수와 김민수 중 누구인가요?"


def test_unsupported_reason():
    client = FakeClient(ok({"rules": [], "unsupported_reason": "교육 시간처럼 근무보다 잘게 쪼갠 시간은 지원하지 않습니다"}))
    res = translate(request("n01 3일 오후 2시간 교육"), client)
    assert isinstance(res, TranslateUnsupported)
    assert res.reason == "교육 시간처럼 근무보다 잘게 쪼갠 시간은 지원하지 않습니다"


def test_empty_rules_clarify():
    client = FakeClient(ok({"rules": []}))
    res = translate(request("잘 부탁해"), client)
    assert isinstance(res, TranslateClarify)
    assert "구체적" in res.question


# --- prompts ---


def _cycle(defs: dict) -> bool:
    """$defs의 $ref 그래프에 순환이 있는가."""
    edges = {name: set() for name in defs}

    def walk(node, src):
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                edges[src].add(ref.rsplit("/", 1)[-1])
            for v in node.values():
                walk(v, src)
        elif isinstance(node, list):
            for v in node:
                walk(v, src)

    for name, d in defs.items():
        walk(d, name)
    state: dict[str, int] = {}

    def visit(x) -> bool:
        if state.get(x) == 1:
            return True
        if state.get(x) == 2:
            return False
        state[x] = 1
        found = any(visit(y) for y in edges.get(x, ()))
        state[x] = 2
        return found

    return any(visit(x) for x in defs)


def test_tool_schema_generated_from_models():
    assert TRANSLATE_TOOL["name"] == "submit_constraints"
    schema = TRANSLATE_TOOL["input_schema"]
    assert set(schema["properties"]) == {"rules", "config_changes", "clarification_question", "unsupported_reason"}
    text = json.dumps(schema)
    for word in ("for_each", "require", "balance", "when", "then", "offset", "not_in", "person_window", "priority", "parts", "label"):
        assert word in text
    for old in ("daily_coverage", "fixed_assignment", "sequence", "then_off", "max_len"):
        assert f'"{old}"' not in text
    draft = schema["$defs"]["RuleDraft"]["properties"]
    assert set(draft) == {"hardness", "priority", "values", "body", "source_text"}
    assert "discriminator" not in text and '"title"' not in text


def test_tool_schema_is_not_recursive():
    defs = TRANSLATE_TOOL["input_schema"]["$defs"]
    assert not _cycle(defs)
    assert _cycle({"A": {"$ref": "#/$defs/B"}, "B": {"items": {"$ref": "#/$defs/A"}}})  # 검사기 자체 확인
    # 조건은 비교 하나 또는 비교 목록이다(조건 안에 조건 없음)
    for name in ("All", "Any"):
        (key,) = defs[name]["properties"]
        assert defs[name]["properties"][key]["items"] == {"$ref": "#/$defs/Cmp"}


def test_prompt_examples_are_valid_rules():
    assert len(TRANSLATE_EXAMPLES) >= 20
    for text, output in TRANSLATE_EXAMPLES:
        out = TranslatorOutput.model_validate({**output, "rules": [{**r, "source_text": text} for r in output["rules"]]})
        for draft in out.rules:
            data = draft.model_dump(mode="json", exclude_none=True)
            Rule.model_validate({**data, "id": "x", "type": "rule", "scope": "ward"})
        assert text in TRANSLATE_SYSTEM


def test_prompt_examples_cover_shapes():
    texts = " ".join(t for t, _ in TRANSLATE_EXAMPLES)
    for shape in ("3~4명", "이상", "휴가", "희망", "빼 주세요", "다음 날 데이 금지", "연속 근무", "연속으로", "2~3일씩",
                  "나이트 끝나면", "52시간", "7일 중", "고르게", "주말·공휴일", "면 책임도", "같은 날 나이트 금지",
                  "같이", "보다 적으면", "일요일 나이트 다음 월요일", "더블", "미드"):
        assert shape in texts, shape


def test_system_prompt_covers_rules():
    for word in ("모델러", "실행 코드", "무조건", "가능하면", "clarification_question", "unsupported_reason", "다음 주", "3주차"):
        assert word in TRANSLATE_SYSTEM
    for word in ("config.shifts", "parts", "not_in", "config_changes", "known_tags", "priority", "제일 중요", "웬만하면"):
        assert word in TRANSLATE_SYSTEM
    for word in ("for_each", "Count", "offset", "when", "values", "label", '{"value": 이름}', "병동 소개"):
        assert word in TRANSLATE_SYSTEM
    order = [TRANSLATE_SYSTEM.index(w) for w in ("무엇마다", "무엇을 세나", "어떻게 비교하나", "조건이 있나")]
    assert order == sorted(order)


def test_system_prompt_unsupported_scope():
    section = TRANSLATE_SYSTEM.split("## 되묻기와 거절")[1]
    for word in ("시각 겹침", "세 근무", "교육"):
        assert word in section
    assert "조건부" in section and "짝" in section and "지원한다" in section


def test_system_prompt_uses_period_dates():
    for word in ("기간 전체", "days", "date", "기간 밖", '"period"'):
        assert word in TRANSLATE_SYSTEM
    for old in ("한 달", "대상 월", "템플릿 12개", "블록"):
        assert old not in TRANSLATE_SYSTEM


def test_rule_draft_has_no_server_fields():
    for field in ("id", "scope", "enabled", "default", "weight", "type"):
        assert field not in RuleDraft.model_fields


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


def test_call_sends_effort(sdk_client, monkeypatch):
    seen = {}

    def create(**kwargs):
        seen.update(kwargs)
        raise status_error(anthropic.RateLimitError, 429)

    monkeypatch.setattr(sdk_client._client.messages, "create", create)
    with pytest.raises(LLMUnavailableError):
        call(sdk_client)
    assert seen["output_config"] == {"effort": "medium"}


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
