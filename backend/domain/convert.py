"""템플릿 12종 → 블록 변환(설계 §2.5, ADR-018). 저장 이전과 eval 기대값 재작성에 같은 표를 쓴다. 순수 함수."""

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
    ScheduleRequest,
    SequenceRule,
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
