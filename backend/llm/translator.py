"""자연어 → 제약 스펙 번역. 결과는 검증을 통과한 제안이다(ADR-004)."""

import calendar
import json
import uuid
from datetime import date
from typing import Any

from pydantic import ValidationError

from backend.domain.constants import LLM_MAX_RETRIES, OFF_CODE
from backend.domain.models import (
    All,
    Balance,
    Cmp,
    Count,
    Days,
    Employee,
    People,
    Period,
    Require,
    Rule,
    ShiftChange,
    TranslateClarify,
    TranslateContext,
    TranslateOk,
    TranslateRequest,
    TranslateUnsupported,
    ValueRef,
    ShopConfig,
    _constraint_codes,
    _constraint_refs,
    _value_refs,
    rule_counts,
)
from backend.llm.client import LLMClient, LLMInvalidOutputError, ToolCallResult
from backend.llm.prompts import TRANSLATE_SYSTEM, TRANSLATE_TOOL, RuleDraft, TranslatorOutput
from backend.llm.pseudonym import pseudonymize, restore

TranslateResult = TranslateOk | TranslateClarify | TranslateUnsupported

_EMPTY_QUESTION = "어떤 규칙인지 조금 더 구체적으로 알려 주세요."
_EXPR_QUESTION = "규칙을 식으로 세우지 못했어요. 무엇을 몇 번(몇 명) 지켜야 하는지 조금 더 구체적으로 적어 주세요."


class _OutputError(Exception):
    def __init__(self, message: str, clarify: str | None = None):
        super().__init__(message)
        self.clarify = clarify  # 참조 무결성 실패면 사용자에게 되물을 질문


def _known_tags(ctx: TranslateContext) -> list[str]:
    """매장 태그 목록: 명단의 태그."""
    return sorted({t for n in ctx.employees for t in n.tags})


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
        "config": {"shifts": [s.model_dump(include={"code", "name", "hours", "parts", "start", "end", "active"}) for s in ctx.config.shifts]},
        "employees": [{"id": n.id, "tags": n.tags} for n in ctx.employees],
        "known_tags": _known_tags(ctx),
    }
    return f"<context>\n{json.dumps(context, ensure_ascii=False)}\n</context>\n<input>\n{text}\n</input>"


def _md(d: date) -> str:
    return f"{d.month}/{d.day}"


def resolve_dates(data: dict, period: Period) -> dict:
    """날짜 셀렉터의 dates(YYYY-MM-DD)를 기간 안 인덱스 days로 바꾼 사본. 인덱스 계산은 LLM에 맡기지 않는다."""
    index = {period.date_of(d): d for d in range(1, period.days + 1)}
    first, last = period.start_date, period.date_of(period.days)
    errors: list[str] = []
    outside: list[date] = []

    def selector(sel: dict, loc: str) -> dict:
        sel = dict(sel)
        if "days" in sel:
            errors.append(f"{loc}: days(인덱스) 대신 dates에 달력 날짜(YYYY-MM-DD)를 쓰세요")
            return sel
        dates = sel.pop("dates", None)
        if dates is None:
            return sel
        days = set()
        for s in dates:
            try:
                d = date.fromisoformat(s)
            except (TypeError, ValueError):
                errors.append(f"{loc}.dates: 날짜가 아닌 값 {s!r}")
                continue
            if d in index:
                days.add(index[d])
            else:
                errors.append(f"{loc}.dates: 기간({first.isoformat()}~{last.isoformat()}) 밖 날짜 {d.isoformat()}")
                outside.append(d)
        sel["days"] = sorted(days)
        return sel

    def walk(node: Any, loc: str) -> Any:
        if isinstance(node, list):
            return [walk(v, f"{loc}.{i}") for i, v in enumerate(node)]
        if not isinstance(node, dict):
            return node
        return {
            k: selector(v, f"{loc}.{k}".lstrip(".")) if k == "days" and isinstance(v, dict) else walk(v, f"{loc}.{k}".lstrip("."))
            for k, v in node.items()
        }

    out = walk(data, "")
    if errors:
        if outside:
            labels = ", ".join(_md(d) for d in sorted(set(outside)))
            clarify = f"{labels}은 이번 근무표 기간({_md(first)}~{_md(last)}) 밖이에요. 날짜를 확인해 주세요."
        else:
            clarify = "날짜를 이해하지 못했어요. 날짜를 다시 적어 주세요."
        raise _OutputError("; ".join(errors), clarify=clarify)
    return out


