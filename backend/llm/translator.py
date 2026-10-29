"""자연어 → 제약 스펙 번역. 결과는 검증을 통과한 제안이다(ADR-004)."""

import calendar
import json
import uuid
from typing import Any

from pydantic import TypeAdapter, ValidationError

from backend.domain.constants import LLM_MAX_RETRIES, NIGHT_ONLY_TAG, OFF_CODE
from backend.domain.models import (
    ConstraintSpec,
    CountParams,
    Days,
    Nurse,
    People,
    ShiftChange,
    TranslateClarify,
    TranslateContext,
    TranslateOk,
    TranslateRequest,
    TranslateUnsupported,
    WardConfig,
    _constraint_codes,
    _constraint_refs,
)
from backend.llm.client import LLMClient, LLMInvalidOutputError, ToolCallResult
from backend.llm.prompts import TRANSLATE_SYSTEM, TRANSLATE_TOOL, TranslatorOutput
from backend.llm.pseudonym import pseudonymize, restore

TranslateResult = TranslateOk | TranslateClarify | TranslateUnsupported

_spec_adapter = TypeAdapter(ConstraintSpec)
_EMPTY_QUESTION = "어떤 규칙인지 조금 더 구체적으로 알려 주세요."


class _OutputError(Exception):
    def __init__(self, message: str, clarify: str | None = None):
        super().__init__(message)
        self.clarify = clarify  # 참조 무결성 실패면 사용자에게 되물을 질문


def _tags(nurse: Nurse) -> list[str]:
    """태그. 옛 night_only는 나이트 전담 태그로 본다(convert_request와 같다)."""
    if nurse.night_only and NIGHT_ONLY_TAG not in nurse.tags:
        return [*nurse.tags, NIGHT_ONLY_TAG]
    return list(nurse.tags)


def _known_tags(ctx: TranslateContext) -> list[str]:
    """병동 태그 목록: 명단의 태그 ∪ 나이트 전담(추천 태그라 늘 있다)."""
    return sorted({t for n in ctx.nurses for t in _tags(n)} | {NIGHT_ONLY_TAG})


def _context_message(req: TranslateRequest, text: str) -> str:
    ctx, period = req.context, req.context.period
    holidays = set(ctx.holidays)
    days = [
        {
            "day": d,
            "date": period.date_of(d).isoformat(),
            "weekday": calendar.day_abbr[period.weekday(d)],
            "weekend": period.weekday(d) >= 5 or d in holidays,
        }
        for d in range(1, period.days + 1)
    ]
    context = {
        "today": ctx.today.isoformat(),
        "today_weekday": calendar.day_name[ctx.today.weekday()],
        "period": {"start": period.start_date.isoformat(), "end": period.date_of(period.days).isoformat(), "length": period.days},
        "days": days,
        "weekend_and_holiday_days": [d["day"] for d in days if d["weekend"]],
        "holidays": sorted(ctx.holidays),
        "config": {"shifts": [s.model_dump(include={"code", "name", "hours", "parts", "active"}) for s in ctx.config.shifts]},
        "nurses": [{"id": n.id, "years": n.years, "tags": _tags(n)} for n in ctx.nurses],
        "known_tags": _known_tags(ctx),
    }
    return f"<context>\n{json.dumps(context, ensure_ascii=False)}\n</context>\n<input>\n{text}\n</input>"


def _format_errors(e: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors(include_input=False))


def _apply_config_changes(changes: list[ShiftChange], config: WardConfig) -> tuple[WardConfig | None, list[str]]:
    """설정 변경을 적용한 근무 형태와 오류. 오류가 있으면 근무 형태는 None."""
    shifts = {s.code: s for s in config.shifts}
    errors = []
    for i, change in enumerate(changes):
        code = change.shift.code
        if change.action == "add" and code in shifts:
            errors.append(f"config_changes.{i}: 이미 있는 근무 코드 {code}를 add했습니다")
        elif change.action == "update" and code not in shifts:
            errors.append(f"config_changes.{i}: 없는 근무 코드 {code}를 update했습니다")
        elif code == OFF_CODE:
            errors.append(f"config_changes.{i}: {OFF_CODE}(휴무)는 바꿀 수 없습니다")
        else:
            shifts[code] = change.shift
    if errors:
        return None, errors
    try:
        return WardConfig(shifts=list(shifts.values())), []
    except ValidationError as e:
        return None, [f"config_changes: {_format_errors(e)}"]


