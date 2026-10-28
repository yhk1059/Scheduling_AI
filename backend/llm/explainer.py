"""충돌 설명과 완화 제안 후보. 제안 검증(재풀이)은 routes에서 한다(ADR-004, ADR-006)."""

import json
from typing import Any

from pydantic import TypeAdapter, ValidationError

from backend.domain.constants import LLM_MAX_RETRIES, MAX_PROPOSALS
from backend.domain.models import (
    Conflict,
    ConstraintChange,
    ConstraintSpec,
    RelaxationProposal,
    ScheduleRequest,
    _constraint_refs,
)
from backend.llm.client import LLMClient, LLMInvalidOutputError, ToolCallResult
from backend.llm.prompts import EXPLAIN_SYSTEM, EXPLAIN_TOOL, ExplainerOutput, ProposalDraft
from backend.llm.pseudonym import pseudonymize, restore

_spec_adapter = TypeAdapter(ConstraintSpec)
_EMPTY_FALLBACK = "원인을 특정하지 못했습니다. 규칙을 하나씩 꺼서 확인해 주세요."


def fallback_explanation(request: ScheduleRequest, conflicts: list[Conflict]) -> str:
    if not conflicts:
        return _EMPTY_FALLBACK
    quoted = ", ".join(f"“{c.source_text or c.type}”" for c in conflicts)
    return f"다음 규칙들이 동시에 지켜질 수 없습니다: {quoted}."


def _context_message(request: ScheduleRequest, specs: dict[str, Any], conflicts: list[Conflict]) -> str:
    period, nurses = request.period, request.nurses
    days = period.days
    weekends = sorted(
        {d for d in range(1, days + 1) if period.weekday(d) >= 5} | set(request.holidays)
    )
    context = {
        "nurse_count": len(nurses),
        "night_only_count": sum(n.night_only for n in nurses),
        "period": {"start": period.start_date.isoformat(), "end": period.date_of(days).isoformat(), "length": days},
        "days": [{"day": d, "date": period.date_of(d).isoformat()} for d in range(1, days + 1)],
        "weekend_and_holiday_days": weekends,
    }
    items = []
    for c in conflicts:
        spec = specs.get(c.constraint_id)
        items.append(
            {
                "id": c.constraint_id,
                "type": c.type,
                "hardness": spec.hardness if spec else None,
                "params": spec.params.model_dump() if spec else None,
                "source_text": pseudonymize(c.source_text, nurses),
            }
        )
    return (
        f"<context>\n{json.dumps(context, ensure_ascii=False)}\n</context>\n"
        f"<conflicts>\n{json.dumps(items, ensure_ascii=False)}\n</conflicts>"
    )


def _parse(result: ToolCallResult) -> ExplainerOutput:
    if result.stop_reason == "max_tokens":
        raise ValueError("응답이 max_tokens에서 잘렸습니다. 더 짧게 다시 제출하세요.")
    if result.tool_input is None:
        raise ValueError("submit_explanation tool 호출이 없습니다.")
    try:
        return ExplainerOutput.model_validate(result.tool_input)
    except ValidationError as e:
        raise ValueError(
            "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors(include_input=False))
        ) from e


def _check_change(change: ConstraintChange, request: ScheduleRequest, spec: Any) -> ConstraintChange | None:
    """유효하면 params를 템플릿 전체 값으로 채운 change, 아니면 None."""
    if change.action == "disable":
        return ConstraintChange(action="disable", constraint_id=change.constraint_id)
    if change.params is None and change.hardness is None:
        return None
    data = spec.model_dump()
    if change.params is not None:
        data["params"] = {**data["params"], **change.params}
    if change.hardness is not None:
        data["hardness"] = change.hardness
    try:
        updated = _spec_adapter.validate_python(data)
    except ValidationError:
        return None
    nurse_id, cdays = _constraint_refs(updated)
    if nurse_id is not None and nurse_id not in {n.id for n in request.nurses}:
        return None
    if any(not 1 <= d <= request.period.days for d in cdays):
        return None
    return ConstraintChange(
        action="update",
        constraint_id=change.constraint_id,
        params=updated.params.model_dump() if change.params is not None else None,
        hardness=change.hardness,
    )


def _to_proposal(
    draft: ProposalDraft, request: ScheduleRequest, specs: dict[str, Any], conflict_ids: set[str]
) -> RelaxationProposal | None:
    changes = []
    for change in draft.changes:
        if change.constraint_id not in conflict_ids or change.constraint_id not in specs:
            return None
        checked = _check_change(change, request, specs[change.constraint_id])
        if checked is None:
            return None
        changes.append(checked)
    nurses = request.nurses
    return RelaxationProposal(
        title=restore(draft.title, nurses), description=restore(draft.description, nurses), changes=changes
    )


def explain(
    request: ScheduleRequest, conflicts: list[Conflict], client: LLMClient
) -> tuple[str, list[RelaxationProposal]]:
    specs = {c.id: c for c in request.constraints}
    messages: list[dict] = [{"role": "user", "content": _context_message(request, specs, conflicts)}]
    output: ExplainerOutput | None = None
    error: ValueError | None = None
    for _ in range(1 + LLM_MAX_RETRIES):
        result = client.call_tool(system=EXPLAIN_SYSTEM, messages=messages, tool=EXPLAIN_TOOL)
        try:
            output = _parse(result)
            break
        except ValueError as e:
            error = e
        previous = json.dumps(result.tool_input, ensure_ascii=False) if result.tool_input is not None else "(tool 호출 없음)"
        messages.append({"role": "assistant", "content": f"이전 제출: {previous}"})
        messages.append(
            {"role": "user", "content": f"이전 제출에 오류가 있습니다: {error}\n오류를 고쳐 submit_explanation을 다시 호출하세요."}
        )
    if output is None:
        raise LLMInvalidOutputError(f"재시도 {LLM_MAX_RETRIES}회 후에도 출력이 유효하지 않습니다: {error}")

    conflict_ids = {c.constraint_id for c in conflicts}
    proposals = [p for d in output.proposals if (p := _to_proposal(d, request, specs, conflict_ids)) is not None]
    return restore(output.text, request.nurses), proposals[:MAX_PROPOSALS]
