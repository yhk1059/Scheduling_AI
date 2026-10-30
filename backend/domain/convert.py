"""템플릿 12종 → 블록(ADR-018), 블록 → 식 규칙(ADR-019) 변환. 저장 이전과 eval 기대값 재작성에 같은 표를 쓴다. 순수 함수."""

from collections.abc import Sequence
from typing import Any

from pydantic import TypeAdapter

from backend.domain.constants import NIGHT_ONLY_TAG, OFF_CODE, PRIORITY_WEIGHTS
from backend.domain.legacy import LegacyScheduleRequest
from backend.domain.models import (
    BalanceRule,
    ConstraintSpec,
    CountRule,
    Nurse,
    Period,
    Rule,
    ScheduleRequest,
    SequenceRule,
    Shifts,
)

NIGHT_ONLY_RULE_ID = "night-only"
NIGHT_ONLY_SOURCE = "나이트 전담은 나이트와 휴무만"

_spec_adapter = TypeAdapter(ConstraintSpec)
_BLOCK_CLASSES = {"count": CountRule, "sequence": SequenceRule, "balance": BalanceRule}


def _priority(spec: Any, block_type: str) -> str:
    """soft면 weight에 가장 가까운 중요도, hard면 블록 기본값."""
    if spec.hardness == "hard":
        return _BLOCK_CLASSES[block_type].model_fields["priority"].default
    return min(PRIORITY_WEIGHTS, key=lambda k: abs(PRIORITY_WEIGHTS[k] - spec.weight))


def _preference_target_days(params: Any, period: Period | None, holidays: Sequence[int]) -> int:
    if params.days is not None and not params.weekends_only:
        return len(params.days)
    if period is None:
        raise ValueError("희망 근무의 대상 날짜 수를 세려면 기간이 필요합니다")
    days = params.days if params.days is not None else range(1, period.days + 1)
    if params.weekends_only:
        days = [d for d in days if period.weekday(d) >= 5 or d in holidays]
    return len(days)


def _block_params(spec: Any, period: Period | None, holidays: Sequence[int]) -> tuple[str, dict]:
    p = spec.params
    match spec.type:
        case "daily_coverage":
            return "count", {
                "days": {"kind": p.day_kind},
                "shifts": {"in": [p.shift]},
                "per": "day",
                "min": p.min,
                "max": p.max,
            }
        case "forbidden_sequence":
            return "sequence", {"forbid": [[{"in": [p.first]}, {"in": [p.second]}]]}
        case "max_consecutive_work":
            return "sequence", {"run": {"not_in": [OFF_CODE]}, "max_len": p.days}
        case "max_consecutive_nights":
            return "sequence", {"run": {"in": ["N"]}, "max_len": p.days}
        case "min_days_off":
            return "count", {"shifts": {"in": [OFF_CODE]}, "per": "person", "min": p.days}
        case "off_after_night_block":
            return "sequence", {"after": {"in": ["N"]}, "then_off": p.days}
        case "skill_mix":
            return "count", {
                "people": {"min_years": p.min_years},
                "shifts": {"in": [p.shift]},
                "per": "day",
                "min": p.min_count,
            }
        case "leave":
            return "count", {
                "people": {"ids": [p.nurse_id]},
                "days": {"days": p.days},
                "shifts": {"not_in": [OFF_CODE]},
                "per": "person",
                "max": 0,
            }
        case "shift_preference":
            days: dict = {}
            if p.weekends_only:
                days["kind"] = "weekend"
            if p.days is not None:
                days["days"] = p.days
            bound = {"min": _preference_target_days(p, period, holidays)} if p.prefer else {"max": 0}
            return "count", {
                "people": {"ids": [p.nurse_id]},
                "days": days,
                "shifts": {"in": [p.shift]},
                "per": "person",
                **bound,
            }
        case "night_fairness":
            return "balance", {"people": {"exclude_tags": [NIGHT_ONLY_TAG]}, "shifts": {"in": ["N"]}}
        case "weekend_fairness":
            return "balance", {"days": {"kind": "weekend"}, "shifts": {"not_in": [OFF_CODE]}}
    raise ValueError(f"변환할 수 없는 제약 type: {spec.type}")