def _people(nurses: list[Nurse], sel: People) -> list[str]:
    """셀렉터가 고른 간호사 id. 규칙은 solver/select.py와 같다(llm은 solver를 import하지 않는다)."""
    out = []
    for n in nurses:
        tags = set(_tags(n))
        if sel.ids is not None and n.id not in sel.ids:
            continue
        if sel.tags is not None and not set(sel.tags) & tags:
            continue
        if set(sel.exclude_tags) & tags:
            continue
        if sel.min_years is not None and n.years < sel.min_years:
            continue
        if sel.max_years is not None and n.years > sel.max_years:
            continue
        out.append(n.id)
    return out


def _days(ctx: TranslateContext, sel: Days) -> list[int]:
    out = []
    for d in range(1, ctx.period.days + 1):
        weekday, holiday = ctx.period.weekday(d), d in ctx.holidays
        weekend = weekday >= 5 or holiday
        if sel.days is not None and d not in sel.days:
            continue
        if (sel.kind == "weekday" and weekend) or (sel.kind == "weekend" and not weekend):
            continue
        if sel.kind == "holiday" and not holiday:
            continue
        if sel.weekdays is not None and weekday not in sel.weekdays:
            continue
        out.append(d)
    return out


def _check_targets(i: int, spec: Any, ctx: TranslateContext) -> tuple[list[str], list[str]]:
    """빈 대상 검사와 싼 모순 검사(설계 §5.2). (오류, 질문)."""
    p = spec.params
    people = _people(ctx.nurses, p.people)
    if not people:
        named = f"{', '.join(p.people.tags)} 태그를 가진 " if p.people.tags else "고른 조건에 맞는 "
        return [f"constraints.{i}.params.people: 고른 사람이 0명"], [
            f"{named}간호사가 없어요. 누구를 말씀하시는 건가요?"
        ]
    if hasattr(p, "days") and not _days(ctx, p.days):
        return [f"constraints.{i}.params.days: 이번 기간에서 고른 날이 0일"], [
            "이번 근무표에는 고른 날짜에 해당하는 날이 없어요. 날짜를 확인해 주세요."
        ]
    if isinstance(p, CountParams) and p.per == "day" and p.measure == "count" and p.min is not None and p.min > len(people):
        return [f"constraints.{i}.params.min: 하루 {p.min:g}명이 필요한데 대상은 {len(people)}명"], [
            f"하루 {p.min:g}명이 필요한데 해당하는 간호사는 {len(people)}명이에요. 인원이나 대상을 확인해 주세요."
        ]
    return [], []