def _format_errors(e: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors(include_input=False))


def _apply_config_changes(changes: list[ShiftChange], config: ShopConfig) -> tuple[ShopConfig | None, list[str]]:
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
        return ShopConfig(shifts=list(shifts.values())), []
    except ValidationError as e:
        return None, [f"config_changes: {_format_errors(e)}"]


def _people(employees: list[Employee], sel: People) -> list[str]:
    """셀렉터가 고른 직원 id. 규칙은 solver/select.py와 같다(llm은 solver를 import하지 않는다)."""
    out = []
    for n in employees:
        tags = set(n.tags)
        if sel.ids is not None and n.id not in sel.ids:
            continue
        if sel.tags is not None and not set(sel.tags) & tags:
            continue
        if set(sel.exclude_tags) & tags:
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


def _selectors(rule: Rule) -> tuple[list[tuple[str, People]], list[tuple[str, Days]]]:
    """규칙의 (위치, 사람 셀렉터)와 (위치, 범위 날 셀렉터)."""
    body = rule.body
    if isinstance(body, Balance):
        return [("body.people", body.people)], [("body.days", body.days)]
    people = [("body.for_each.people", body.for_each.people)]
    people += [("body.who", c.who) for c in rule_counts(body) if c.who is not None]
    return people, [("body.for_each.days", body.for_each.days)]


def _expr_errors(i: int, draft: RuleDraft) -> list[str]:
    """값 이름 참조와 offset 위치. Rule 검증과 같은 규칙을 LLM이 고칠 수 있는 문장으로 쓴다."""
    body, errors = draft.body, []
    refs = set(_value_refs(body))
    missing = sorted(refs - set(draft.values))
    if missing:
        errors.append(f"rules.{i}.values: 식이 참조하는 값 {missing}이 values에 없습니다")
    unused = sorted(set(draft.values) - refs)
    if unused:
        errors.append(f"rules.{i}.values: 식에서 쓰지 않는 값 {unused}. values에서 빼세요")
    if isinstance(body, Require) and body.for_each.per not in ("day", "person_day") and any(c.offset for c in rule_counts(body)):
        errors.append(f"rules.{i}.body: offset은 날이 묶인 범위(day, person_day)에서만 씁니다(지금 per {body.for_each.per})")
    return errors


def _then_cmps(body: Require) -> list[Cmp]:
    """반드시 함께 참이어야 하는 then 비교(또는은 한쪽만 지키면 되니 뺀다)."""
    if isinstance(body.then, Cmp):
        return [body.then]
    return list(body.then.all) if isinstance(body.then, All) else []


def _check_targets(i: int, rule: Rule, ctx: TranslateContext) -> tuple[list[str], list[str]]:
    """빈 대상 검사와 싼 모순 검사. (오류, 질문)."""
    people_sels, days_sels = _selectors(rule)
    for loc, sel in people_sels:
        if not _people(ctx.employees, sel):
            named = f"{', '.join(sel.tags)} 직급인 " if sel.tags else "고른 조건에 맞는 "
            return [f"rules.{i}.{loc}: 고른 사람이 0명"], [f"{named}직원이 없어요. 누구를 말씀하시는 건가요?"]
    for loc, sel in days_sels:
        if not _days(ctx, sel):
            return [f"rules.{i}.{loc}: 이번 기간에서 고른 날이 0일"], [
                "이번 근무표에는 고른 날짜에 해당하는 날이 없어요. 날짜를 확인해 주세요."
            ]
    body = rule.body
    if isinstance(body, Require) and body.for_each.per == "day":
        for c in _then_cmps(body):
            left = c.left
            if c.op == "le" or left.measure != "count" or left.offset not in (None, (0, 0)) or isinstance(c.right, Count):
                continue
            need = rule.values[c.right.value].value if isinstance(c.right, ValueRef) else c.right
            people = _people(ctx.employees, left.who or People())
            if need > len(people):
                return [f"rules.{i}.body.then: 하루 {need:g}명이 필요한데 대상은 {len(people)}명"], [
                    f"하루 {need:g}명이 필요한데 해당하는 직원은 {len(people)}명이에요. 인원이나 대상을 확인해 주세요."
                ]
    return [], []


