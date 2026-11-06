"""translator(mock 클라이언트), tool 정의, AnthropicClient 예외 매핑. 네트워크를 쓰지 않는다."""

import copy
import json
from datetime import date

import anthropic
import httpx2
import pytest

from backend.domain import constants
from backend.domain.models import (
    DEFAULT_CONFIG,
    Employee,
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
from backend.llm.prompts import TIME_WINDOW_EXAMPLES, TRANSLATE_EXAMPLES, TRANSLATE_SYSTEM, TRANSLATE_TOOL, RuleDraft, TranslatorOutput
from backend.llm.pseudonym import restore
from backend.llm.translator import resolve_dates, translate

EMPLOYEES = [
    Employee(id="e01", name="이영희"),
    Employee(id="e02", name="박민수"),
    Employee(id="e03", name="김민수"),
    Employee(id="e14", name="문가람", tags=["주방"]),
]


NOV = Period(start_date=date(2026, 11, 1), length=30)
CROSS = Period(start_date=date(2026, 11, 23), length=14)  # 11/23(월) ~ 12/6(일)


def request(text: str, scope: str = "period", period: Period = NOV, holidays: list[int] | None = None, today: date = date(2026, 10, 26)) -> TranslateRequest:
    return TranslateRequest(
        text=text,
        scope=scope,
        context=TranslateContext(config=DEFAULT_CONFIG, employees=EMPLOYEES, period=period, holidays=[5] if holidays is None else holidays, today=today),
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
C, A = {"in": ["C"]}, {"in": ["A"]}


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


def leave(employee_id: str, dates: list[str], source_text: str = "원문") -> dict:
    # LLM은 날짜를 달력 날짜(dates)로 쓰고, translator가 기간 안 인덱스(days)로 바꾼다
    return rule(
        {"per": "person", "people": {"ids": [employee_id]}, "days": {"dates": dates}},
        cmp(n(NOT_OFF), "le", {"value": "max"}),
        values={"max": val(0, "최대 횟수")},
        source_text=source_text,
        hardness="hard",
    )


def staffing(shifts: dict, at_least: float, who: dict | None = None, days: dict | None = None) -> dict:
    for_each = {"per": "day", **({"days": days} if days else {})}
    left = n(shifts, **({"who": who} if who else {}))
    return rule(for_each, cmp(left, "ge", {"value": "min"}), values={"min": val(at_least, "최소 인원")})


CLOSE_FAIR = balance(shifts=C)
PEAK = {"code": "P", "name": "피크", "hours": 3, "start": "11:00", "end": "14:00"}
AFTER_CLOSE = rule(
    {"per": "person_day"},
    cmp(n(NOT_OFF, offset=[1, 1]), "eq", 0),
    when={"all": [cmp(n(C, offset=[0, 0]), "ge", 1), cmp(n({"not_in": ["C"]}, offset=[1, 1]), "ge", 1)]},
    source_text="마감 다음 날은 무조건 쉬게",
    hardness="hard",
)
TAGGED = [
    Employee(id="e01", name="이영희", tags=["리더"]),
    Employee(id="e02", name="박민수"),
    Employee(id="e03", name="김민수", tags=["신입"]),
    Employee(id="e04", name="정유진", tags=["리더"]),
    Employee(id="e05", name="최지훈", tags=["신입"]),
    Employee(id="e14", name="문가람", tags=["주방"]),
]


def tagged_request(text: str, scope: str = "shop") -> TranslateRequest:
    req = request(text, scope)
    return req.model_copy(update={"context": req.context.model_copy(update={"employees": TAGGED})})


def retry_then_clarify(output: dict, req: TranslateRequest) -> tuple:
    client = FakeClient(*[ok(output)] * (1 + constants.LLM_MAX_RETRIES))
    res = translate(req, client)
    assert isinstance(res, TranslateClarify)
    assert len(client.calls) == 1 + constants.LLM_MAX_RETRIES
    return res, last_user_text(client.calls[1])


# --- 정상 경로 ---


def test_context_has_period_and_days():
    client = FakeClient(ok({"rules": [CLOSE_FAIR]}))
    translate(request("마감 공평하게"), client)
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
    employees = [*EMPLOYEES[:3], Employee(id="e04", name="정유진", tags=["리더"])]
    req = request("마감 공평하게")
    req = req.model_copy(update={"context": req.context.model_copy(update={"employees": employees + EMPLOYEES[3:]})})
    client = FakeClient(ok({"rules": [CLOSE_FAIR]}))
    translate(req, client)
    context = sent_context(client.calls[0])
    assert [s["code"] for s in context["config"]["shifts"]] == ["A", "M", "C", "O"]
    assert context["config"]["shifts"][3]["start"] is None
    assert context["config"]["shifts"][0] == {"code": "A", "name": "오픈", "hours": 6, "parts": [], "start": "09:00", "end": "15:00", "active": True}
    by_id = {n["id"]: n for n in context["employees"]}
    assert by_id["e04"] == {"id": "e04", "tags": ["리더"]}
    assert by_id["e14"]["tags"] == ["주방"]
    assert context["known_tags"] == ["리더", "주방"]


def test_context_cross_month_period():
    client = FakeClient(ok({"rules": [CLOSE_FAIR]}))
    translate(request("마감 공평하게", period=CROSS, holidays=[], today=date(2026, 11, 20)), client)
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
    client = FakeClient(ok({"rules": [AFTER_CLOSE, max_work]}))
    res = translate(request("마감 다음 날은 무조건 쉬게, 웬만하면 5일 넘게 연속 근무 안 하게", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert res.input_version == 7
    assert res.config_changes == []
    a, b = res.constraints
    assert isinstance(a, Rule) and isinstance(b, Rule)
    assert (a.type, a.hardness, a.scope, a.enabled, a.default) == ("rule", "hard", "shop", True, False)
    assert a.body.when.all[0].left.offset == (0, 0)
    assert (b.hardness, b.priority, b.weight) == ("soft", "high", constants.PRIORITY_WEIGHTS["high"])
    assert b.values["max_len"].value == 5 and b.values["max_len"].label == "최대 연속 근무"
    assert len(a.id) == 8 and a.id != b.id
    assert len(client.calls) == 1


def test_default_hardness_and_priority():
    forbid = rule({"per": "person_day"}, {"any": [cmp(n(C, offset=[0, 0]), "eq", 0), cmp(n(A, offset=[1, 1]), "eq", 0)]})
    client = FakeClient(ok({"rules": [CLOSE_FAIR, forbid]}))
    res = translate(request("마감 고르게, 마감 다음 오픈 금지", "shop"), client)
    nf, fs = res.constraints
    assert (nf.body.kind, nf.hardness, nf.priority, nf.weight) == ("balance", "soft", "low", constants.PRIORITY_WEIGHTS["low"])
    assert (fs.body.kind, fs.hardness, fs.priority) == ("require", "hard", "normal")


def test_leave_rule_and_pseudonym_restored():
    client = FakeClient(ok({"rules": [leave("e01", ["2026-11-15", "2026-11-16", "2026-11-17"], "e01 15~17일 휴가")]}))
    res = translate(request("이영희 15~17일 휴가"), client)
    (r,) = res.constraints
    assert r.type == "rule" and r.hardness == "hard" and r.scope == "period"
    assert r.body.for_each.people.ids == ["e01"] and r.values["max"].value == 0
    assert r.body.for_each.days.days == [15, 16, 17]
    assert r.source_text == "이영희 15~17일 휴가"  # 가명 복원


ALL_EXAMPLES = TRANSLATE_EXAMPLES + TIME_WINDOW_EXAMPLES


@pytest.mark.parametrize("text,output", ALL_EXAMPLES, ids=[t for t, _ in ALL_EXAMPLES])
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
        cmp(n(C, who={"tags": ["리더"]}), "ge", {"value": "min"}),
        when=cmp(n(C, who={"tags": ["신입"]}), "ge", 1),
        values={"min": val(1, "최소 리더 인원")},
    )
    apart = rule({"per": "day"}, cmp(n(C, who={"ids": ["e01", "e02"]}), "le", 1))
    together = rule({"per": "day"}, cmp(n(A, who={"ids": ["e01"]}), "eq", n(A, who={"ids": ["e02"]})))
    client = FakeClient(ok({"rules": [conditional, apart, together]}))
    res = translate(tagged_request("신입가 마감면 리더도, e01·e02 마감 따로, 오픈은 같이"), client)
    assert isinstance(res, TranslateOk)
    c, a, t = res.constraints
    assert c.body.when.left.who.tags == ["신입"]
    assert a.body.then.left.who.ids == ["e01", "e02"]
    assert t.body.then.right.who.ids == ["e02"]


def test_config_change_with_dependent_rule():
    client = FakeClient(
        ok(
            {
                "config_changes": [{"action": "add", "shift": PEAK}],
                "rules": [staffing({"in": ["P"]}, 1, days={"kind": "weekday"})],
            }
        )
    )
    res = translate(request("피크 근무 P 11시~14시 추가하고 평일엔 피크 1명", "shop"), client)
    assert isinstance(res, TranslateOk)
    (change,) = res.config_changes
    assert change.action == "add" and change.shift.code == "P" and (change.shift.hours, change.shift.start, change.shift.end) == (3, "11:00", "14:00")
    assert res.constraints[0].body.then.left.shifts.in_ == ["P"]


def test_config_change_only_is_ok():
    double = {"code": "AC", "name": "더블", "hours": 12, "parts": ["A", "C"]}
    client = FakeClient(ok({"config_changes": [{"action": "add", "shift": double}]}))
    res = translate(request("A+C 더블 허용", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints == [] and res.config_changes[0].shift.parts == ["A", "C"]


def test_config_change_update_existing():
    client = FakeClient(ok({"config_changes": [{"action": "update", "shift": {"code": "C", "name": "마감", "hours": 10, "start": "13:00", "end": "23:00"}}]}))
    res = translate(request("마감은 13시부터 23시까지 10시간", "shop"), client)
    shift = res.config_changes[0].shift
    assert (shift.hours, shift.start, shift.end) == (10, "13:00", "23:00")


@pytest.mark.parametrize(
    "change",
    [
        {"action": "add", "shift": {"code": "A", "name": "오픈", "hours": 8, "start": "07:00", "end": "15:00"}},  # 이미 있음
        {"action": "update", "shift": {**PEAK}},  # 없는 코드
        {"action": "update", "shift": {"code": "O", "name": "쉼", "hours": 0}},  # 휴무는 바꿀 수 없음
        {"action": "add", "shift": {"code": "AX", "name": "더블", "hours": 16, "parts": ["A", "X"]}},  # 없는 parts
    ],
)
def test_invalid_config_change_retry_then_clarify(change):
    res, retry = retry_then_clarify({"config_changes": [change]}, request("근무 바꿔줘", "shop"))
    assert "근무" in res.question
    assert "config_changes" in retry


def test_config_change_without_times_is_schema_error_and_retried():
    no_times = {"code": "P", "name": "피크", "hours": 3}
    client = FakeClient(ok({"config_changes": [{"action": "add", "shift": no_times}]}), ok({"config_changes": [{"action": "add", "shift": PEAK}]}))
    res = translate(request("피크 근무 3시간 추가", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert "시각" in last_user_text(client.calls[1])
    assert res.config_changes[0].shift.end == "14:00"


def test_config_change_over_code_limit_clarify():
    extra = [{"action": "add", "shift": {"code": f"X{i}", "name": f"근무{i}", "hours": 8, "start": "09:00", "end": "17:00"}} for i in range(constants.MAX_SHIFT_CODES - 3)]
    _, retry = retry_then_clarify({"config_changes": extra}, request("근무 많이 추가", "shop"))
    assert str(constants.MAX_SHIFT_CODES) in retry


def test_pseudonymized_request_and_context():
    client = FakeClient(ok({"rules": [leave("e01", ["2026-11-15"], "e01 15일 휴가")]}))
    translate(request("이영희 15일 휴가"), client)
    call = client.calls[0]
    sent = json.dumps(call["messages"], ensure_ascii=False) + call["system"]
    for employee in EMPLOYEES:
        assert employee.name not in sent
    assert "e01 15일 휴가" in sent
    assert "2026-10-26" in sent  # 오늘
    assert call["tool"] is TRANSLATE_TOOL


# --- 재시도 ---


def test_schema_violation_then_success():
    bad = rule({"per": "person_window", "window": 4}, cmp(n(C), "le", "많이"))
    good = rule({"per": "person_window", "window": 4}, cmp(n(C), "le", 3))
    client = FakeClient(ok({"rules": [bad]}), ok({"rules": [good]}))
    res = translate(request("마감 3연속까지", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    retry_msg = last_user_text(client.calls[1])
    assert "rules.0.body" in retry_msg  # 오류 위치 포함
    assert client.calls[1]["messages"][0] == client.calls[0]["messages"][0]


@pytest.mark.parametrize(
    "output",
    [
        {"constraints": [{"type": "count", "params": {"shifts": A, "per": "day", "min": 1}, "source_text": "x"}]},  # 블록은 더 이상 받지 않는다
        {"rules": [{"type": "fixed_assignment", "params": {"employee_id": "e01", "day": 3, "shift": "A"}, "source_text": "x"}]},
        {"rules": [{"body": {"kind": "code", "python": "model.Add(x == 1)"}, "source_text": "x"}]},  # 실행 코드
        # 재귀 식: 조건 안의 조건은 스키마에 없다
        {"rules": [rule({"per": "day"}, {"all": [{"any": [cmp(n(A), "ge", 1), cmp(n(C), "ge", 1)]}, cmp(n(A), "ge", 1)]})]},
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
    res = translate(request("한 달에 8일은 쉬게", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2


def test_max_tokens_retries():
    min_off = rule({"per": "person"}, cmp(n({"in": ["O"]}), "ge", 8))
    client = FakeClient(ok({"rules": [min_off]}, "max_tokens"), ok({"rules": [min_off]}))
    res = translate(request("한 달에 8일은 쉬게", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert len(client.calls) == 2
    assert "잘" in last_user_text(client.calls[1])  # 응답이 잘렸다는 안내


def test_unknown_employee_clarify():
    res, _ = retry_then_clarify({"rules": [leave("e99", ["2026-11-03"])]}, request("홍길동 3일 휴가"))
    assert "명단" in res.question
    assert res.input_version == 7


def test_unknown_employee_in_count_who_clarify():
    apart = rule({"per": "day"}, cmp(n(C, who={"ids": ["e01", "e99"]}), "le", 1))
    res, retry = retry_then_clarify({"rules": [apart]}, request("둘은 마감 따로", "shop"))
    assert "명단" in res.question and "e99" in retry


def test_unknown_code_retry_then_clarify():
    res, retry = retry_then_clarify({"rules": [staffing({"in": ["P"]}, 1)]}, request("피크 1명씩", "shop"))
    assert "P" in res.question
    assert "P" in retry


def test_unknown_code_then_fixed_with_config_change():
    r = staffing({"in": ["P"]}, 1)
    client = FakeClient(
        ok({"rules": [r]}),
        ok({"rules": [r], "config_changes": [{"action": "add", "shift": PEAK}]}),
    )
    res = translate(request("피크 근무 만들고 매일 1명", "shop"), client)
    assert isinstance(res, TranslateOk)
    assert [c.shift.code for c in res.config_changes] == ["P"]


def test_unknown_tag_clarify():
    res, retry = retry_then_clarify({"rules": [staffing(A, 1, who={"tags": ["리더"]})]}, request("리더 직원 1명은 오픈에", "shop"))
    assert "리더" in res.question
    assert "리더" in retry


def test_unknown_tag_in_when_clarify():
    conditional = rule({"per": "day"}, cmp(n(C), "ge", 2), when=cmp(n(C, who={"tags": ["신입"]}), "ge", 1))
    res, _ = retry_then_clarify({"rules": [conditional]}, request("신입 마감면 2명", "shop"))
    assert "신입" in res.question


def test_missing_value_ref_retry_then_clarify():
    bad = rule({"per": "day"}, cmp(n(A), "ge", {"value": "min"}), values={"max": val(3)})
    res, retry = retry_then_clarify({"rules": [bad]}, request("오픈 3명", "shop"))
    assert "min" in retry and "values" in retry
    assert res.question


def test_offset_outside_day_scope_retry_then_clarify():
    bad = rule({"per": "person"}, cmp(n(C, offset=[1, 1]), "eq", 0))
    res, retry = retry_then_clarify({"rules": [bad]}, request("마감 다음 날", "shop"))
    assert "offset" in retry and "person" in retry
    assert res.question


def test_missing_value_ref_then_fixed():
    bad = rule({"per": "day"}, cmp(n(A), "ge", {"value": "min"}))
    good = staffing(A, 3)
    client = FakeClient(ok({"rules": [bad]}), ok({"rules": [good]}))
    res = translate(request("오픈 3명", "shop"), client)
    assert isinstance(res, TranslateOk) and res.constraints[0].values["min"].value == 3


def test_empty_people_clarify():
    # 이영희는 주방 태그가 아님 → 세기 who 0명
    res, _ = retry_then_clarify({"rules": [staffing(A, 1, who={"ids": ["e01"], "tags": ["주방"]})]}, request("주방 이영희 1명은 오픈에", "shop"))
    assert "주방 직급인 직원이 없어요" in res.question


def test_empty_scope_people_clarify():
    min_off = rule({"per": "person", "people": {"ids": ["e01"], "tags": ["주방"]}}, cmp(n({"in": ["O"]}), "ge", 8))
    res, retry = retry_then_clarify({"rules": [min_off]}, request("주방 이영희 8일 휴무", "shop"))
    assert "직원이 없어요" in res.question
    assert "for_each.people" in retry


def test_empty_days_clarify():
    # 11/2(월)·11/3(화) 중 토요일 → 0일
    bad = staffing(A, 1, days={"dates": ["2026-11-02", "2026-11-03"], "weekdays": [5]})
    res, _ = retry_then_clarify({"rules": [bad]}, request("2~3일 토요일 오픈 1명", "period"))
    assert "날이 없어요" in res.question


def test_staffing_more_than_people_clarify():
    # 주방을 빼면 e01, e02, e03 세 명뿐인데 하루 4명
    res, _ = retry_then_clarify({"rules": [staffing(A, 4, who={"exclude_tags": ["주방"]})]}, request("주방 빼고 오픈 4명", "shop"))
    assert "4" in res.question and "3" in res.question


def test_staffing_contradiction_inside_all():
    both = rule(
        {"per": "day"},
        {"all": [cmp(n(A), "ge", {"value": "min"}), cmp(n(A), "le", {"value": "max"})]},
        values={"min": val(5), "max": val(6)},
    )
    res, _ = retry_then_clarify({"rules": [both]}, request("오픈 5~6명", "shop"))
    assert "5" in res.question and "4" in res.question  # 명단 4명


def test_staffing_contradiction_ignores_any_and_when():
    # 또는의 한쪽, 조건(when)은 모순 검사에서 보지 않는다
    either = rule({"per": "day"}, {"any": [cmp(n(A), "ge", 9), cmp(n(C), "ge", 1)]})
    conditional = rule({"per": "day"}, cmp(n(C), "ge", 1), when=cmp(n(A), "ge", 9))
    res = translate(request("이상하지만 가능", "shop"), FakeClient(ok({"rules": [either, conditional]})))
    assert isinstance(res, TranslateOk)


def test_out_of_range_day_retry_then_clarify():
    res, retry = retry_then_clarify({"rules": [leave("e02", ["2026-12-02"])]}, request("박민수 12월 2일 휴가"))
    assert "12/2" in res.question and "기간" in res.question
    assert "2026-12-02" in retry and "2026-11-01~2026-11-30" in retry


def test_day_outside_cross_month_period_clarify():
    res, retry = retry_then_clarify({"rules": [leave("e03", ["2026-12-15"])]}, request("김민수 15일 휴가", period=CROSS, holidays=[]))
    assert "12/15" in res.question and "기간" in res.question
    assert "2026-11-23~2026-12-06" in retry


def test_out_of_range_day_then_fixed():
    client = FakeClient(ok({"rules": [leave("e02", ["2026-12-01"])]}), ok({"rules": [leave("e02", ["2026-11-30"])]}))
    res = translate(request("박민수 말일 휴가"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].body.for_each.days.days == [30]


def test_dates_become_period_day_indices_across_months():
    # 기간이 11/23부터면 12/1은 9번째 날이다(m01: 달력의 일을 인덱스로 착각하던 오류)
    client = FakeClient(ok({"rules": [leave("e03", ["2026-12-02", "2026-12-01", "2026-12-01"])]}))
    res = translate(request("김민수 12월 1~2일 휴가", period=CROSS, holidays=[]), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].body.for_each.days.days == [9, 10]


def test_dates_in_count_days_converted():
    # 세기(Count)의 days도 같은 셀렉터다
    left = n(A, who={"ids": ["e01"]}, days={"dates": ["2026-11-24"]})
    out = {"rules": [rule({"per": "period"}, cmp(left, "ge", 1))]}
    res = translate(request("이영희 11/24 오픈", period=CROSS, holidays=[]), FakeClient(ok(out)))
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].body.then.left.days.days == [2]


def test_index_days_from_llm_retried():
    # 인덱스를 직접 쓰면 받지 않고 dates로 다시 쓰게 한다
    bad = {"rules": [rule({"per": "person", "people": {"ids": ["e01"]}, "days": {"days": [15]}}, cmp(n(NOT_OFF), "le", 0))]}
    client = FakeClient(ok(bad), ok({"rules": [leave("e01", ["2026-11-15"])]}))
    res = translate(request("이영희 15일 휴가"), client)
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].body.for_each.days.days == [15]
    assert "dates" in last_user_text(client.calls[1])


def test_invalid_date_retried():
    client = FakeClient(ok({"rules": [leave("e01", ["2026-11-31"])]}), ok({"rules": [leave("e01", ["2026-11-30"])]}))
    res = translate(request("이영희 말일 휴가"), client)
    assert isinstance(res, TranslateOk)
    assert "2026-11-31" in last_user_text(client.calls[1])


# --- clarify / unsupported ---


def test_clarification_question_restored():
    client = FakeClient(ok({"rules": [], "clarification_question": "e02와 e03 중 누구인가요?"}))
    res = translate(request("민수 휴가"), client)
    assert isinstance(res, TranslateClarify)
    assert res.question == "박민수와 김민수 중 누구인가요?"


def test_unsupported_reason():
    client = FakeClient(ok({"rules": [], "unsupported_reason": "교육 시간처럼 근무보다 잘게 쪼갠 시간은 지원하지 않습니다"}))
    res = translate(request("e01 3일 오후 2시간 교육"), client)
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
    # 날짜 셀렉터는 LLM에게 인덱스 대신 달력 날짜를 받는다
    days = schema["$defs"]["Days"]["properties"]
    assert set(days) == {"kind", "weekdays", "dates"}
    assert days["dates"]["anyOf"][0]["items"] == {"type": "string", "format": "date"}
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
    for text, output in ALL_EXAMPLES:
        resolved = resolve_dates({**output, "rules": [{**r, "source_text": text} for r in output["rules"]]}, NOV)
        out = TranslatorOutput.model_validate(resolved)
        for draft in out.rules:
            data = draft.model_dump(mode="json", exclude_none=True)
            Rule.model_validate({**data, "id": "x", "type": "rule", "scope": "shop"})
        assert text in TRANSLATE_SYSTEM


def test_prompt_examples_cover_shapes():
    texts = " ".join(t for t, _ in TRANSLATE_EXAMPLES)
    for shape in ("1~2명", "이상", "휴가", "희망", "빼 주세요", "다음 날 오픈 금지", "연속 근무", "연속으로", "2~3일씩",
                  "마감 끝나면", "40시간", "7일 중", "고르게", "주말·공휴일", "면 리더도", "같은 날 마감 금지",
                  "같이", "보다 적으면", "일요일 마감 다음 월요일", "더블", "피크", "오픈 2명, 주말은 3명"):
        assert shape in texts, shape


def test_bare_staffing_number_means_at_least():
    # 숫자만 있는 필요 인원은 이상(ge), "정확히"·"딱"을 말할 때만 같음(eq)
    assert "정확히" in TRANSLATE_SYSTEM and "딱" in TRANSLATE_SYSTEM
    examples = dict(TRANSLATE_EXAMPLES)
    for text in ("평일 오픈 2명, 주말은 3명", "오픈 평일 2명 이상, 주말 3명, 피크 P 11시부터 14시까지 3시간도 있어"):
        for r in examples[text]["rules"]:
            assert r["body"]["then"]["op"] == "ge", text
            assert r["values"]["min"]["label"] == "최소 인원", text
    exact = examples["금요일엔 미들 딱 2명"]["rules"][0]
    assert exact["body"]["then"]["op"] == "eq"


def test_system_prompt_covers_rules():
    for word in ("모델러", "실행 코드", "무조건", "가능하면", "clarification_question", "unsupported_reason", "다음 주", "3주차"):
        assert word in TRANSLATE_SYSTEM
    for word in ("config.shifts", "parts", "not_in", "config_changes", "known_tags", "priority", "제일 중요", "웬만하면"):
        assert word in TRANSLATE_SYSTEM
    for word in ("for_each", "Count", "offset", "when", "values", "label", '{"value": 이름}', "매장 소개"):
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


def _minutes(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def _cover(start: str, end: str) -> set[str]:
    """구간을 완전히 덮는 기본 근무조 코드."""
    return {s.code for s in DEFAULT_CONFIG.shifts if s.start and _minutes(s.start) <= _minutes(start) and _minutes(end) <= _minutes(s.end)}


@pytest.mark.parametrize(
    "text,pieces",
    [
        ("12시부터 15시까지 최소 3명", [("12:00", "15:00")]),
        ("13시~14시 최소 4명", [("13:00", "14:00")]),
        ("14시~18시 최소 2명", [("14:00", "15:00"), ("15:00", "17:00"), ("17:00", "18:00")]),
    ],
)
def test_time_window_examples_count_shifts_covering_the_window(text, pieces):
    output = dict(TIME_WINDOW_EXAMPLES)[text]
    for r in output["rules"]:
        assert r["body"]["for_each"] == {"per": "day"}
    assert [set(r["body"]["then"]["left"]["shifts"]["in"]) for r in output["rules"]] == [_cover(a, b) for a, b in pieces]


def test_time_window_rule_reaches_card():
    r = staffing({"in": ["A", "M"]}, 3)
    res = translate(request("12시부터 15시까지 최소 3명", "shop"), FakeClient(ok({"rules": [r]})))
    assert isinstance(res, TranslateOk)
    assert res.constraints[0].body.then.left.shifts.in_ == ["A", "M"]


def test_system_prompt_time_window_section():
    section = TRANSLATE_SYSTEM.split("## 시간대 필요 인원")[1].split("\n## ")[0]
    for word in ("start", "end", "시각으로 판단", "완전히 덮는", "per day", "clarification_question", "6시~10시 1명", "점심시간"):
        assert word in section, word
    for text, _ in TIME_WINDOW_EXAMPLES:
        assert text in section
    assert len(TIME_WINDOW_EXAMPLES) >= 2


def test_system_prompt_is_about_shops():
    for word in ("스케줄 매니저", "오픈", "미들", "마감", "리더", "신입"):
        assert word in TRANSLATE_SYSTEM, word
    assert "수간호사" not in TRANSLATE_TOOL["description"]
    for old in ("간호", "병동", "나이트", "이브닝", "데이", "책임", "신규", "미드", "연차"):
        assert old not in TRANSLATE_SYSTEM, old


def test_system_prompt_labor_law_and_availability():
    section = TRANSLATE_SYSTEM.split("## 노동법과 가능 시간")[1].split("\n## ")[0]
    for word in ("말한 숫자만", "추정", "가능 시간", "만들지 않는다"):
        assert word in section, word


def test_tool_schema_takes_shift_times():
    props = TRANSLATE_TOOL["input_schema"]["$defs"]["ShiftDef"]["properties"]
    assert {"start", "end", "hours"} <= set(props)


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
