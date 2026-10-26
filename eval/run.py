"""LLM 번역 정확도 eval.

uv run python eval/run.py [--dry-run] [--limit N] [--ids r01,r02]

--dry-run은 API를 호출하지 않고 데이터셋만 검증한다. 실행 모드는 결과를 eval/results.md에 쓴다.
"""

import argparse
import json
import math
import os
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import BaseModel, TypeAdapter, ValidationError  # noqa: E402

from backend.domain.models import (  # noqa: E402
    ConstraintSpec,
    Nurse,
    Period,
    ScheduleRequest,
    TranslateContext,
    TranslateRequest,
)
from backend.env import load_local_env  # noqa: E402
from backend.llm.client import AnthropicClient, LLMClient, LLMConfigError, ToolCallResult  # noqa: E402
from backend.llm.translator import translate  # noqa: E402

DATASET = ROOT / "eval" / "dataset.jsonl"
RESULTS = ROOT / "eval" / "results.md"
SAMPLE = ROOT / "lib" / "samples" / "ward-15.json"
STATUSES = ("ok", "clarify", "unsupported")
SCOPES = ("ward", "month")

_spec_adapter = TypeAdapter(ConstraintSpec)
_FILLER = {"id": "eval", "scope": "ward", "source_text": "eval", "weight": 1}


def _ward() -> dict:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


