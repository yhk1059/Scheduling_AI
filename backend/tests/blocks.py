"""테스트용 제약 dict. 템플릿 이름의 규칙을 블록 모양으로 만든다(설계 §2.5 변환표와 같은 모양)."""

import json
from datetime import date, timedelta
from pathlib import Path

from backend.domain.constants import HISTORY_DAYS, NIGHT_ONLY_TAG
from backend.domain.convert import NIGHT_ONLY_RULE_ID, night_dedicated_rule

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "lib" / "samples" / "ward-15.json"


def con(cid: str, type_: str, params: dict, hardness: str = "hard", scope: str = "ward", **extra) -> dict:
    return {"id": cid, "type": type_, "scope": scope, "hardness": hardness, "source_text": "원문", "params": params, **extra}


def coverage(shift: str, day_kind: str, lo: int, hi: int, **extra) -> dict:
    """필요 인원: 날마다 그 근무조 lo~hi명."""
    params = {"days": {"kind": day_kind}, "shifts": {"in": [shift]}, "per": "day", "min": lo, "max": hi}
    return con(f"cov-{day_kind}-{shift}", "count", params, **extra)


def forbid(cid: str, first: str, second: str, **extra) -> dict:
    return con(cid, "sequence", {"forbid": [[{"in": [first]}, {"in": [second]}]]}, **extra)


def max_work(cid: str, days: int, **extra) -> dict:
    return con(cid, "sequence", {"run": {"not_in": ["O"]}, "max_len": days}, **extra)


def max_nights(cid: str, days: int, **extra) -> dict:
    return con(cid, "sequence", {"run": {"in": ["N"]}, "max_len": days}, **extra)


def min_off(cid: str, days: int, **extra) -> dict:
    return con(cid, "count", {"shifts": {"in": ["O"]}, "per": "person", "min": days}, **extra)


def off_after_night(cid: str, days: int, **extra) -> dict:
    return con(cid, "sequence", {"after": {"in": ["N"]}, "then_off": days}, **extra)


def skill_mix(cid: str, shift: str, min_years: int, n: int, **extra) -> dict:
    params = {"people": {"min_years": min_years}, "shifts": {"in": [shift]}, "per": "day", "min": n}
    return con(cid, "count", params, **extra)


def leave(cid: str, nurse_id: str, days: list[int], **extra) -> dict:
    params = {"people": {"ids": [nurse_id]}, "days": {"days": days}, "shifts": {"not_in": ["O"]}, "per": "person", "max": 0}
    return con(cid, "count", params, **{"scope": "period", **extra})


def fixed(cid: str, nurse_id: str, day: int, shift: str, **extra) -> dict:
    return con(cid, "fixed_assignment", {"nurse_id": nurse_id, "day": day, "shift": shift}, **{"scope": "period", **extra})


def pref(cid: str, nurse_id: str, shift: str, n_days: int | None = None, days: list[int] | None = None,
         weekends_only: bool = False, **extra) -> dict:
    """희망(n_days = 대상 날짜 수, min) 또는 기피(n_days=None, max 0). 기본은 가능하면·기간 범위."""
    sel: dict = {}
    if weekends_only:
        sel["kind"] = "weekend"
    if days is not None:
        sel["days"] = days
    bound = {"min": n_days} if n_days is not None else {"max": 0}
    params = {"people": {"ids": [nurse_id]}, "days": sel, "shifts": {"in": [shift]}, "per": "person", **bound}
    return con(cid, "count", params, **{"hardness": "soft", "scope": "period", **extra})


def night_fair(cid: str = "nf", **extra) -> dict:
    params = {"people": {"exclude_tags": [NIGHT_ONLY_TAG]}, "shifts": {"in": ["N"]}}
    return con(cid, "balance", params, **{"hardness": "soft", "priority": "low", **extra})


def weekend_fair(cid: str = "wf", **extra) -> dict:
    params = {"days": {"kind": "weekend"}, "shifts": {"not_in": ["O"]}}
    return con(cid, "balance", params, **{"hardness": "soft", "priority": "low", **extra})


def night_only(cid: str = NIGHT_ONLY_RULE_ID) -> dict:
    """기본 규칙 "나이트 전담은 나이트와 휴무만"."""
    return night_dedicated_rule(cid).model_dump(mode="json", by_alias=True)


def history(start: str, rows: dict[str, list[str]], holidays: list[str] = ()) -> dict:
    """기간 시작일(start) 직전 28일 원본. 행이 28칸보다 짧으면 앞을 O로 채운다."""
    first = date.fromisoformat(start) - timedelta(days=HISTORY_DAYS)
    padded = {nid: ["O"] * (HISTORY_DAYS - len(row)) + list(row) for nid, row in rows.items()}
    return {"start_date": first.isoformat(), "rows": padded, "holidays": list(holidays)}


def sample_data() -> dict:
    """샘플 병동을 요청 dict로. next_requests(다음 근무표 요청)는 뺀다."""
    data = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    del data["next_requests"]
    return data