def legacy_to_block(spec: Any, period: Period | None = None, holidays: Sequence[int] = ()) -> Any:
    """템플릿 제약 하나를 블록으로. 블록과 fixed_assignment는 그대로 돌려준다.

    희망(shift_preference, prefer)은 min = 대상 날짜 수라서 날짜 목록이 없거나 주말만이면 기간이 필요하다.
    """
    if spec.type in ("fixed_assignment", *_BLOCK_CLASSES):
        return spec
    block_type, params = _block_params(spec, period, holidays)
    return _spec_adapter.validate_python(
        {
            "id": spec.id,
            "type": block_type,
            "scope": spec.scope,
            "hardness": spec.hardness,
            "priority": _priority(spec, block_type),
            "source_text": spec.source_text,
            "enabled": spec.enabled,
            "params": params,
        }
    )


def night_dedicated_rule(id: str) -> CountRule:
    """기본 규칙 "나이트 전담은 나이트와 휴무만"(솔버 특수 처리를 대신한다)."""
    return CountRule.model_validate(
        {
            "id": id,
            "type": "count",
            "scope": "ward",
            "hardness": "hard",
            "source_text": NIGHT_ONLY_SOURCE,
            "params": {
                "people": {"tags": [NIGHT_ONLY_TAG]},
                "shifts": {"not_in": ["N", OFF_CODE]},
                "per": "person",
                "max": 0,
            },
        }
    )


def convert_request(req: LegacyScheduleRequest) -> ScheduleRequest:
    """옛 요청 전체를 블록 형식으로. night_only는 나이트 전담 태그로 바꾸고 기본 규칙을 더한다.

    history_load(나이트·주말 두 숫자)는 원본으로 되돌릴 수 없어 버린다. 이력이 필요하면 history를 따로 넣는다.
    """
    nurses = [
        Nurse(
            id=n.id,
            name=n.name,
            years=n.years,
            tags=[*n.tags, NIGHT_ONLY_TAG] if n.night_only and NIGHT_ONLY_TAG not in n.tags else n.tags,
        )
        for n in req.nurses
    ]
    constraints = [legacy_to_block(c, req.period, req.holidays) for c in req.constraints]
    constraints.append(night_dedicated_rule(NIGHT_ONLY_RULE_ID))
    return ScheduleRequest.model_validate(
        {
            **req.model_dump(mode="json", exclude={"history_load"}),
            "nurses": [n.model_dump(mode="json") for n in nurses],
            "constraints": [_spec_adapter.dump_python(c, mode="json") for c in constraints],
        }
    )


# --- 블록 → 식(설계 §2.5) ---

DEFAULT_RULE_PREFIX = "cov-"  # 필요 인원 기본 규칙 id


def _is_default(rule_id: str) -> bool:
    return rule_id.startswith(DEFAULT_RULE_PREFIX) or rule_id == NIGHT_ONLY_RULE_ID


def _shifts(s: Shifts) -> dict:
    return s.model_dump(mode="json", exclude_none=True)


def _flip(s: Shifts) -> dict:
    """not S: in ↔ not_in."""
    return {"not_in": s.in_} if s.in_ is not None else {"in": s.not_in}


def _sel(model: Any) -> dict:
    return model.model_dump(mode="json", exclude_defaults=True)


def _count(shifts: dict, offset: tuple[int, int] | None = None, **extra) -> dict:
    out: dict = {**extra}
    if offset is not None:
        out["offset"] = list(offset)
    return {**out, "shifts": shifts}


def _cmp(left: dict, op: str, right: Any) -> dict:
    return {"left": left, "op": op, "right": right}


def _for_each(per: str, **extra) -> dict:
    return {"per": per, **{k: v for k, v in extra.items() if v}}


def _require(for_each: dict, then: dict, when: dict | None = None) -> dict:
    body = {"kind": "require", "for_each": for_each, "then": then}
    if when is not None:
        body["when"] = when
    return body


def _count_noun(p: Any) -> str:
    """세기 블록 값 label의 명사: 인원·휴무 일수·근무 시간·횟수."""
    if p.measure == "hours":
        return "근무 시간"
    if p.per == "day":
        return "인원"
    if p.shifts.in_ == [OFF_CODE]:
        return "휴무 일수"
    return "횟수"


def _run_noun(run: Shifts) -> str:
    if run.in_ == ["N"]:
        return "나이트"
    if run.not_in == [OFF_CODE]:
        return "근무"
    return "일수"