def load_dataset(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


# --- 채점 ---


def _spec(c: dict | BaseModel) -> Any:
    if isinstance(c, BaseModel):
        return c
    return _spec_adapter.validate_python({**_FILLER, **c})


def _key(c: dict | BaseModel) -> str:
    """비교 키: type, hardness, params(리스트는 정렬). id·source_text·weight·scope는 무시한다."""
    spec = _spec(c)
    params = {k: sorted(v) if isinstance(v, list) else v for k, v in spec.params.model_dump().items()}
    return json.dumps({"type": spec.type, "hardness": spec.hardness, "params": params}, sort_keys=True, ensure_ascii=False)


def score_constraints(expected: list, actual: list) -> tuple[int, int, int]:
    """순서 무관 다중집합 매칭. (일치 수, 기대 수, 실제 수)."""
    exp, act = Counter(map(_key, expected)), Counter(map(_key, actual))
    return sum((exp & act).values()), len(expected), len(actual)


# --- 데이터셋 검증 ---


def validate_dataset(cases: list[dict]) -> list[str]:
    ward = _ward()
    errors: list[str] = []
    ids = [c.get("id") for c in cases]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        errors.append(f"id 중복: {dups}")

    for c in cases:
        cid = c.get("id")
        expected = c.get("expected", {})
        status = expected.get("status")
        constraints = expected.get("constraints", [])
        if status not in STATUSES:
            errors.append(f"{cid}: status 값 {status!r}")
        if c.get("scope") not in SCOPES:
            errors.append(f"{cid}: scope 값 {c.get('scope')!r}")
        try:
            date.fromisoformat(c.get("today", ""))
        except (TypeError, ValueError):
            errors.append(f"{cid}: today 형식 {c.get('today')!r}")
        if not c.get("text"):
            errors.append(f"{cid}: text 없음")
        if status == "ok" and not constraints:
            errors.append(f"{cid}: ok인데 constraints가 비었음")
        if status in ("clarify", "unsupported") and constraints:
            errors.append(f"{cid}: {status}인데 constraints가 있음")

        try:
            specs = [{**_FILLER, **x, "id": f"{cid}-{i}", "scope": c.get("scope")} for i, x in enumerate(constraints)]
            ScheduleRequest.model_validate(
                {
                    "nurses": ward["nurses"],
                    "period": ward["period"],
                    "holidays": c.get("holidays", ward["holidays"]),
                    "constraints": specs,
                    "input_version": 0,
                }
            )
        except ValidationError as e:
            msgs = "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors(include_input=False))
            errors.append(f"{cid}: {msgs}")
    return errors


# --- 실행 ---


class _MeteredClient:
    def __init__(self, inner: LLMClient):
        self.inner = inner
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        self.calls += 1
        result = self.inner.call_tool(system=system, messages=messages, tool=tool)
        self.input_tokens += result.input_tokens
        self.output_tokens += result.output_tokens
        return result


@dataclass
class CaseResult:
    id: str
    text: str
    expected: dict
    status: str | None  # 예외면 None
    actual: list[dict]  # 비교 키 기준 제약(type·hardness·params)
    detail: str | None  # clarify 질문, unsupported 이유
    error: str | None
    retries: int
    latency_s: float
    input_tokens: int
    output_tokens: int
    tp: int
    n_expected: int
    n_actual: int
    exact: bool


def _request(case: dict, ward: dict) -> TranslateRequest:
    return TranslateRequest(
        text=case["text"],
        scope=case["scope"],
        context=TranslateContext(
            nurses=[Nurse(**n) for n in ward["nurses"]],
            period=Period(**ward["period"]),
            holidays=case.get("holidays", ward["holidays"]),
            today=date.fromisoformat(case["today"]),
        ),
        input_version=0,
    )


def run_case(case: dict, client: LLMClient, ward: dict) -> CaseResult:
    metered = _MeteredClient(client)
    expected = case["expected"]
    exp_constraints = expected.get("constraints", [])
    status, actual, detail, error = None, [], None, None
    start = time.perf_counter()
    try:
        res = translate(_request(case, ward), metered)
        status = res.status
        if status == "ok":
            actual = res.constraints
        else:
            detail = res.question if status == "clarify" else res.reason
    except LLMConfigError:
        raise
    except Exception as e:  # noqa: BLE001 — 케이스 하나의 실패로 전체를 멈추지 않는다
        error = f"{type(e).__name__}: {e}"
    latency = time.perf_counter() - start

    tp, n_exp, n_act = score_constraints(exp_constraints, actual)
    exact = status == expected["status"] and tp == n_exp == n_act
    return CaseResult(
        id=case["id"],
        text=case["text"],
        expected=expected,
        status=status,
        actual=[json.loads(_key(c)) for c in actual],
        detail=detail,
        error=error,
        retries=max(metered.calls - 1, 0),
        latency_s=latency,
        input_tokens=metered.input_tokens,
        output_tokens=metered.output_tokens,
        tp=tp,
        n_expected=n_exp,
        n_actual=n_act,
        exact=exact,
    )


def run_cases(cases: list[dict], client: LLMClient, progress: bool = False) -> list[CaseResult]:
    ward = _ward()
    results = []
    for i, case in enumerate(cases, 1):
        r = run_case(case, client, ward)
        results.append(r)
        if progress:
            mark = "OK" if r.exact else "FAIL"
            print(f"[{i}/{len(cases)}] {r.id} {mark} ({r.latency_s:.1f}s)", file=sys.stderr)
    return results


# --- 집계 ---


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def _p95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(math.ceil(0.95 * len(ordered)) - 1, 0)]


def _status_accuracy(results: list[CaseResult], status: str) -> float | None:
    subset = [r for r in results if r.expected["status"] == status]
    return _ratio(sum(r.status == status for r in subset), len(subset))


def aggregate(results: list[CaseResult]) -> dict[str, Any]:
    n = len(results)
    tp = sum(r.tp for r in results)
    precision = _ratio(tp, sum(r.n_actual for r in results))
    recall = _ratio(tp, sum(r.n_expected for r in results))
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else 0.0
    latencies = [r.latency_s for r in results]
    return {
        "cases": n,
        "schema_valid_rate": _ratio(sum(r.error is None for r in results), n),
        "status_accuracy": _ratio(sum(r.status == r.expected["status"] for r in results), n),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "exact_match_rate": _ratio(sum(r.exact for r in results), n),
        "clarify_accuracy": _status_accuracy(results, "clarify"),
        "unsupported_accuracy": _status_accuracy(results, "unsupported"),
        "avg_retries": _ratio(sum(r.retries for r in results), n),
        "latency_avg_s": sum(latencies) / n if n else None,
        "latency_p95_s": _p95(latencies) if n else None,
        "input_tokens": sum(r.input_tokens for r in results),
        "output_tokens": sum(r.output_tokens for r in results),
    }


