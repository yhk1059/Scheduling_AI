"""LLM 번역 정확도 eval.

uv run python eval/run.py [--dry-run] [--gate] [--limit N] [--ids r01,r02]

--dry-run은 API를 호출하지 않고 데이터셋만 검증한다. 실행 모드는 결과를 eval/results.md에 쓴다.
--gate는 set별 완전 일치율과 스키마 유효율이 목표(GATE_*) 미만이면 exit 1.

채점은 의미 기준이다(설계 §7). 고정 시드 무작위 근무표와, 기대 블록의 대상 칸을 뒤집은 근무표에서
stats.violations의 위반 집합이 모두 같고 hardness(soft면 priority도)가 같으면 같은 규칙으로 본다.
"""

import argparse
import json
import math
import os
import random
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import BaseModel, TypeAdapter, ValidationError  # noqa: E402

from backend.domain.constants import CARRY_OVER_DAYS, NIGHT_ONLY_TAG, OFF_CODE  # noqa: E402
from backend.domain.models import (  # noqa: E402
    DEFAULT_CONFIG,
    ConstraintSpec,
    Nurse,
    People,
    Period,
    ScheduleRequest,
    ShiftChange,
    Shifts,
    TranslateContext,
    TranslateRequest,
    WardConfig,
    rule_counts,
)
from backend.domain.convert import block_to_rules  # noqa: E402
from backend.env import load_local_env  # noqa: E402
from backend.llm.client import (  # noqa: E402
    AnthropicClient,
    LLMClient,
    LLMConfigError,
    ToolCallResult,
)
from backend.llm.translator import translate  # noqa: E402
from backend.solver import select  # noqa: E402
from backend.solver.stats import violations  # noqa: E402

DATASET = ROOT / "eval" / "dataset.jsonl"
RESULTS = ROOT / "eval" / "results.md"
SAMPLE = ROOT / "lib" / "samples" / "ward-15.json"
STATUSES = ("ok", "clarify", "unsupported")
SCOPES = ("ward", "period")
SETS = ("legacy", "new")
EXPECTED_TYPES = ("count", "sequence", "balance", "fixed_assignment")

# 게이트 목표(사용자 결정 ★9). 낮추지 않는다
GATE_EXACT = {"legacy": 0.95, "new": 0.85}
GATE_SCHEMA_VALID = 1.0

# 의미 판정: 무작위 근무표 수, 기대 블록마다 대상 칸을 뒤집은 근무표 수, 시드
K_RANDOM = 50
FLIPS_PER_BLOCK = 4
SEED = 20261030

# eval 병동 = 샘플 병동 + 태그(책임 2명, 신규 3명). 샘플의 나이트전담 태그는 그대로 둔다
EVAL_TAGS = {"n01": ["책임"], "n06": ["책임"], "n11": ["신규"], "n12": ["신규"], "n13": ["신규"]}

_spec_adapter = TypeAdapter(ConstraintSpec)
_FILLER = {"id": "eval", "scope": "ward", "source_text": "eval", "weight": 1}
_DUMP_EXCLUDE = {"id", "scope", "source_text", "enabled", "weight"}


def _ward() -> dict:
    ward = json.loads(SAMPLE.read_text(encoding="utf-8"))
    nurses = []
    for n in ward["nurses"]:
        nurses.append(n | {"tags": EVAL_TAGS.get(n["id"], []) + n["tags"]})
    return {**ward, "nurses": nurses}


def _known_tags(ward: dict) -> set[str]:
    return {t for n in ward["nurses"] for t in n["tags"]} | {NIGHT_ONLY_TAG}


