"""eval/run.py: 의미 기준 채점, 데이터셋 검증, mock 클라이언트 실행 집계, 게이트. 네트워크를 쓰지 않는다."""

import importlib.util
from pathlib import Path

import pytest

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


def test_score_converts_template_expected():
    template = {"type": "leave", "hardness": "hard", "params": {"nurse_id": "n01", "days": [15, 16]}}
    assert run.score_constraints([template], [leave("n01", [16, 15])]) == (1, 1, 1)


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
    s1 = run.judge_schedules(case_, run.judge_config([]), [run._spec(leave("n01", [3]))])
    s2 = run.judge_schedules(case_, run.judge_config([]), [run._spec(leave("n01", [3]))])
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


def test_validate_dataset_ok():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("n01", [15])]}, holidays=[5]),
        case("b", {"status": "clarify"}),
        case("c", {"status": "ok", "config_changes": [M]}, set="new"),
        case("d", {"status": "ok", "config_changes": [DE], "constraints": [count({"shifts": {"in": ["DE"]}, "per": "person", "max": 2})]}, set="new"),
        case("e", {"status": "ok", "constraints": [count({"people": {"tags": ["책임"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1})]}),
        case("f", {"status": "ok", "constraints": [{"type": "fixed_assignment", "params": {"nurse_id": "n03", "day": 25, "shift": "N"}}]}),
    ]
    assert run.validate_dataset(cases) == []


@pytest.mark.parametrize(
    "cases",
    [
        [case("a", {"status": "clarify"}), case("a", {"status": "clarify"})],  # id 중복
        [case("a", {"status": "maybe"})],  # status 값
        [case("a", {"status": "ok", "constraints": [leave("n99", [15])]})],  # 명단 밖
        [case("a", {"status": "ok", "constraints": [leave("n01", [31])]})],  # 11월 31일
        [case("a", {"status": "ok", "constraints": [{"type": "nope", "params": {}}]})],  # 블록 밖
        [case("a", {"status": "ok", "constraints": [{"type": "leave", "hardness": "hard", "params": {"nurse_id": "n01", "days": [15]}}]})],  # 템플릿
        [case("a", {"status": "ok", "constraints": []})],  # ok인데 제약·설정 변경 없음
        [case("a", {"status": "clarify", "constraints": [leave("n01", [15])]})],  # clarify인데 제약 있음
        [case("a", {"status": "unsupported", "config_changes": [M]})],  # unsupported인데 설정 변경 있음
        [case("a", {"status": "clarify"}, holidays=[40])],
        [case("a", {"status": "clarify"}, scope="year")],
        [case("a", {"status": "clarify"}, set="other")],  # set 값
        [{k: v for k, v in case("a", {"status": "clarify"}).items() if k != "set"}],  # set 없음
        [case("a", {"status": "ok", "constraints": [count({"shifts": {"in": ["M"]}, "per": "day", "min": 1})]})],  # 없는 코드
        [case("a", {"status": "ok", "config_changes": [{"action": "add", "shift": {"code": "D", "name": "데이", "hours": 8}}]})],  # 있는 코드 add
        [case("a", {"status": "ok", "constraints": [count({"people": {"tags": ["프리셉터"]}, "shifts": {"in": ["D"]}, "per": "day", "min": 1})]})],  # 없는 태그
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
    assert run.validate_dataset(cases) == []
    sets = [c["set"] for c in cases]
    assert sets.count("legacy") == 49  # 기존 케이스 전부(w·h·m·c·u 44건 + 기간 경계 p 5건)
    assert sets.count("new") >= 25


def test_real_dataset_legacy_is_blocks():
    # 기존 케이스는 convert_dataset.py로 기계 변환한 블록(템플릿 type이 남지 않는다)
    types = {c["type"] for case_ in run.load_dataset(run.DATASET) for c in case_["expected"].get("constraints", [])}
    assert types <= {"count", "sequence", "balance", "fixed_assignment"}


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
    run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "fake-model" in text and "| a |" in text and "clarify" in text


def test_run_case_config_changes():
    de_rule = count({"shifts": {"in": ["DE"]}, "per": "person", "max": 2})
    cases = [case("a", {"status": "ok", "config_changes": [DE], "constraints": [de_rule]}, set="new", scope="ward")]
    client = FakeClient(ok({"config_changes": [DE], "constraints": [draft("count", de_rule["params"])]}))
    (r,) = run.run_cases(cases, client)
    assert (r.tp, r.n_expected, r.n_actual, r.exact, r.set) == (2, 2, 2, True, "new")
    assert r.actual_changes == [DE["shift"] | {"start": None, "active": True}]

    client = FakeClient(ok({"config_changes": [DE], "constraints": [draft("count", {**de_rule["params"], "max": 3})]}))
    (r,) = run.run_cases(cases, client)
    assert (r.tp, r.exact) == (1, False)


def test_aggregate_by_set_and_gate():
    cases = [
        case("a", {"status": "ok", "constraints": [leave("n01", [15])]}),
        case("b", {"status": "clarify"}),
        case("c", {"status": "unsupported"}, set="new"),
    ]
    client = FakeClient(
        ok({"constraints": [leave_draft("n01", [15])]}),
        ok({"clarification_question": "누구?"}),
        ok({"clarification_question": "뭐?"}),
    )
    results = run.run_cases(cases, client)
    by_set = run.aggregate_by_set(results)
    assert by_set["legacy"]["exact_match_rate"] == 1.0 and by_set["legacy"]["cases"] == 2
    assert by_set["new"]["exact_match_rate"] == 0.0
    failures = run.gate_failures(run.aggregate(results), by_set)
    assert any("new" in f for f in failures) and not any("legacy" in f for f in failures)


def test_gate_targets():
    assert run.GATE_EXACT == {"legacy": 0.95, "new": 0.85}
    assert run.GATE_SCHEMA_VALID == 1.0
    ok_metrics = {"schema_valid_rate": 1.0}
    assert run.gate_failures(ok_metrics, {"legacy": {"exact_match_rate": 0.95}, "new": {"exact_match_rate": 0.86}}) == []
    assert run.gate_failures({"schema_valid_rate": 0.99}, {"legacy": {"exact_match_rate": 1.0}, "new": {"exact_match_rate": 1.0}})


def test_write_results_set_table(tmp_path):
    cases = [case("a", {"status": "clarify"}), case("b", {"status": "clarify"}, set="new")]
    results = run.run_cases(cases, FakeClient(ok({"clarification_question": "?"}), ok({"clarification_question": "?"})))
    out = tmp_path / "results.md"
    run.write_results(out, run.aggregate(results), results, model="fake-model", by_set=run.aggregate_by_set(results))
    text = out.read_text(encoding="utf-8")
    assert "## set별 지표" in text and "| legacy |" in text and "| new |" in text


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

    assert run.score_constraints([forbid(("N", "D"), ("N", "E"))], [forbid(("N", "E"), ("N", "D"))]) == (1, 1, 1)
    assert run.score_constraints([forbid(("N", "D"))], [forbid(("D", "N"))]) == (0, 1, 1)