def _to_specs(output: TranslatorOutput, req: TranslateRequest) -> list:
    ctx = req.context
    ids = {n.id for n in ctx.nurses}
    known_tags = set(_known_tags(ctx))
    days = ctx.period.days
    config, errors = _apply_config_changes(output.config_changes, ctx.config)
    questions = ["근무 형태 변경을 이해하지 못했어요. 근무 이름과 시간을 다시 적어 주세요."] if errors else []
    codes = config.codes if config else ctx.config.codes | {c.shift.code for c in output.config_changes}
    specs = []
    for i, draft in enumerate(output.constraints):
        data = {k: v for k, v in draft.model_dump().items() if v is not None or k not in ("hardness", "priority")}
        spec = _spec_adapter.validate_python({**data, "id": uuid.uuid4().hex[:8], "scope": req.scope, "enabled": True})
        specs.append(spec)
        before = len(errors)
        nurse_ids, cdays = _constraint_refs(spec)
        for nurse_id in (n for n in nurse_ids if n not in ids):
            errors.append(f"constraints.{i}.params.people.ids: 명단에 없는 id {nurse_id}")
            questions.append(f"명단에 없는 간호사({nurse_id})가 포함되어 있습니다. 이름을 확인해 주세요.")
        tags = sorted({*(spec.params.people.tags or []), *spec.params.people.exclude_tags} - known_tags)
        if tags:
            errors.append(f"constraints.{i}.params.people: known_tags에 없는 태그 {tags}")
            questions.append(f"명단에 없는 태그({', '.join(tags)})예요. 태그를 확인해 주세요.")
        out = [d for d in cdays if not 1 <= d <= days]
        if out:
            errors.append(f"constraints.{i}.params: 1..{days} 범위 밖 날짜 {out}")
            questions.append(f"{out}일은 이번 기간(1~{days}일) 밖입니다. 날짜를 확인해 주세요.")
        unknown = sorted(set(_constraint_codes(spec)) - codes)
        if unknown:
            errors.append(f"constraints.{i}.params: 근무 형태에 없는 코드 {unknown}. 새 근무면 config_changes로 추가하세요")
            questions.append(f"근무 형태에 없는 근무({', '.join(unknown)})예요. 근무 이름을 확인하거나 근무를 먼저 추가해 주세요.")
        if len(errors) == before:
            target_errors, target_questions = _check_targets(i, spec, ctx)
            errors += target_errors
            questions += target_questions
    if errors:
        raise _OutputError("; ".join(errors), clarify=" ".join(dict.fromkeys(questions)))
    return specs


def _parse(result: ToolCallResult, req: TranslateRequest) -> TranslateResult:
    if result.stop_reason == "max_tokens":
        raise _OutputError("응답이 max_tokens에서 잘렸습니다. 더 짧게 다시 제출하세요.")
    if result.tool_input is None:
        raise _OutputError("submit_constraints tool 호출이 없습니다.")
    try:
        output = TranslatorOutput.model_validate(result.tool_input)
    except ValidationError as e:
        raise _OutputError(_format_errors(e)) from e

    v = req.input_version
    nurses = req.context.nurses
    if output.unsupported_reason:
        return TranslateUnsupported(status="unsupported", input_version=v, reason=restore(output.unsupported_reason, nurses))
    if output.clarification_question:
        return TranslateClarify(status="clarify", input_version=v, question=restore(output.clarification_question, nurses))
    if not output.constraints and not output.config_changes:
        return TranslateClarify(status="clarify", input_version=v, question=_EMPTY_QUESTION)

    specs = _to_specs(output, req)
    for spec in specs:
        spec.source_text = restore(spec.source_text, nurses)
    return TranslateOk(status="ok", input_version=v, constraints=specs, config_changes=output.config_changes)


def translate(req: TranslateRequest, client: LLMClient) -> TranslateResult:
    text = pseudonymize(req.text, req.context.nurses)
    messages: list[dict] = [{"role": "user", "content": _context_message(req, text)}]
    error: _OutputError | None = None
    for _ in range(1 + LLM_MAX_RETRIES):
        result = client.call_tool(system=TRANSLATE_SYSTEM, messages=messages, tool=TRANSLATE_TOOL)
        try:
            return _parse(result, req)
        except _OutputError as e:
            error = e
        previous = json.dumps(result.tool_input, ensure_ascii=False) if result.tool_input is not None else "(tool 호출 없음)"
        messages.append({"role": "assistant", "content": f"이전 제출: {previous}"})
        messages.append(
            {"role": "user", "content": f"이전 제출에 오류가 있습니다: {error}\n오류를 고쳐 submit_constraints를 다시 호출하세요."}
        )

    assert error is not None
    if error.clarify:
        return TranslateClarify(status="clarify", input_version=req.input_version, question=error.clarify)
    raise LLMInvalidOutputError(f"재시도 {LLM_MAX_RETRIES}회 후에도 출력이 유효하지 않습니다: {error}")