def _count_bodies(p: Any) -> list[tuple[dict, dict]]:
    noun = _count_noun(p)
    left = _count(_shifts(p.shifts), **({"measure": "hours"} if p.measure == "hours" else {}))
    if p.per == "day":
        if p.people != type(p.people)():
            left = {"who": _sel(p.people), **left}
        for_each = _for_each("day", days=_sel(p.days))
    else:
        for_each = _for_each(p.per, people=_sel(p.people), days=_sel(p.days), window=p.window)
    values: dict = {}
    cmps = []
    if p.min is not None and p.min == p.max:
        values["min"] = {"value": p.min, "label": noun}
        cmps.append(_cmp(left, "eq", {"value": "min"}))
    else:
        if p.min is not None:
            values["min"] = {"value": p.min, "label": f"최소 {noun}"}
            cmps.append(_cmp(left, "ge", {"value": "min"}))
        if p.max is not None:
            values["max"] = {"value": p.max, "label": f"최대 {noun}"}
            cmps.append(_cmp(left, "le", {"value": "max"}))
    then = cmps[0] if len(cmps) == 1 else {"all": cmps}
    return [(_require(for_each, then), values)]


def _sequence_bodies(p: Any) -> list[tuple[dict, dict]]:
    people = _sel(p.people)
    out: list[tuple[dict, dict]] = []
    for pattern in p.forbid or []:
        then = {"any": [_cmp(_count(_shifts(s), (i, i)), "eq", 0) for i, s in enumerate(pattern)]}
        out.append((_require(_for_each("person_day", people=people), then), {}))
    if p.run is not None:
        run, noun = _shifts(p.run), _run_noun(p.run)
        if p.max_len is not None:
            for_each = _for_each("person_window", people=people, window=p.max_len + 1)
            then = _cmp(_count(run), "le", {"value": "max_len"})
            out.append((_require(for_each, then), {"max_len": {"value": p.max_len, "label": f"최대 연속 {noun}"}}))
        if p.min_len is not None and p.min_len > 1:  # 1일 이상은 늘 참이라 규칙이 없다
            when = {"all": [_cmp(_count(_flip(p.run), (-1, -1)), "ge", 1), _cmp(_count(run, (0, 0)), "ge", 1)]}
            then = _cmp(_count(_flip(p.run), (1, p.min_len - 1)), "eq", 0)
            out.append((_require(_for_each("person_day", people=people), then, when), {}))
        if not out:
            raise ValueError("min_len 1만 있는 순서 블록은 식으로 바꿀 규칙이 없습니다")
    if p.after is not None:
        when = {"all": [_cmp(_count(_shifts(p.after), (0, 0)), "ge", 1), _cmp(_count(_flip(p.after), (1, 1)), "ge", 1)]}
        then = _cmp(_count({"not_in": [OFF_CODE]}, (1, p.then_off)), "eq", 0)
        out.append((_require(_for_each("person_day", people=people), then, when), {}))
    return out


def _balance_bodies(p: Any) -> list[tuple[dict, dict]]:
    body = {"kind": "balance", **p.model_dump(mode="json", exclude_defaults=True, exclude={"max_gap"})}
    body["shifts"] = _shifts(p.shifts)
    body["max_gap"] = {"value": "max_gap"}
    return [(body, {"max_gap": {"value": p.max_gap, "label": "최대 차이"}})]


def block_to_rules(block: Any) -> list[Any]:
    """블록 하나를 식 규칙 목록으로. 금지 패턴 여럿·run의 min_len과 max_len은 규칙을 나눈다(둘째부터 id에 -2, -3…).

    숫자 min·max·max_len·max_gap은 values로 옮긴다. min_len·then_off는 offset 구조에 들어가 값이 아니다.
    칸 고정과 이미 식인 규칙은 그대로 한 개짜리 목록이다.
    """
    if block.type in ("fixed_assignment", "rule"):
        return [block]
    bodies = {"count": _count_bodies, "sequence": _sequence_bodies, "balance": _balance_bodies}[block.type](block.params)
    return [
        Rule.model_validate(
            {
                "id": block.id if i == 0 else f"{block.id}-{i + 1}",
                "type": "rule",
                "scope": block.scope,
                "hardness": block.hardness,
                "priority": block.priority,
                "source_text": block.source_text,
                "enabled": block.enabled,
                "default": _is_default(block.id),
                "values": values,
                "body": body,
            }
        )
        for i, (body, values) in enumerate(bodies)
    ]


def rules_request(req: ScheduleRequest) -> ScheduleRequest:
    """요청의 블록을 모두 식 규칙으로 바꾼 요청."""
    constraints = [r for c in req.constraints for r in block_to_rules(c)]
    return ScheduleRequest.model_validate(
        {
            **req.model_dump(mode="json"),
            "constraints": [_spec_adapter.dump_python(c, mode="json") for c in constraints],
        }
    )
