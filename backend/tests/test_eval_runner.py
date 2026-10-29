"""eval/run.py: 채점, 데이터셋 검증, mock 클라이언트 실행 집계. 네트워크를 쓰지 않는다."""

import importlib.util
from pathlib import Path

import pytest

from backend.llm.client import ToolCallResult

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("eval_run", ROOT / "eval" / "run.py")
run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run)


def leave(nurse_id: str, days: list[int], **extra) -> dict:
    return {"type": "leave", "hardness": "hard", "params": {"nurse_id": nurse_id, "days": days}, **extra}


NF = {"type": "night_fairness", "hardness": "soft", "params": {}}


# --- 채점 ---


def test_score_order_independent():
    a, b = leave("n01", [15]), NF
    assert run.score_constraints([a, b], [b, a]) == (2, 2, 2)


def test_score_sorts_days():
    assert run.score_constraints([leave("n01", [15, 16, 17])], [leave("n01", [17, 15, 16])]) == (1, 1, 1)


def test_score_ignores_id_source_text_weight_scope():
    actual = leave("n01", [15], id="abc", source_text="이영희 15일 휴가", weight=1, scope="period", enabled=True)
    assert run.score_constraints([leave("n01", [15])], [actual]) == (1, 1, 1)


def test_score_compares_hardness_and_params():
    soft = {**NF, "hardness": "hard"}
    assert run.score_constraints([NF], [soft]) == (0, 1, 1)
    assert run.score_constraints([leave("n01", [15])], [leave("n02", [15])]) == (0, 1, 1)


def test_score_multiset():
    assert run.score_constraints([leave("n01", [1]), leave("n01", [1])], [leave("n01", [1])]) == (1, 2, 1)


def test_score_fills_defaults():
    expected = {"type": "shift_preference", "hardness": "soft", "params": {"nurse_id": "n01", "shift": "O", "prefer": True}}
    actual = {**expected, "params": {**expected["params"], "days": None, "weekends_only": False}}
    assert run.score_constraints([expected], [actual]) == (1, 1, 1)


# --- 데이터셋 검증 ---


def case(id_: str, expected: dict, **extra) -> dict:
    return {"id": id_, "today": "2026-10-26", "scope": "period", "text": "t", "expected": expected, **extra}


def test_validate_dataset_ok():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("n01", [15])]}, holidays=[5]),
        case("b", {"status": "clarify"}),
    ]
    assert run.validate_dataset(cases) == []


@pytest.mark.parametrize(
    "cases",
    [
        [case("a", {"status": "clarify"}), case("a", {"status": "clarify"})],  # id 중복
        [case("a", {"status": "maybe"})],  # status 값
        [case("a", {"status": "ok", "constraints": [leave("n99", [15])]})],  # 명단 밖
        [case("a", {"status": "ok", "constraints": [leave("n01", [31])]})],  # 11월 31일
        [case("a", {"status": "ok", "constraints": [{"type": "nope", "params": {}}]})],  # 템플릿 밖
        [case("a", {"status": "ok", "constraints": []})],  # ok인데 제약 없음
        [case("a", {"status": "clarify", "constraints": [leave("n01", [15])]})],  # clarify인데 제약 있음
        [case("a", {"status": "clarify"}, holidays=[40])],
        [case("a", {"status": "clarify"}, scope="year")],
    ],
)
def test_validate_dataset_errors(cases):
    assert run.validate_dataset(cases)


CROSS = {"start_date": "2026-11-23", "length": 14}


def test_validate_dataset_uses_case_period():
    # 14일 기간에는 15일이 없고, 기본(샘플) 30일 기간에는 있다
    assert run.validate_dataset([case("a", {"status": "ok", "constraints": [leave("n01", [15])]}, period=CROSS)])
    assert run.validate_dataset([case("a", {"status": "ok", "constraints": [leave("n01", [9, 10, 11])]}, period=CROSS)]) == []


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
    assert 35 <= len(cases) <= 50
    assert run.validate_dataset(cases) == []


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
    """translator가 내는 블록 모양의 휴가. 채점은 템플릿 기대값을 블록으로 바꿔 비교한다."""
    params = {"people": {"ids": [nurse_id]}, "days": {"days": days}, "shifts": {"not_in": ["O"]}, "per": "person", "max": 0}
    return draft("count", params)


NF_DRAFT = draft("balance", {"people": {"exclude_tags": ["나이트전담"]}, "shifts": {"in": ["N"]}}, "hard")


def test_score_compares_template_expected_with_block_actual():
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
        ok({"constraints": [leave_draft("n01", "많이")]}),  # 스키마 위반 → 재시도
        ok({"constraints": [leave_draft("n01", [16, 15]), NF_DRAFT]}),
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
    bad = ok({"constraints": [leave_draft("n01", "x")]})
    client = FakeClient(ok({"constraints": [leave_draft("n01", [15])]}), bad, bad, bad)
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
    results = run.run_cases(cases, FakeClient(ok({"constraints": [leave_draft("n01", [1])]})))
    out = tmp_path / "results.md"
    run.write_results(out, run.aggregate(results), results, model="fake-model")
    text = out.read_text(encoding="utf-8")
    assert "fake-model" in text and "| a |" in text and "clarify" in text


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

    assert run.score_constraints([forbid(("N", "D"), ("N", "E"))], [forbid(("N", "E"), ("N", "D"))]) == (1, 1, 1)
    assert run.score_constraints([forbid(("N", "D"))], [forbid(("D", "N"))]) == (0, 1, 1)
