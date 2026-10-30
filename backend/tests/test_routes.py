"""HTTP 계층: 계약, 오케스트레이션(제안 재풀이 검증), 오류 변환, 구조화 로그. LLM은 mock, 솔버는 실제로 돌린다."""

import copy
import json

import pytest
from fastapi.testclient import TestClient

from backend import routes
from backend.domain.constants import (
    AVAILABILITY_RULE_PREFIX,
    EXAMPLES_PER_RULE,
    MAX_AVAILABILITY_RULES,
    MAX_CONSTRAINTS,
    MAX_FIXED_ASSIGNMENTS,
    MAX_EMPLOYEES,
    MAX_OFFSET,
    MAX_OFFSET_SPAN,
    MAX_PROPOSALS,
    MAX_RULE_CMPS,
    MAX_RULE_VALUES,
    MAX_SHIFT_CODES,
    MAX_TAGS_PER_EMPLOYEE,
    MAX_TEXT_CHARS,
    MAX_WINDOW_DAYS,
    MIN_OFFSET,
    PROPOSAL_VERIFY_TIME_LIMIT_S,
)
from backend.llm.client import LLMConfigError, LLMUnavailableError, ToolCallResult
from backend.routes import app, get_llm_client
from backend.solver.model import solve as real_solve
from backend.tests.rules import DEN_CONFIG, DEN_SHIFTS, count, history, sample_data

client = TestClient(app)


def ok(tool_input: dict | None, stop_reason: str = "tool_use") -> ToolCallResult:
    return ToolCallResult(tool_input=tool_input, stop_reason=stop_reason, input_tokens=100, output_tokens=50)


class FakeClient:
    def __init__(self, *responses: ToolCallResult | Exception):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        self.calls.append({"system": system, "messages": copy.deepcopy(messages), "tool": tool})
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def llm():
    """mock 클라이언트를 의존성으로 주입한다. 테스트가 fake.responses를 채운다."""
    fake = FakeClient()
    app.dependency_overrides[get_llm_client] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


def sample() -> dict:
    data = sample_data()
    data["input_version"] = 5
    return data


def fixed(cid: str, nid: str, day: int, shift: str) -> dict:
    return {
        "id": cid,
        "scope": "period",
        "type": "fixed_assignment",
        "params": {"employee_id": nid, "day": day, "shift": shift},
        "source_text": f"{cid} 원문",
    }


def infeasible_request() -> dict:
    """e01을 5일에 D와 N으로 동시에 고정 → 해 없음."""
    data = sample()
    data["constraints"] += [fixed("f1", "e01", 5, "D"), fixed("f2", "e01", 5, "N")]
    return data


def translate_body(text: str = "이영희 15~17일 휴가") -> dict:
    data = sample()
    return {
        "text": text,
        "scope": "period",
        "context": {"config": DEN_CONFIG, "employees": data["employees"], "period": data["period"], "holidays": [5], "today": "2026-10-26"},
        "input_version": 9,
    }


def assert_error(r, status: int, code: str) -> dict:
    assert r.status_code == status, r.text
    body = r.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "request_id"}
    assert body["error"]["code"] == code
    assert len(body["error"]["request_id"]) == 36  # uuid4
    return body["error"]


def log_lines(capsys) -> list[dict]:
    out = capsys.readouterr().out
    return [json.loads(line) for line in out.splitlines() if line.startswith("{")]


# --- health, 시작 ---


