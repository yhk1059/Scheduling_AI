"""테스트용 식 규칙 dict. 프리셋 이름의 규칙을 설계 §2.5 변환표 모양(옛 블록을 옮긴 식·값 이름·label)으로 만든다."""

import json
from datetime import date, timedelta
from pathlib import Path

from backend.domain.constants import HISTORY_DAYS, NIGHT_ONLY_TAG

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "lib" / "samples" / "ward-15.json"

NIGHT_ONLY_RULE_ID = "night-only"

N, O = {"in": ["N"]}, {"in": ["O"]}
WORK = {"not_in": ["O"]}


def con(cid: str, body: dict, values: dict | None = None, hardness: str = "hard", scope: str = "ward", **extra) -> dict:
    return {"id": cid, "type": "rule", "scope": scope, "hardness": hardness, "source_text": "원문",
            "values": values or {}, "body": body, **extra}


def cnt(shifts: dict, offset: tuple[int, int] | None = None, **extra) -> dict:
    c: dict = {**extra, "shifts": shifts}
    if offset is not None:
        c["offset"] = list(offset)
    return c


def cmp(left: dict, op: str, right) -> dict:
    return {"left": left, "op": op, "right": right}


def require(per: str, then: dict, when: dict | None = None, **for_each) -> dict:
    body = {"kind": "require", "for_each": {"per": per, **{k: v for k, v in for_each.items() if v}}, "then": then}
    if when is not None:
        body["when"] = when
    return body


def flip(s: dict) -> dict:
    """not S: in ↔ not_in."""
    return {"not_in": s["in"]} if "in" in s else {"in": s["not_in"]}


def _noun(per: str, shifts: dict, measure: str) -> str:
    if measure == "hours":
        return "근무 시간"
    if per == "day":
        return "인원"
    return "휴무 일수" if shifts == O else "횟수"


def count(cid: str, shifts: dict, per: str, lo: float | None = None, hi: float | None = None, people: dict | None = None,
          days: dict | None = None, window: int | None = None, measure: str = "count", **extra) -> dict:
    """세기: 범위(per)마다 고른 칸의 수(또는 근무 시간)가 lo~hi. per=day면 people은 세는 사람(who), 아니면 묶는 사람."""
    noun = _noun(per, shifts, measure)
    left = cnt(shifts, **({"who": people} if per == "day" and people else {}), **({"measure": "hours"} if measure == "hours" else {}))
    values, cmps = {}, []
    if lo is not None and lo == hi:
        values["min"] = {"value": lo, "label": noun}
        cmps.append(cmp(left, "eq", {"value": "min"}))
    else:
        if lo is not None:
            values["min"] = {"value": lo, "label": f"최소 {noun}"}
            cmps.append(cmp(left, "ge", {"value": "min"}))
        if hi is not None:
            values["max"] = {"value": hi, "label": f"최대 {noun}"}
            cmps.append(cmp(left, "le", {"value": "max"}))
    then = cmps[0] if len(cmps) == 1 else {"all": cmps}
    body = require(per, then, people=people if per != "day" else None, days=days, window=window)
    return con(cid, body, values, **extra)


def coverage(shift: str, day_kind: str, lo: int, hi: int, **extra) -> dict:
    """필요 인원(기본 규칙): 날마다 그 근무조 lo~hi명."""
    cid = f"cov-{day_kind}-{shift}"
    return count(cid, {"in": [shift]}, "day", lo, hi, days={"kind": day_kind}, **{"default": True, **extra})


def forbid(cid: str, first: str, second: str, **extra) -> dict:
    """금지 순서: 사람마다 d가 first면 d+1은 second가 아니다."""
    then = {"any": [cmp(cnt({"in": [first]}, (0, 0)), "eq", 0), cmp(cnt({"in": [second]}, (1, 1)), "eq", 0)]}
    return con(cid, require("person_day", then), **extra)


def max_run(cid: str, run: dict, days: int, noun: str = "일수", people: dict | None = None, **extra) -> dict:
    """연속 구간 최대 days일: days+1일 창마다 run이 days일 이하."""
    body = require("person_window", cmp(cnt(run), "le", {"value": "max_len"}), people=people, window=days + 1)
    return con(cid, body, {"max_len": {"value": days, "label": f"최대 연속 {noun}"}}, **extra)


def max_work(cid: str, days: int, **extra) -> dict:
    return max_run(cid, WORK, days, "근무", **extra)


def max_nights(cid: str, days: int, **extra) -> dict:
    return max_run(cid, N, days, "나이트", **extra)


def min_run(cid: str, run: dict, days: int, people: dict | None = None, **extra) -> dict:
    """연속 구간 최소 days일: run이 시작하면 다음 days−1일도 run."""
    when = {"all": [cmp(cnt(flip(run), (-1, -1)), "ge", 1), cmp(cnt(run, (0, 0)), "ge", 1)]}
    return con(cid, require("person_day", cmp(cnt(flip(run), (1, days - 1)), "eq", 0), when, people=people), **extra)