def _to_specs(output: TranslatorOutput, req: TranslateRequest) -> list[Rule]:
    """검증 순서: (Pydantic은 이미 통과) 설정 변경 → 식(값 이름·offset) → 참조 → 빈 대상 → 싼 모순."""
    ctx = req.context
    ids = {n.id for n in ctx.employees}
    known_tags = set(_known_tags(ctx))
    config, errors = _apply_config_changes(output.config_changes, ctx.config)
    questions = ["근무 형태 변경을 이해하지 못했어요. 근무 이름과 시간을 다시 적어 주세요."] if errors else []
    codes = config.codes if config else ctx.config.codes | {c.shift.code for c in output.config_changes}
    specs = []
    for i, draft in enumerate(output.rules):
        expr_errors = _expr_errors(i, draft)
        if not expr_errors:
            data = draft.model_dump(mode="json", exclude_none=True)
            try:
                rule = Rule.model_validate({**data, "type": "rule", "id": uuid.uuid4().hex[:8], "scope": req.scope, "enabled": True})
            except ValidationError as e:
                expr_errors = [f"rules.{i}: {_format_errors(e)}"]
        if expr_errors:
            errors += expr_errors
            questions.append(_EXPR_QUESTION)
            continue
        specs.append(rule)
        before = len(errors)
        employee_ids, _ = _constraint_refs(rule)
        for employee_id in sorted({n for n in employee_ids if n not in ids}):
            errors.append(f"rules.{i}: 명단에 없는 id {employee_id}")
            questions.append(f"명단에 없는 직원({employee_id})이 포함되어 있습니다. 이름을 확인해 주세요.")
        tags = sorted({t for _, sel in _selectors(rule)[0] for t in (*(sel.tags or []), *sel.exclude_tags)} - known_tags)
        if tags:
            errors.append(f"rules.{i}: known_tags에 없는 태그 {tags}")
            questions.append(f"명단에 없는 직급({', '.join(tags)})이에요. 직급을 확인해 주세요.")
        unknown = sorted(set(_constraint_codes(rule)) - codes)
        if unknown:
            errors.append(f"rules.{i}: 근무 형태에 없는 코드 {unknown}. 새 근무면 config_changes로 추가하세요")
            questions.append(f"근무 형태에 없는 근무({', '.join(unknown)})예요. 근무 이름을 확인하거나 근무를 먼저 추가해 주세요.")
        if len(errors) == before:
            target_errors, target_questions = _check_targets(i, rule, ctx)
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
        output = TranslatorOutput.model_validate(resolve_dates(result.tool_input, req.context.period))
    except ValidationError as e:
        raise _OutputError(_format_errors(e)) from e

    v = req.input_version
    employees = req.context.employees
    if output.unsupported_reason:
        return TranslateUnsupported(status="unsupported", input_version=v, reason=restore(output.unsupported_reason, employees))
    if output.clarification_question:
        return TranslateClarify(status="clarify", input_version=v, question=restore(output.clarification_question, employees))
    if not output.rules and not output.config_changes:
        return TranslateClarify(status="clarify", input_version=v, question=_EMPTY_QUESTION)

    specs = _to_specs(output, req)
    for spec in specs:
        spec.source_text = restore(spec.source_text, employees)
    return TranslateOk(status="ok", input_version=v, constraints=specs, config_changes=output.config_changes)


def translate(req: TranslateRequest, client: LLMClient) -> TranslateResult:
    text = pseudonymize(req.text, req.context.employees)
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