def test_health():
    r = client.get("/api/py/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_solve_demo_removed():
    assert client.get("/api/py/solve-demo").status_code == 404


def test_load_local_env_on_startup(monkeypatch):
    called = []
    monkeypatch.setattr(routes, "load_local_env", lambda: called.append(True))
    with TestClient(app):
        pass
    assert called == [True]


# --- solve ---


def test_solve_ok_returns_input_version():
    r = client.post("/api/py/solve", json=sample())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["input_version"] == 5
    assert len(body["result"]["assignments"]) == 15


HISTORY = history("2026-11-01", {"e03": ["N"] * 8})


def test_solve_passes_history(monkeypatch):
    seen = []
    monkeypatch.setattr(routes, "solve", lambda req: seen.append(req.history) or real_solve(req))
    data = sample()
    data["history"] = HISTORY
    assert client.post("/api/py/solve", json=data).status_code == 200
    assert seen[0].rows["e03"].count("N") == 8


OLD_LEAVE = {"id": "lv", "type": "leave", "scope": "period", "source_text": "x", "params": {"employee_id": "e01", "days": [3]}}


@pytest.mark.parametrize(
    "make_old",
    [
        lambda d: d.update(history_load=[{"employee_id": "e03", "nights": 8, "weekends": 2}]),
        lambda d: d["constraints"].append(OLD_LEAVE),
    ],
    ids=["history_load", "template"],
)
def test_solve_rejects_old_format(make_old):
    data = sample()
    make_old(data)
    assert_error(client.post("/api/py/solve", json=data), 422, "VALIDATION_ERROR")


def test_solve_result_stats_use_counts():
    body = client.post("/api/py/solve", json=sample()).json()
    stats = body["result"]["stats"]["e01"]
    assert set(stats["counts"]) == {"D", "E", "N", "O"} and "D" not in stats
    assert stats["hours"] == 8 * (30 - stats["counts"]["O"])


def test_solve_infeasible_with_conflicts():
    r = client.post("/api/py/solve", json=infeasible_request())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "infeasible"
    assert body["input_version"] == 5
    assert {c["constraint_id"] for c in body["conflicts"]} == {"f1", "f2"}


# --- translate ---


LEAVE_DRAFT = {
    "values": {"max": {"value": 0, "label": "최대 횟수"}},
    "body": {
        "kind": "require",
        "for_each": {"per": "person", "people": {"ids": ["e01"]}, "days": {"days": [15, 16, 17]}},
        "then": {"left": {"shifts": {"not_in": ["O"]}}, "op": "le", "right": {"value": "max"}},
    },
    "source_text": "e01 15~17일 휴가",
    "hardness": "hard",
}


def test_translate_ok(llm):
    llm.responses = [ok({"rules": [LEAVE_DRAFT]})]
    r = client.post("/api/py/translate", json=translate_body())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["input_version"] == 9
    assert body["config_changes"] == []
    (rule,) = body["constraints"]
    assert rule["type"] == "rule" and rule["hardness"] == "hard" and rule["scope"] == "period"
    assert rule["default"] is False and rule["values"] == {"max": {"value": 0.0, "label": "최대 횟수"}}
    assert rule["body"]["then"]["left"]["shifts"] == {"in": None, "not_in": ["O"]}
    assert rule["body"]["for_each"]["people"]["ids"] == ["e01"]
    assert rule["source_text"] == "이영희 15~17일 휴가"


def test_translate_conditional_rule(llm):
    conditional = {
        "body": {
            "kind": "require",
            "for_each": {"per": "day"},
            "when": {"left": {"who": {"ids": ["e01"]}, "shifts": {"in": ["N"]}}, "op": "ge", "right": 1},
            "then": {"left": {"who": {"ids": ["e02"]}, "shifts": {"in": ["N"]}}, "op": "le", "right": 1},
        },
        "source_text": "이영희가 나이트면 박민수는 1번까지",
    }
    llm.responses = [ok({"rules": [conditional]})]
    r = client.post("/api/py/translate", json=translate_body("이영희가 나이트면 박민수는 1번까지"))
    (rule,) = r.json()["constraints"]
    assert rule["body"]["when"]["op"] == "ge" and rule["body"]["then"]["right"] == 1


def test_translate_ok_with_config_changes(llm):
    mid = {"code": "M", "name": "미드", "hours": 8, "start": "11:00", "end": "19:00"}
    rule = {
        "values": {"min": {"value": 1, "label": "최소 인원"}},
        "body": {"kind": "require", "for_each": {"per": "day"}, "then": {"left": {"shifts": {"in": ["M"]}}, "op": "ge", "right": {"value": "min"}}},
        "source_text": "미드 매일 1명",
    }
    llm.responses = [ok({"rules": [rule], "config_changes": [{"action": "add", "shift": mid}]})]
    r = client.post("/api/py/translate", json=translate_body("미드 근무 M 11시~19시 추가, 매일 1명"))
    assert r.status_code == 200
    body = r.json()
    assert body["config_changes"] == [
        {"action": "add", "shift": {"code": "M", "name": "미드", "hours": 8.0, "parts": [], "start": "11:00", "end": "19:00", "active": True}}
    ]
    assert body["constraints"][0]["body"]["then"]["left"]["shifts"]["in"] == ["M"]


PAIR_DRAFT = {
    "body": {
        "kind": "require",
        "for_each": {"per": "day"},
        "then": {"left": {"who": {"ids": ["e01", "e02"]}, "shifts": {"in": ["N"]}}, "op": "le", "right": 1},
    },
    "source_text": "e01와 e02는 같은 날 나이트 금지",
}


def test_translate_examples_keyed_by_rule_id(llm):
    llm.responses = [ok({"rules": [LEAVE_DRAFT, PAIR_DRAFT]})]
    body = client.post("/api/py/translate", json=translate_body()).json()
    ids = [c["id"] for c in body["constraints"]]
    assert set(body["examples"]) == set(ids)
    leave, pair = (body["examples"][i] for i in ids)
    assert 1 <= len(leave) <= EXAMPLES_PER_RULE and 1 <= len(pair) <= EXAMPLES_PER_RULE
    ex = leave[0]
    assert set(ex) == {"employee_ids", "days", "cells", "marks", "detail"}
    assert ex["employee_ids"] == ["e01"] and {15, 16, 17} <= set(ex["days"])
    assert all(nid == "e01" and d in (15, 16, 17) for nid, d in ex["marks"])
    names = [n["name"] for n in sample()["employees"]]
    assert not any(name in e["detail"] for e in leave + pair for name in names)


def test_translate_examples_are_deterministic(llm):
    llm.responses = [ok({"rules": [PAIR_DRAFT]}), ok({"rules": [PAIR_DRAFT]})]
    first = client.post("/api/py/translate", json=translate_body()).json()
    second = client.post("/api/py/translate", json=translate_body()).json()
    assert list(first["examples"].values()) == list(second["examples"].values())


def test_translate_examples_use_config_changes(llm):
    mid = {"code": "M", "name": "미드", "hours": 8, "start": "11:00", "end": "19:00"}
    rule = {
        "body": {
            "kind": "require",
            "for_each": {"per": "day"},
            "then": {"left": {"shifts": {"in": ["M"]}}, "op": "le", "right": 1},
        },
        "source_text": "미드는 하루 1명까지",
    }
    llm.responses = [ok({"rules": [rule], "config_changes": [{"action": "add", "shift": mid}]})]
    body = client.post("/api/py/translate", json=translate_body("미드 추가, 하루 1명까지")).json()
    (examples,) = body["examples"].values()
    assert examples and all(row[ex["days"].index(d)] == "M" for ex in examples for nid, d in ex["marks"] for row in [ex["cells"][nid]])
    assert "미드" in examples[0]["detail"]


def test_translate_examples_time_budget(llm, monkeypatch):
    monkeypatch.setattr(routes, "EXAMPLES_TIME_BUDGET_S", 0)
    llm.responses = [ok({"rules": [LEAVE_DRAFT, PAIR_DRAFT]})]
    body = client.post("/api/py/translate", json=translate_body()).json()
    assert len(body["examples"]) == 2 and all(v == [] for v in body["examples"].values())


def test_translate_clarify(llm):
    llm.responses = [ok({"clarification_question": "e01 휴가는 며칠인가요?"})]
    r = client.post("/api/py/translate", json=translate_body("이영희 휴가"))
    assert r.json() == {"status": "clarify", "input_version": 9, "question": "이영희 휴가는 며칠인가요?"}


def test_translate_unsupported(llm):
    llm.responses = [ok({"unsupported_reason": "교육 일정은 지원하지 않습니다."})]
    r = client.post("/api/py/translate", json=translate_body("교육 일정 넣어줘"))
    assert r.json()["status"] == "unsupported"
    assert r.json()["input_version"] == 9


# --- explain ---


def explain_body() -> dict:
    req = infeasible_request()
    return {
        "request": req,
        "conflicts": [
            {"constraint_id": "f1", "type": "fixed_assignment", "source_text": "f1 원문"},
            {"constraint_id": "f2", "type": "fixed_assignment", "source_text": "f2 원문"},
            {"constraint_id": "rule-min-off", "type": "rule", "source_text": "최소 휴무"},
        ],
    }


GOOD = {"title": "f1 해제", "description": "D 고정을 푼다", "changes": [{"action": "disable", "constraint_id": "f1"}]}
BAD = {
    "title": "휴무 9일로",
    "description": "여전히 같은 날 두 근무",
    "changes": [{"action": "set_value", "constraint_id": "rule-min-off", "name": "min", "value": 9}],
}


def test_explain_returns_only_verified_proposals(llm):
    llm.responses = [ok({"text": "e01이 5일에 두 근무로 고정되어 있습니다.", "proposals": [BAD, GOOD]})]
    r = client.post("/api/py/explain", json=explain_body())
    assert r.status_code == 200
    body = r.json()
    assert body["fallback"] is False
    assert body["input_version"] == 5
    assert body["text"] == "이영희이 5일에 두 근무로 고정되어 있습니다."
    assert [p["title"] for p in body["proposals"]] == ["f1 해제"]
    assert body["proposals"][0]["verified_summary"] is not None


def rule_explain_body() -> dict:
    """하루 데이 인원 규칙(값 min)이 명단보다 많아 휴가와 부딪친다 → 해 없음."""
    req = sample()
    employee_ids = [n["id"] for n in req["employees"]]
    req["constraints"] = [
        {
            "id": "cov",
            "scope": "shop",
            "type": "rule",
            "default": True,
            "values": {"min": {"value": len(employee_ids) - 1, "label": "최소 인원"}},
            "body": {"kind": "require", "for_each": {"per": "day"}, "then": {"left": {"shifts": {"in": ["D"]}}, "op": "ge", "right": {"value": "min"}}},
            "source_text": "데이 많이",
        },
        {
            "id": "lv",
            "scope": "period",
            "type": "rule",
            "values": {"max": {"value": 0, "label": "최대 횟수"}},
            "body": {
                "kind": "require",
                "for_each": {"per": "person", "people": {"ids": employee_ids[:2]}, "days": {"days": [3]}},
                "then": {"left": {"shifts": {"not_in": ["O"]}}, "op": "le", "right": {"value": "max"}},
            },
            "source_text": "3일 휴가 둘",
        },
    ]
    return {
        "request": req,
        "conflicts": [
            {"constraint_id": "cov", "type": "rule", "source_text": "데이 많이"},
            {"constraint_id": "lv", "type": "rule", "source_text": "3일 휴가 둘"},
        ],
    }


def test_explain_rule_set_value_verified_by_resolve(llm):
    body = rule_explain_body()
    assert client.post("/api/py/solve", json=body["request"]).json()["status"] == "infeasible"
    n = len(body["request"]["employees"])

    def change(title: str, *changes: dict) -> dict:
        return {"title": title, "description": title, "changes": list(changes)}

    lower = change("데이 1명으로", {"action": "set_value", "constraint_id": "cov", "name": "min", "value": 1})
    still_bad = change("데이 그대로", {"action": "set_value", "constraint_id": "cov", "name": "min", "value": n - 1})
    soft = change("가능하면으로", {"action": "set_hardness", "constraint_id": "cov", "hardness": "soft"})
    llm.responses = [ok({"text": "데이 인원이 너무 많습니다.", "proposals": [still_bad, lower, soft]})]
    r = client.post("/api/py/explain", json=body)
    assert r.status_code == 200
    proposals = r.json()["proposals"]
    assert [p["title"] for p in proposals] == ["데이 1명으로", "가능하면으로"]
    (c,) = proposals[0]["changes"]
    assert (c["action"], c["name"], c["value"]) == ("set_value", "min", 1)
    assert proposals[0]["verified_summary"] is not None


def test_apply_set_value_and_set_hardness():
    from backend.domain.models import ConstraintChange, ScheduleRequest

    req = ScheduleRequest.model_validate(rule_explain_body()["request"])
    out = routes._apply(
        req,
        [
            ConstraintChange(action="set_value", constraint_id="cov", name="min", value=2),
            ConstraintChange(action="set_hardness", constraint_id="lv", hardness="soft"),
        ],
    )
    cov, lv = out.constraints
    assert cov.values["min"].value == 2 and cov.values["min"].label == "최소 인원" and cov.default is True
    assert lv.hardness == "soft" and lv.values["max"].value == 0
    assert req.constraints[0].values["min"].value == len(req.employees) - 1  # 원본은 그대로


def test_apply_set_value_max_run_moves_window():
    """'최대 연속 나이트 3 → 4'는 창 4일·≤4(사실상 끄기)가 아니라 창 5일·≤4로 검증한다."""
    from backend.domain.models import ConstraintChange, ScheduleRequest
    from backend.tests.rules import max_nights

    body = rule_explain_body()["request"]
    body["constraints"] = [max_nights("mx", 3)]
    req = ScheduleRequest.model_validate(body)
    (mx,) = routes._apply(req, [ConstraintChange(action="set_value", constraint_id="mx", name="max_len", value=4)]).constraints
    assert mx.values["max_len"].value == 4 and mx.body.for_each.window == 5


@pytest.mark.parametrize("error", [LLMUnavailableError("down"), None])
def test_explain_fallback_on_llm_failure(llm, error):
    invalid = ok({"text": ""})
    llm.responses = [error] if error else [invalid, invalid, invalid]
    r = client.post("/api/py/explain", json=explain_body())
    assert r.status_code == 200
    body = r.json()
    assert body["fallback"] is True
    assert body["proposals"] == []
    assert "f1 원문" in body["text"]
    assert body["input_version"] == 5


def test_explain_verifies_with_time_limit_without_conflict_analysis(llm, monkeypatch):
    calls = []

    def fake_solve(req, time_limit_s, analyze_conflicts):
        calls.append((time_limit_s, analyze_conflicts))
        return real_solve(req, time_limit_s=time_limit_s, analyze_conflicts=analyze_conflicts)

    monkeypatch.setattr(routes, "solve", fake_solve)
    llm.responses = [ok({"text": "설명", "proposals": [GOOD]})]
    client.post("/api/py/explain", json=explain_body())
    assert len(calls) == 1
    assert calls[0][0] <= PROPOSAL_VERIFY_TIME_LIMIT_S
    assert calls[0][1] is False


def test_explain_verify_passes_history(llm, monkeypatch):
    seen = []

    def fake_solve(req, time_limit_s, analyze_conflicts):
        seen.append(req.history)
        return real_solve(req, time_limit_s=time_limit_s, analyze_conflicts=analyze_conflicts)

    monkeypatch.setattr(routes, "solve", fake_solve)
    body = explain_body()
    body["request"]["history"] = HISTORY
    llm.responses = [ok({"text": "설명", "proposals": [GOOD]})]
    assert client.post("/api/py/explain", json=body).status_code == 200
    assert [h.model_dump(mode="json") for h in seen] == [HISTORY]


def test_explain_stops_when_verify_budget_exhausted(llm, monkeypatch):
    clock = [0.0]
    ok_result = real_solve(routes.ScheduleRequest.model_validate(sample()))
    calls = []

    def slow_solve(req, time_limit_s, analyze_conflicts):
        calls.append(time_limit_s)
        clock[0] += PROPOSAL_VERIFY_TIME_LIMIT_S * MAX_PROPOSALS * 0.6
        return ok_result

    monkeypatch.setattr(routes, "solve", slow_solve)
    monkeypatch.setattr(routes, "monotonic", lambda: clock[0])
    second = {**GOOD, "title": "f1 해제 2"}
    third = {**GOOD, "title": "f1 해제 3"}
    llm.responses = [ok({"text": "설명", "proposals": [GOOD, second, third]})]
    body = client.post("/api/py/explain", json=explain_body()).json()
    assert len(calls) == 2  # 두 번째 검증 뒤 예산 초과 → 세 번째는 검증하지 않는다
    assert [p["title"] for p in body["proposals"]] == ["f1 해제", "f1 해제 2"]


# --- 오류 ---


def test_413_too_many_employees():
    data = sample()
    data["employees"] = [{"id": f"x{i}", "name": f"이름{i}"} for i in range(MAX_EMPLOYEES + 1)]
    data["constraints"] = []
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_413_too_many_constraints():
    data = sample()
    data["constraints"] = [{"bogus": i} for i in range(MAX_CONSTRAINTS + 1)]  # Pydantic 검증보다 먼저 막는다
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_solve_accepts_past_day_locks_beyond_constraint_cap():
    # 운영 중 근무표의 지난 날짜 잠금은 칸마다 고정 근무 1개다. 15명 × 27일 = 405개도 받아야 한다
    data = sample()
    first = client.post("/api/py/solve", json=data).json()["result"]["assignments"]
    days = MAX_CONSTRAINTS // len(first) + 1
    locks = [fixed(f"lock-{nid}-{d}", nid, d, row[d - 1]) for nid, row in first.items() for d in range(1, days + 1)]
    assert len(locks) > MAX_CONSTRAINTS
    data["constraints"] = data["constraints"] + locks
    r = client.post("/api/py/solve", json=data)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def _avail(cid: str, nid: str, day: int, shift: str) -> dict:
    return count(cid, {"in": [shift]}, "person", hi=0, people={"ids": [nid]}, days={"days": [day]}, scope="period")


def test_solve_accepts_availability_rules_beyond_constraint_cap():
    # 가능 시간 규칙은 직원 × 코드마다 생겨 규칙·요청 200개 상한과 따로 센다
    data = sample()
    first = client.post("/api/py/solve", json=data).json()["result"]["assignments"]
    free = [(nid, d + 1, s) for nid, row in first.items() for d, code in enumerate(row) for s in ("D", "E", "N") if s != code]
    rules = [_avail(f"{AVAILABILITY_RULE_PREFIX}{i}", *cell) for i, cell in enumerate(free[: MAX_CONSTRAINTS + 1])]
    assert len(rules) > MAX_CONSTRAINTS
    data["constraints"] = data["constraints"] + rules
    r = client.post("/api/py/solve", json=data)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_413_too_many_availability_rules():
    data = sample()
    data["constraints"] = [{"id": f"{AVAILABILITY_RULE_PREFIX}{i}"} for i in range(MAX_AVAILABILITY_RULES + 1)]
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_constraint_cap_still_counts_other_rules_beside_availability():
    data = sample()
    data["constraints"] = [{"id": f"r{i}"} for i in range(MAX_CONSTRAINTS + 1)] + [{"id": f"{AVAILABILITY_RULE_PREFIX}0"}]
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_413_too_many_fixed_assignments():
    data = sample()
    data["constraints"] = [{"type": "fixed_assignment"} for _ in range(MAX_FIXED_ASSIGNMENTS + 1)]
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_413_text_too_long(llm):
    assert_error(client.post("/api/py/translate", json=translate_body("가" * (MAX_TEXT_CHARS + 1))), 413, "PAYLOAD_TOO_LARGE")
    assert llm.calls == []


def test_413_explain_nested_request():
    body = explain_body()
    body["request"]["constraints"] = [{} for _ in range(MAX_CONSTRAINTS + 1)]
    assert_error(client.post("/api/py/explain", json=body), 413, "PAYLOAD_TOO_LARGE")


def shift_codes(n: int) -> dict:
    """D/E/N/O + 추가 코드로 근무 코드 n개인 config."""
    extra = [{"code": f"X{i}", "name": f"X{i}", "hours": 8, "start": "09:00", "end": "17:00"} for i in range(n - 4)]
    return {"shifts": DEN_SHIFTS + extra}


def test_413_too_many_shift_codes():
    data = sample()
    data["config"] = shift_codes(MAX_SHIFT_CODES + 1)
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_solve_accepts_shift_codes_at_limit():
    data = sample()
    data["config"] = shift_codes(MAX_SHIFT_CODES)
    r = client.post("/api/py/solve", json=data)
    assert r.status_code == 200, r.text


def test_413_too_many_shift_codes_in_translate_context(llm):
    body = translate_body()
    body["context"]["config"] = shift_codes(MAX_SHIFT_CODES + 1)
    assert_error(client.post("/api/py/translate", json=body), 413, "PAYLOAD_TOO_LARGE")
    assert llm.calls == []


def test_413_too_many_tags_per_employee():
    data = sample()
    data["employees"][0]["tags"] = [f"t{i}" for i in range(MAX_TAGS_PER_EMPLOYEE + 1)]
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_solve_accepts_tags_at_limit():
    data = sample()
    data["employees"][0]["tags"] = [f"t{i}" for i in range(MAX_TAGS_PER_EMPLOYEE)]
    assert client.post("/api/py/solve", json=data).status_code == 200


def block(type_: str, params: dict) -> dict:
    return {"id": "b1", "type": type_, "scope": "shop", "hardness": "hard", "source_text": "원문", "params": params}


N_SEL, D_SEL = {"in": ["N"]}, {"in": ["D"]}


@pytest.mark.parametrize(
    "spec",
    [
        block("count", {"shifts": D_SEL, "per": "day", "min": 1}),
        block("sequence", {"forbid": [[N_SEL, D_SEL]]}),
        {**block("balance", {"shifts": N_SEL}), "hardness": "soft"},
    ],
    ids=["count", "sequence", "balance"],
)
@pytest.mark.parametrize("endpoint", ["solve", "explain"])
def test_block_types_are_422(spec, endpoint):
    """블록 3종은 옛 형식이다(ADR-019 ★2). 요청은 rule | fixed_assignment만 받는다."""
    data = sample()
    data["constraints"] = data["constraints"] + [spec]
    body = data if endpoint == "solve" else {"request": data, "conflicts": []}
    r = client.post(f"/api/py/{endpoint}", json=body)
    assert_error(r, 422, "VALIDATION_ERROR")
    assert "constraints" in r.json()["error"]["message"]


# --- 규칙 식 상한(ADR-019): 모델 검증이라 422 ---


def rule(body: dict, values: dict | None = None, rid: str = "r1") -> dict:
    return {"id": rid, "type": "rule", "scope": "shop", "hardness": "hard", "source_text": "원문", "values": values or {}, "body": body}


def off_count(offset: tuple[int, int] | None = None) -> dict:
    c: dict = {"shifts": {"in": ["O"]}}
    if offset is not None:
        c["offset"] = list(offset)
    return c


def true_cmp(right=0, offset=None) -> dict:
    """늘 참인 비교: 휴무 수 ≥ 0, 또는 ≤ 큰 값."""
    return {"left": off_count(offset), "op": "ge" if right == 0 else "le", "right": right}


def cond(cmps: list[dict]) -> dict:
    return cmps[0] if len(cmps) == 1 else {"all": cmps}


def rule_with_cmps(n: int) -> dict:
    """비교 n개: then 그리고 4개까지, 나머지는 when."""
    then, when = [true_cmp()] * min(n, 4), [true_cmp()] * (n - min(n, 4))
    body = {"kind": "require", "for_each": {"per": "day"}, "then": cond(then)}
    if when:
        body["when"] = cond(when)
    return rule(body)


def rule_with_values(n: int) -> dict:
    """값 n개를 비교 n개가 하나씩 쓴다."""
    names = [f"v{i}" for i in range(n)]
    cmps = [true_cmp({"value": v}) for v in names]
    then, when = cmps[:4], cmps[4:]
    body = {"kind": "require", "for_each": {"per": "day"}, "then": cond(then)}
    if when:
        body["when"] = cond(when)
    return rule(body, {v: {"value": 40, "label": f"최대 인원 {v}"} for v in names})


def rule_with_offset(offset: tuple[int, int]) -> dict:
    return rule({"kind": "require", "for_each": {"per": "person_day"}, "then": true_cmp(offset=offset)})


def rule_with_window(window: int) -> dict:
    return rule({"kind": "require", "for_each": {"per": "person_window", "window": window}, "then": true_cmp()})


@pytest.mark.parametrize(
    "spec, accepted",
    [
        (rule_with_values(MAX_RULE_VALUES), True),
        (rule_with_values(MAX_RULE_VALUES + 1), False),
        (rule_with_cmps(MAX_RULE_CMPS), True),
        (rule_with_cmps(MAX_RULE_CMPS + 1), False),
        (rule_with_offset((MIN_OFFSET, MIN_OFFSET)), True),
        (rule_with_offset((MIN_OFFSET - 1, MIN_OFFSET - 1)), False),
        (rule_with_offset((MAX_OFFSET, MAX_OFFSET)), True),
        (rule_with_offset((MAX_OFFSET + 1, MAX_OFFSET + 1)), False),
        (rule_with_offset((0, MAX_OFFSET_SPAN - 1)), True),
        (rule_with_offset((0, MAX_OFFSET_SPAN)), False),
        (rule_with_window(MAX_WINDOW_DAYS), True),
        (rule_with_window(MAX_WINDOW_DAYS + 1), False),
    ],
    ids=[
        "values-at-limit", "values-over", "cmps-at-limit", "cmps-over",
        "offset-min-at-limit", "offset-min-over", "offset-max-at-limit", "offset-max-over",
        "offset-span-at-limit", "offset-span-over", "window-at-limit", "window-over",
    ],
)
def test_rule_expr_limits_are_422(spec, accepted):
    data = sample()
    data["constraints"] = data["constraints"] + [spec]
    r = client.post("/api/py/solve", json=data)
    if accepted:
        assert r.status_code == 200, r.text
    else:
        assert_error(r, 422, "VALIDATION_ERROR")


def test_constraint_cap_counts_rules():
    # 금지 패턴을 나눠 늘어난 규칙도 하나씩 센다. 칸 고정은 따로 센다
    data = sample()
    first = client.post("/api/py/solve", json=data).json()["result"]["assignments"]
    nid, row = next(iter(first.items()))
    rules = [rule({"kind": "require", "for_each": {"per": "day"}, "then": true_cmp()}, rid=f"r{i}") for i in range(MAX_CONSTRAINTS)]
    data["constraints"] = rules + [fixed("lock-1", nid, 1, row[0])]
    r = client.post("/api/py/solve", json=data)
    assert r.status_code == 200, r.text
    data["constraints"] = data["constraints"] + [rule(rules[0]["body"], rid="r-extra")]
    assert_error(client.post("/api/py/solve", json=data), 413, "PAYLOAD_TOO_LARGE")


def test_422_pydantic_error_has_field_path():
    data = sample()
    data["employees"][0]["name"] = ""
    err = assert_error(client.post("/api/py/solve", json=data), 422, "VALIDATION_ERROR")
    assert "employees.0.name" in err["message"]


def test_422_referential_integrity_has_constraint_id():
    data = sample()
    data["constraints"].append(fixed("ghost", "e99", 3, "D"))
    err = assert_error(client.post("/api/py/solve", json=data), 422, "VALIDATION_ERROR")
    assert "ghost" in err["message"]


def test_422_invalid_json():
    r = client.post("/api/py/solve", content=b"{not json", headers={"content-type": "application/json"})
    assert_error(r, 422, "VALIDATION_ERROR")


def test_502_llm_invalid_output(llm):
    bad = ok({"rules": [{"body": {"kind": "unknown_template"}, "source_text": "x"}]})
    llm.responses = [bad, bad, bad]
    assert_error(client.post("/api/py/translate", json=translate_body()), 502, "LLM_INVALID_OUTPUT")


def test_503_llm_unavailable(llm):
    llm.responses = [LLMUnavailableError("Anthropic 사용 불가(HTTP 529)")]
    assert_error(client.post("/api/py/translate", json=translate_body()), 503, "LLM_UNAVAILABLE")


def test_500_config_error_from_client(llm):
    llm.responses = [LLMConfigError("Anthropic 인증 실패(HTTP 401)")]
    assert_error(client.post("/api/py/translate", json=translate_body()), 500, "CONFIG_ERROR")


def test_500_config_error_missing_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert_error(client.post("/api/py/explain", json=explain_body()), 500, "CONFIG_ERROR")


def test_500_internal_hides_stack(monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("secret detail")

    monkeypatch.setattr(routes, "solve", boom)
    err = assert_error(client.post("/api/py/solve", json=sample()), 500, "INTERNAL")
    assert "secret detail" not in err["message"]
    assert "Traceback" not in err["message"]
    lines = log_lines(capsys)
    assert lines[-1]["request_id"] == err["request_id"]
    assert lines[-1]["status"] == 500


# --- 구조화 로그 ---


def test_log_line_for_llm_request_without_raw_text(llm, capsys):
    for_each = {**LEAVE_DRAFT["body"]["for_each"], "days": {"days": [40]}}
    bad = ok({"rules": [{**LEAVE_DRAFT, "body": {**LEAVE_DRAFT["body"], "for_each": for_each}, "source_text": "x"}]})
    good = ok({"rules": [{**LEAVE_DRAFT, "source_text": "e01 15일 휴가"}]})
    llm.responses = [bad, good]
    capsys.readouterr()
    client.post("/api/py/translate", json=translate_body("이영희 15일 휴가 비밀메모"))
    out = capsys.readouterr()
    assert "비밀메모" not in out.out + out.err
    assert "이영희" not in out.out + out.err
    lines = [json.loads(line) for line in out.out.splitlines() if line.startswith("{")]
    assert len(lines) == 1
    line = lines[0]
    assert line["path"] == "/api/py/translate"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], (int, float))
    assert len(line["request_id"]) == 36
    assert line["llm_retries"] == 1
    assert line["input_tokens"] == 200
    assert line["output_tokens"] == 100


def test_log_line_for_solve_has_no_llm_fields(capsys):
    capsys.readouterr()
    client.post("/api/py/solve", json=sample())
    (line,) = log_lines(capsys)
    assert line["path"] == "/api/py/solve"
    assert line["status"] == 200
    assert "llm_retries" not in line