def load_dataset(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


# --- 근무 형태 ---


def _apply_changes(config: WardConfig, changes: list, only_new: bool = False) -> tuple[WardConfig, list[str]]:
    """설정 변경을 적용한다. only_new면 아직 없는 코드의 add만(실제 출력의 코드를 판정 근무표에 넣을 때)."""
    shifts = {s.code: s for s in config.shifts}
    errors = []
    for i, ch in enumerate(changes):
        ch = ch if isinstance(ch, ShiftChange) else ShiftChange.model_validate(ch)
        code = ch.shift.code
        if only_new:
            if ch.action == "add" and code not in shifts:
                shifts[code] = ch.shift
            continue
        if code == OFF_CODE:
            errors.append(f"config_changes.{i}: {OFF_CODE}는 바꿀 수 없음")
        elif (ch.action == "add") == (code in shifts):
            errors.append(f"config_changes.{i}: {ch.action} {code}")
        else:
            shifts[code] = ch.shift
    return WardConfig(shifts=list(shifts.values())), errors


def judge_config(expected_changes: list, actual_changes: list = ()) -> WardConfig:
    """판정 근무표의 근무 형태: 기본 + 기대 설정 변경 + 실제 출력이 새로 더한 코드."""
    config, _ = _apply_changes(DEFAULT_CONFIG, expected_changes)
    try:
        config, _ = _apply_changes(config, list(actual_changes), only_new=True)
    except ValidationError:  # 실제 출력이 근무 형태를 깨면 기대 근무 형태로만 판정한다(블록은 불일치가 된다)
        pass
    return config


# --- 채점 ---


def _period(case: dict | None, ward: dict) -> tuple[Period, list[int]]:
    case = case or {}
    return Period(**case.get("period", ward["period"])), case.get("holidays", ward["holidays"])


def _spec(c: dict | BaseModel) -> Any:
    """기대·실제 제약을 스펙으로."""
    return c if isinstance(c, BaseModel) else _spec_adapter.validate_python({**_FILLER, **c})


def _dump(spec: Any) -> dict:
    return _spec_adapter.dump_python(spec, mode="json", exclude=_DUMP_EXCLUDE, exclude_defaults=True)


def _with_cells(assignments: dict[str, list[str]], cells: list[tuple[str, int]], codes: list[str], rng: random.Random, mode: str) -> dict:
    out = {nid: list(row) for nid, row in assignments.items()}
    for nid, d in cells:
        if mode == "half" and rng.random() < 0.5:
            continue
        out[nid][d - 1] = rng.choice(codes)
    return out


def _target(request: ScheduleRequest, spec: Any) -> tuple[list[tuple[str, int]], Shifts]:
    """블록의 대상 칸(기간 안)과 그 칸을 세는 근무 셀렉터."""
    p = spec.params
    if spec.type == "fixed_assignment":
        return [(p.nurse_id, p.day)], Shifts(in_=[p.shift])
    if spec.type == "count":
        cells = [cell for _, _, cs in select.count_groups(request, p) for cell in cs if cell[1] >= 1]
        return cells, p.shifts
    if spec.type == "balance":
        return [(n, d) for n, ds in select.balance_cells(request, p).items() for d in ds], p.shifts
    sel = p.run or p.after or p.forbid[0][0]
    return [(n, d) for n in select.people(request, p.people) for d in range(1, request.period.days + 1)], sel


def judge_schedules(case: dict | None, config: WardConfig, expected: list) -> list[tuple[ScheduleRequest, dict]]:
    """판정 근무표: 무작위 K_RANDOM개(이월 포함) + 기대 블록마다 대상 칸을 뒤집은 FLIPS_PER_BLOCK개. 고정 시드."""
    ward = _ward()
    period, holidays = _period(case, ward)
    rng = random.Random(SEED)
    codes = [s.code for s in config.shifts if s.active]
    ids = [n["id"] for n in ward["nurses"]]
    base = {"config": config, "nurses": ward["nurses"], "period": period, "holidays": holidays, "input_version": 0}

    out = []
    for _ in range(K_RANDOM):
        carry = [{"nurse_id": nid, "shifts": rng.choices(codes, k=CARRY_OVER_DAYS)} for nid in ids]
        assignments = {nid: rng.choices(codes, k=period.days) for nid in ids}
        out.append((ScheduleRequest.model_validate({**base, "carry_over": carry}), assignments))

    for i, spec in enumerate(expected):
        request, assignments = out[i % K_RANDOM]
        cells, sel = _target(request, spec)
        match = [c for c in codes if select.matches(config, c, sel)]
        other = [c for c in codes if c not in match]
        for mode, pool in (("all", match), ("all", other), ("half", match), ("half", other))[:FLIPS_PER_BLOCK]:
            if cells and pool:
                out.append((request, _with_cells(assignments, cells, pool, rng, mode)))
    return out


def _as_rules(specs: list) -> list:
    """블록은 식 규칙으로 바꿔 같은 단위(규칙)로 비교한다. 바꿀 수 없는 블록은 그대로 둔다."""
    out = []
    for s in specs:
        try:
            out += block_to_rules(s)
        except ValueError:
            out.append(s)
    return out


def _scope_people(request: ScheduleRequest, spec: Any) -> frozenset:
    """사람 없는 위반의 사람 묶음: 블록·고르게는 고른 사람, 사람이 묶인 범위는 그 사람들, 날·기간 범위는 세는 사람(who)."""
    if spec.type != "rule":
        return frozenset(select.people(request, spec.params.people))
    body = spec.body
    if body.kind == "balance":
        return frozenset(select.people(request, body.people))
    if body.for_each.per not in ("day", "period"):
        return frozenset(select.people(request, body.for_each.people))
    return frozenset(n for c in rule_counts(body) for n in select.people(request, c.who or People()))


def _signature(spec: Any, schedules: list[tuple[ScheduleRequest, dict]]) -> Any:
    """근무표마다 위반 집합 {(사람 묶음, 날)}. 사람 없는 위반(날마다·고르게)은 규칙이 고른 사람 전체로 본다."""
    try:
        sig = []
        for request, assignments in schedules:
            if spec.type == "fixed_assignment":
                everyone = frozenset({spec.params.nurse_id})
            else:
                everyone = _scope_people(request, spec)
            found = violations(request, assignments, spec)
            sig.append(frozenset((frozenset({v.nurse_id}) if v.nurse_id else everyone, v.day) for v in found))
        return tuple(sig)
    except (KeyError, StopIteration, ValueError):  # 판정 근무 형태에 없는 코드 등: 어떤 것과도 같지 않다
        return object()


def _judge_key(spec: Any, schedules: list) -> tuple:
    priority = getattr(spec, "priority", None) if spec.hardness == "soft" else None
    return (_signature(spec, schedules), spec.hardness, priority)


def score_constraints(expected: list, actual: list, case: dict | None = None, config: WardConfig | None = None) -> tuple[int, int, int]:
    """의미 기준 일대일 매칭(식 규칙 단위). (일치 수, 기대 수, 실제 수)."""
    config = config or judge_config([])
    exp = [_spec(c) for c in expected]
    schedules = judge_schedules(case, config, exp)
    exp_rules, act_rules = _as_rules(exp), _as_rules([_spec(c) for c in actual])
    e = Counter(_judge_key(s, schedules) for s in exp_rules)
    a = Counter(_judge_key(s, schedules) for s in act_rules)
    return sum((e & a).values()), len(exp_rules), len(act_rules)


def _change_key(ch: dict | ShiftChange) -> tuple:
    shift = (ch if isinstance(ch, ShiftChange) else ShiftChange.model_validate(ch)).shift
    return (shift.code, shift.hours, tuple(sorted(shift.parts)))


def score_config_changes(expected: list, actual: list) -> tuple[int, int, int]:
    """근무 형태 변경: 코드·hours·parts가 같으면 일치."""
    e, a = Counter(map(_change_key, expected)), Counter(map(_change_key, actual))
    return sum((e & a).values()), len(expected), len(actual)


# --- 데이터셋 검증 ---


def validate_dataset(cases: list[dict]) -> list[str]:
    ward = _ward()
    known_tags = _known_tags(ward)
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
        changes = expected.get("config_changes", [])
        if c.get("set") not in SETS:
            errors.append(f"{cid}: set 값 {c.get('set')!r}")
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
        if status == "ok" and not constraints and not changes:
            errors.append(f"{cid}: ok인데 constraints와 config_changes가 비었음")
        if status in ("clarify", "unsupported") and (constraints or changes):
            errors.append(f"{cid}: {status}인데 constraints나 config_changes가 있음")
        bad_types = [x.get("type") for x in constraints if x.get("type") not in EXPECTED_TYPES]
        if bad_types:
            errors.append(f"{cid}: 블록이 아닌 type {bad_types}")
            continue

        try:
            config, change_errors = _apply_changes(DEFAULT_CONFIG, changes)
            errors += [f"{cid}: {e}" for e in change_errors]
            specs = [{**_FILLER, **x, "id": f"{cid}-{i}", "scope": c.get("scope")} for i, x in enumerate(constraints)]
            req = ScheduleRequest.model_validate(
                {
                    "config": config,
                    "nurses": ward["nurses"],
                    "period": c.get("period", ward["period"]),
                    "holidays": c.get("holidays", ward["holidays"]),
                    "constraints": specs,
                    "input_version": 0,
                }
            )
        except ValidationError as e:
            msgs = "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors(include_input=False))
            errors.append(f"{cid}: {msgs}")
            continue
        for spec in req.constraints:
            people = getattr(spec.params, "people", None)
            tags = set(people.tags or []) | set(people.exclude_tags) if people else set()
            if tags - known_tags:
                errors.append(f"{cid}: eval 병동에 없는 태그 {sorted(tags - known_tags)}")
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
    actual: list[dict]  # 블록(id·scope·source_text·enabled·weight 제외)
    detail: str | None  # clarify 질문, unsupported 이유
    error: str | None
    retries: int
    latency_s: float
    input_tokens: int
    output_tokens: int
    tp: int  # 제약 + 근무 형태 변경
    n_expected: int
    n_actual: int
    exact: bool
    set: str = "legacy"
    actual_changes: list[dict] = field(default_factory=list)  # 실제 근무 형태 변경(ShiftDef)


def _request(case: dict, ward: dict) -> TranslateRequest:
    return TranslateRequest(
        text=case["text"],
        scope=case["scope"],
        context=TranslateContext(
            nurses=[Nurse(**n) for n in ward["nurses"]],
            period=Period(**case.get("period", ward["period"])),
            holidays=case.get("holidays", ward["holidays"]),
            today=date.fromisoformat(case["today"]),
        ),
        input_version=0,
    )


def run_case(case: dict, client: LLMClient, ward: dict) -> CaseResult:
    metered = _MeteredClient(client)
    expected = case["expected"]
    exp_constraints = expected.get("constraints", [])
    exp_changes = expected.get("config_changes", [])
    status, actual, changes, detail, error = None, [], [], None, None
    start = time.perf_counter()
    try:
        res = translate(_request(case, ward), metered)
        status = res.status
        if status == "ok":
            actual, changes = res.constraints, res.config_changes
        else:
            detail = res.question if status == "clarify" else res.reason
    except LLMConfigError:
        raise
    except Exception as e:  # noqa: BLE001 — 케이스 하나의 실패로 전체를 멈추지 않는다
        error = f"{type(e).__name__}: {e}"
    latency = time.perf_counter() - start

    config = judge_config(exp_changes, changes)
    tp, n_exp, n_act = score_constraints(exp_constraints, actual, case, config)
    ctp, cn_exp, cn_act = score_config_changes(exp_changes, changes)
    tp, n_exp, n_act = tp + ctp, n_exp + cn_exp, n_act + cn_act
    exact = status == expected["status"] and tp == n_exp == n_act
    return CaseResult(
        id=case["id"],
        text=case["text"],
        expected=expected,
        status=status,
        actual=[_dump(c) for c in actual],
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
        set=case.get("set", "legacy"),
        actual_changes=[ch.shift.model_dump(mode="json") for ch in changes],
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


def aggregate_by_set(results: list[CaseResult]) -> dict[str, dict[str, Any]]:
    return {s: aggregate([r for r in results if r.set == s]) for s in SETS if any(r.set == s for r in results)}


def gate_failures(metrics: dict, by_set: dict[str, dict]) -> list[str]:
    """목표 미달 항목. 비어 있으면 통과."""
    out = []
    if (metrics["schema_valid_rate"] or 0) < GATE_SCHEMA_VALID:
        out.append(f"스키마 유효율 {metrics['schema_valid_rate']:.1%} < {GATE_SCHEMA_VALID:.0%}")
    for s, target in GATE_EXACT.items():
        rate = by_set.get(s, {}).get("exact_match_rate")
        if rate is None or rate < target:
            out.append(f"{s} 완전 일치율 {'-' if rate is None else f'{rate:.1%}'} < {target:.0%}")
    return out


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


def _pct(v: float | None) -> str:
    return "-" if v is None else f"{v:.1%}"


def write_results(path: Path, metrics: dict, results: list[CaseResult], model: str, by_set: dict | None = None) -> None:
    by_set = by_set if by_set is not None else aggregate_by_set(results)
    lines = [
        "# 번역 eval 결과",
        "",
        f"- 실행 시각: {datetime.now().astimezone().isoformat(timespec='seconds')}",
        f"- 모델: `{model}`",
        f"- 데이터셋: `eval/dataset.jsonl` ({metrics['cases']}개)",
        f"- 판정: 의미 기준(무작위 근무표 {K_RANDOM}개 + 기대 블록마다 대상 칸을 뒤집은 근무표 {FLIPS_PER_BLOCK}개, 시드 {SEED})",
        "",
        "## set별 지표",
        "",
        "| set | 케이스 | 완전 일치율 | 목표 | status 정확도 | 제약 F1 | 스키마 유효율 |",
        "|---|---|---|---|---|---|---|",
    ]
    for s, m in by_set.items():
        lines.append(
            f"| {s} | {m['cases']} | {_pct(m['exact_match_rate'])} | ≥ {GATE_EXACT[s]:.0%} | {_pct(m['status_accuracy'])} "
            f"| {_pct(m['f1'])} | {_pct(m['schema_valid_rate'])} |"
        )
    lines += ["", "## 전체 지표", "", "| 지표 | 값 |", "|---|---|"]
    for key, label, fmt in _LABELS:
        value = metrics[key]
        lines.append(f"| {label} | {'-' if value is None else fmt.format(value)} |")

    failures = [r for r in results if not r.exact]
    lines += ["", f"## 실패 케이스 ({len(failures)}개)", ""]
    if failures:
        lines += ["| id | set | 입력 | 기대값 | 실제값 |", "|---|---|---|---|---|"]
        for r in failures:
            expected = r.expected["status"]
            if expected == "ok":
                expected = f"ok {_cell(r.expected.get('constraints', []))}"
                if r.expected.get("config_changes"):
                    expected += f" 설정 {_cell(r.expected['config_changes'])}"
            if r.error:
                actual = f"오류 {r.error}"
            elif r.status == "ok":
                actual = f"ok {_cell(r.actual)}"
                if r.actual_changes:
                    actual += f" 설정 {_cell(r.actual_changes)}"
            else:
                actual = f"{r.status}: {r.detail}"
            lines.append(f"| {r.id} | {r.set} | {_cell(r.text)} | {_cell(expected)} | {_cell(actual)} |")
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
    parser.add_argument("--gate", action="store_true", help="목표(GATE_*) 미만이면 exit 1")
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
        statuses = Counter(c["expected"]["status"] for c in cases)
        sets = Counter(c["set"] for c in cases)
        print(f"dry-run 통과: {len(cases)}개 케이스 {dict(sets)} {dict(statuses)}")
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
    by_set = aggregate_by_set(results)
    write_results(RESULTS, metrics, results, model=client.model, by_set=by_set)
    rates = ", ".join(f"{s} {_pct(m['exact_match_rate'])}" for s, m in by_set.items())
    print(f"결과: {os.path.relpath(RESULTS, ROOT)} (완전 일치 {rates}, 스키마 유효율 {_pct(metrics['schema_valid_rate'])})")
    if args.gate:
        failures = gate_failures(metrics, by_set)
        for f in failures:
            print(f"게이트 미달: {f}", file=sys.stderr)
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
