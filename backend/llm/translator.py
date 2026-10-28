"""자연어 → 제약 스펙 번역. 결과는 검증을 통과한 제안이다(ADR-004)."""

import calendar
import json
import uuid
from typing import Any

from pydantic import TypeAdapter, ValidationError

from backend.domain.constants import DEFAULT_SOFT_WEIGHTS, DEFAULT_WEIGHT, LLM_MAX_RETRIES
from backend.domain.models import (
    ConstraintSpec,
    TranslateClarify,
    TranslateOk,
    TranslateRequest,
    TranslateUnsupported,
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
        "nurses": [{"id": n.id, "years": n.years, "night_only": n.night_only} for n in ctx.nurses],
    }
    return f"<context>\n{json.dumps(context, ensure_ascii=False)}\n</context>\n<input>\n{text}\n</input>"


def _format_errors(e: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors(include_input=False))


def _weight(spec: Any) -> int:
    if spec.hardness == "soft":
        return DEFAULT_SOFT_WEIGHTS.get(spec.type, DEFAULT_WEIGHT)
    return 1


def _to_specs(output: TranslatorOutput, req: TranslateRequest) -> list:
    ids = {n.id for n in req.context.nurses}
    days = req.context.period.days
    specs, errors, questions = [], [], []
    for i, draft in enumerate(output.constraints):
        data = draft.model_dump()
        if data["hardness"] is None:
            del data["hardness"]
        spec = _spec_adapter.validate_python(
            {**data, "id": uuid.uuid4().hex[:8], "scope": req.scope, "enabled": True}
        )
        spec = spec.model_copy(update={"weight": _weight(spec)})
        nurse_id, cdays = _constraint_refs(spec)
        if nurse_id is not None and nurse_id not in ids:
            errors.append(f"constraints.{i}.params.nurse_id: 명단에 없는 id {nurse_id}")
            questions.append(f"명단에 없는 간호사({nurse_id})가 포함되어 있습니다. 이름을 확인해 주세요.")
        out = [d for d in cdays if not 1 <= d <= days]
        if out:
            errors.append(f"constraints.{i}.params: 1..{days} 범위 밖 날짜 {out}")
            questions.append(f"{out}일은 이번 기간(1~{days}일) 밖입니다. 날짜를 확인해 주세요.")
        specs.append(spec)
    if errors:
        raise _OutputError("; ".join(errors), clarify=" ".join(questions))
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
    if not output.constraints:
        return TranslateClarify(status="clarify", input_version=v, question=_EMPTY_QUESTION)

    specs = _to_specs(output, req)
    for spec in specs:
        spec.source_text = restore(spec.source_text, nurses)
    return TranslateOk(status="ok", input_version=v, constraints=specs)


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
