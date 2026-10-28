"""HTTP 계층: 계약, 오케스트레이션(제안 재풀이 검증), 오류 변환, 구조화 로그. LLM은 mock, 솔버는 실제로 돌린다."""

import copy
import json

import pytest
from fastapi.testclient import TestClient

from backend import routes
from backend.domain.constants import (
    MAX_CONSTRAINTS,
    MAX_FIXED_ASSIGNMENTS,
    MAX_NURSES,
    MAX_PROPOSALS,
    MAX_TEXT_CHARS,
    PROPOSAL_VERIFY_TIME_LIMIT_S,
)
from backend.llm.client import LLMConfigError, LLMUnavailableError, ToolCallResult
from backend.routes import app, get_llm_client
from backend.solver.model import solve as real_solve
from backend.tests.test_solver_hard import sample_data

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
        "params": {"nurse_id": nid, "day": day, "shift": shift},
        "source_text": f"{cid} 원문",
    }


def infeasible_request() -> dict:
    """n01을 5일에 D와 N으로 동시에 고정 → 해 없음."""
    data = sample()
    data["constraints"] += [fixed("f1", "n01", 5, "D"), fixed("f2", "n01", 5, "N")]
    return data


def translate_body(text: str = "이영희 15~17일 휴가") -> dict:
    data = sample()
    return {
        "text": text,
        "scope": "period",
        "context": {"nurses": data["nurses"], "period": data["period"], "holidays": [5], "today": "2026-10-26"},
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


def test_solve_passes_history_load(monkeypatch):
    seen = []
    monkeypatch.setattr(routes, "solve", lambda req: seen.append(req.history_load) or real_solve(req))
    data = sample()
    data["history_load"] = [{"nurse_id": "n03", "nights": 8, "weekends": 2}]
    assert client.post("/api/py/solve", json=data).status_code == 200
    assert seen[0][0].nights == 8


def test_solve_infeasible_with_conflicts():
    r = client.post("/api/py/solve", json=infeasible_request())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "infeasible"
    assert body["input_version"] == 5
    assert {c["constraint_id"] for c in body["conflicts"]} == {"f1", "f2"}


# --- translate ---


def test_translate_ok(llm):
    llm.responses = [
        ok({"constraints": [{"type": "leave", "params": {"nurse_id": "n01", "days": [15, 16, 17]}, "source_text": "n01 15~17일 휴가"}]})
    ]
    r = client.post("/api/py/translate", json=translate_body())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["input_version"] == 9
    assert body["constraints"][0]["type"] == "leave"
    assert body["constraints"][0]["source_text"] == "이영희 15~17일 휴가"


def test_translate_clarify(llm):
    llm.responses = [ok({"clarification_question": "n01 휴가는 며칠인가요?"})]
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
        ],
    }


GOOD = {"title": "f1 해제", "description": "D 고정을 푼다", "changes": [{"action": "disable", "constraint_id": "f1"}]}
BAD = {
    "title": "f2를 E로",
    "description": "여전히 같은 날 두 근무",
    "changes": [{"action": "update", "constraint_id": "f2", "params": {"shift": "E"}}],
}


def test_explain_returns_only_verified_proposals(llm):
    llm.responses = [ok({"text": "n01이 5일에 두 근무로 고정되어 있습니다.", "proposals": [BAD, GOOD]})]
    r = client.post("/api/py/explain", json=explain_body())
    assert r.status_code == 200
    body = r.json()
    assert body["fallback"] is False
    assert body["input_version"] == 5
    assert body["text"] == "이영희이 5일에 두 근무로 고정되어 있습니다."
    assert [p["title"] for p in body["proposals"]] == ["f1 해제"]
    assert body["proposals"][0]["verified_summary"] is not None


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


def test_explain_verify_passes_history_load(llm, monkeypatch):
    seen = []

    def fake_solve(req, time_limit_s, analyze_conflicts):
        seen.append(req.history_load)
        return real_solve(req, time_limit_s=time_limit_s, analyze_conflicts=analyze_conflicts)

    monkeypatch.setattr(routes, "solve", fake_solve)
    body = explain_body()
    body["request"]["history_load"] = [{"nurse_id": "n03", "nights": 8, "weekends": 2}]
    llm.responses = [ok({"text": "설명", "proposals": [GOOD]})]
    assert client.post("/api/py/explain", json=body).status_code == 200
    assert [[h.model_dump() for h in load] for load in seen] == [[{"nurse_id": "n03", "nights": 8, "weekends": 2}]]


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


def test_413_too_many_nurses():
    data = sample()
    data["nurses"] = [{"id": f"x{i}", "name": f"이름{i}", "years": 1} for i in range(MAX_NURSES + 1)]
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


def test_422_pydantic_error_has_field_path():
    data = sample()
    data["nurses"][0]["years"] = -1
    err = assert_error(client.post("/api/py/solve", json=data), 422, "VALIDATION_ERROR")
    assert "nurses.0.years" in err["message"]


def test_422_referential_integrity_has_constraint_id():
    data = sample()
    data["constraints"].append(fixed("ghost", "n99", 3, "D"))
    err = assert_error(client.post("/api/py/solve", json=data), 422, "VALIDATION_ERROR")
    assert "ghost" in err["message"]


def test_422_invalid_json():
    r = client.post("/api/py/solve", content=b"{not json", headers={"content-type": "application/json"})
    assert_error(r, 422, "VALIDATION_ERROR")


def test_502_llm_invalid_output(llm):
    bad = ok({"constraints": [{"type": "unknown_template", "params": {}, "source_text": "x"}]})
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
    bad = ok({"constraints": [{"type": "leave", "params": {"nurse_id": "n01", "days": [40]}, "source_text": "x"}]})
    good = ok({"constraints": [{"type": "leave", "params": {"nurse_id": "n01", "days": [15]}, "source_text": "n01 15일 휴가"}]})
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