def off_after(cid: str, days: int, after: dict = N, people: dict | None = None, **extra) -> dict:
    """구간이 끝나면 days일 휴무: d가 after이고 d+1이 after가 아니면 d+1..d+days는 휴무."""
    when = {"all": [cmp(cnt(after, (0, 0)), "ge", 1), cmp(cnt(flip(after), (1, 1)), "ge", 1)]}
    return con(cid, require("person_day", cmp(cnt(WORK, (1, days)), "eq", 0), when, people=people), **extra)


def off_after_night(cid: str, days: int, **extra) -> dict:
    return off_after(cid, days, **extra)


def min_off(cid: str, days: int, **extra) -> dict:
    return count(cid, O, "person", lo=days, **extra)


def skill_mix(cid: str, shift: str, min_years: int, n: int, **extra) -> dict:
    return count(cid, {"in": [shift]}, "day", lo=n, people={"min_years": min_years}, **extra)


def weekly_hours(cid: str, hours: float, **extra) -> dict:
    """사람·달력 주마다 근무 시간 hours 이하."""
    return count(cid, WORK, "person_week", hi=hours, measure="hours", **extra)


def window_off(cid: str, window: int, n: int = 1, **extra) -> dict:
    """사람·연속 window일마다 휴무 n일 이상."""
    return count(cid, O, "person_window", lo=n, window=window, **extra)


def leave(cid: str, nurse_id: str, days: list[int], **extra) -> dict:
    """휴가: 그 사람의 그 날들에 휴무 말고 0번(반드시)."""
    return count(cid, WORK, "person", hi=0, people={"ids": [nurse_id]}, days={"days": days}, **{"scope": "period", **extra})


def fixed(cid: str, nurse_id: str, day: int, shift: str, **extra) -> dict:
    return {"id": cid, "type": "fixed_assignment", "scope": "period", "hardness": "hard", "source_text": "원문",
            "params": {"nurse_id": nurse_id, "day": day, "shift": shift}, **extra}


def preference(cid: str, nurse_id: str, shift: str, n_days: int | None = None, days: list[int] | None = None,
               weekends_only: bool = False, **extra) -> dict:
    """희망(n_days = 대상 날짜 수, 최소) 또는 기피(n_days=None, 최대 0). 기본은 가능하면·기간 범위."""
    sel: dict = {}
    if weekends_only:
        sel["kind"] = "weekend"
    if days is not None:
        sel["days"] = days
    bound = {"lo": n_days} if n_days is not None else {"hi": 0}
    return count(cid, {"in": [shift]}, "person", people={"ids": [nurse_id]}, days=sel,
                 **bound, **{"hardness": "soft", "scope": "period", **extra})


def balance(cid: str, shifts: dict, max_gap: float = 1, **extra) -> dict:
    """고르게(내장 함수): 고른 사람 사이 차이. 셀렉터(people·days)·measure·with_history는 extra에서 body로."""
    keys = ("people", "days", "measure", "with_history")
    body = {"kind": "balance", **{k: extra.pop(k) for k in keys if k in extra}, "shifts": shifts,
            "max_gap": {"value": "max_gap"}}
    return con(cid, body, {"max_gap": {"value": max_gap, "label": "최대 차이"}}, **{"hardness": "soft", "priority": "low", **extra})


def night_fair(cid: str = "nf", **extra) -> dict:
    return balance(cid, N, people={"exclude_tags": [NIGHT_ONLY_TAG]}, **extra)


def weekend_fair(cid: str = "wf", **extra) -> dict:
    return balance(cid, WORK, days={"kind": "weekend"}, **extra)


def conditional(cid: str, shift: str, if_who: dict, then_who: dict, n: int = 1, **extra) -> dict:
    """조건부(설계 §2.6): 날마다 if_who가 shift에 1명 이상이면 then_who도 shift에 n명 이상."""
    s = {"in": [shift]}
    body = require("day", cmp(cnt(s, who=then_who), "ge", n), cmp(cnt(s, who=if_who), "ge", 1))
    return con(cid, body, **extra)


def pair_forbid(cid: str, ids: list[str], shift: str, **extra) -> dict:
    """짝 따로(설계 §2.6): 날마다 두 사람 중 shift는 1명 이하."""
    return con(cid, require("day", cmp(cnt({"in": [shift]}, who={"ids": ids}), "le", 1)), **extra)


def night_only(cid: str = NIGHT_ONLY_RULE_ID) -> dict:
    """기본 규칙 "나이트 전담은 나이트와 휴무만": 나이트 전담 태그는 사람마다 나이트·휴무 말고 0번."""
    return count(cid, {"not_in": ["N", "O"]}, "person", hi=0, people={"tags": [NIGHT_ONLY_TAG]}, default=True,
                 source_text="나이트 전담은 나이트와 휴무만")


def history(start: str, rows: dict[str, list[str]], holidays: list[str] = ()) -> dict:
    """기간 시작일(start) 직전 28일 원본. 행이 28칸보다 짧으면 앞을 O로 채운다."""
    first = date.fromisoformat(start) - timedelta(days=HISTORY_DAYS)
    padded = {nid: ["O"] * (HISTORY_DAYS - len(row)) + list(row) for nid, row in rows.items()}
    return {"start_date": first.isoformat(), "rows": padded, "holidays": list(holidays)}


def sample_data() -> dict:
    """샘플 병동(식 규칙) 요청 dict. next_requests(다음 근무표 요청)는 뺀다."""
    data = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    del data["next_requests"]
    return data