# --- 결과 파일 ---

_LABELS = [
    ("cases", "케이스 수", "{}"),
    ("schema_valid_rate", "스키마 유효율", "{:.1%}"),
    ("status_accuracy", "status 정확도", "{:.1%}"),
    ("precision", "제약 precision", "{:.1%}"),
    ("recall", "제약 recall", "{:.1%}"),
    ("f1", "제약 F1", "{:.1%}"),
    ("exact_match_rate", "케이스 완전 일치율", "{:.1%}"),
    ("clarify_accuracy", "clarify 정확도", "{:.1%}"),
    ("unsupported_accuracy", "unsupported 정확도", "{:.1%}"),
    ("avg_retries", "평균 재시도 횟수", "{:.2f}"),
    ("latency_avg_s", "평균 지연(초)", "{:.2f}"),
    ("latency_p95_s", "p95 지연(초)", "{:.2f}"),
    ("input_tokens", "입력 토큰 합계", "{:,}"),
    ("output_tokens", "출력 토큰 합계", "{:,}"),
]


def _cell(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text.replace("|", "\\|").replace("\n", " ")


def write_results(path: Path, metrics: dict, results: list[CaseResult], model: str) -> None:
    lines = [
        "# 번역 eval 결과",
        "",
        f"- 실행 시각: {datetime.now().astimezone().isoformat(timespec='seconds')}",
        f"- 모델: `{model}`",
        f"- 데이터셋: `eval/dataset.jsonl` ({metrics['cases']}개)",
        "",
        "## 지표",
        "",
        "| 지표 | 값 |",
        "|---|---|",
    ]
    for key, label, fmt in _LABELS:
        value = metrics[key]
        lines.append(f"| {label} | {'-' if value is None else fmt.format(value)} |")

    failures = [r for r in results if not r.exact]
    lines += ["", f"## 실패 케이스 ({len(failures)}개)", ""]
    if failures:
        lines += ["| id | 입력 | 기대값 | 실제값 |", "|---|---|---|---|"]
        for r in failures:
            expected = r.expected["status"]
            if expected == "ok":
                expected = f"ok {_cell(r.expected['constraints'])}"
            if r.error:
                actual = f"오류 {r.error}"
            elif r.status == "ok":
                actual = f"ok {_cell(r.actual)}"
            else:
                actual = f"{r.status}: {r.detail}"
            lines.append(f"| {r.id} | {_cell(r.text)} | {_cell(expected)} | {_cell(actual)} |")
    else:
        lines.append("없음")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# --- CLI ---


def _select(cases: list[dict], ids: str | None, limit: int | None) -> list[dict]:
    if ids:
        wanted = {i.strip() for i in ids.split(",") if i.strip()}
        cases = [c for c in cases if c["id"] in wanted]
    return cases[:limit] if limit is not None else cases


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LLM 번역 정확도 eval")
    parser.add_argument("--dry-run", action="store_true", help="API를 호출하지 않고 데이터셋만 검증")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--ids", help="쉼표로 구분한 케이스 id")
    args = parser.parse_args(argv)

    cases = load_dataset(DATASET)
    errors = validate_dataset(cases)
    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        return 1
    cases = _select(cases, args.ids, args.limit)

    if args.dry_run:
        counts = Counter(c["expected"]["status"] for c in cases)
        print(f"dry-run 통과: {len(cases)}개 케이스 {dict(counts)}")
        return 0

    load_local_env(str(ROOT / ".env.local"))
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY가 없습니다. .env.local 또는 환경 변수에 설정하세요.", file=sys.stderr)
        return 2
    try:
        client = AnthropicClient()
        results = run_cases(cases, client, progress=True)
    except LLMConfigError as e:
        print(f"설정 오류: {e}", file=sys.stderr)
        return 2

    metrics = aggregate(results)
    write_results(RESULTS, metrics, results, model=client.model)
    print(f"결과: {RESULTS.relative_to(ROOT)} (완전 일치 {metrics['exact_match_rate']:.1%}, F1 {metrics['f1']:.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
