"""최악 병동 성능 확인(ADR-008, 설계 §10 6단계). 실행: npm run bench

입력 상한(constants.py)을 꽉 채운 병동이 시간 예산 안에 해를 내는지, 휴가 충돌을 더한 변형에서
충돌 분석이 예산 안에 끝나는지 확인한다. 하나라도 넘으면 exit 1. 넘으면 시간 예산을 늘리지 말고 상한을 낮춘다.
시간이 걸려서 npm run test에는 넣지 않는다.
"""

import sys
import time
from datetime import date, timedelta
from typing import Any

from backend.domain.constants import (
    CARRY_OVER_DAYS,
    CONFLICT_TIME_LIMIT_S,
    HISTORY_DAYS,
    MAX_NURSES,
    MAX_PATTERN_LEN,
    MAX_PATTERNS,
    MAX_PERIOD_DAYS,
    MAX_SHIFT_CODES,
    MAX_WINDOW_DAYS,
    NIGHT_ONLY_TAG,
    SOLVE_TIME_LIMIT_S,
)
from backend.domain.convert import night_dedicated_rule
from backend.domain.models import ScheduleRequest, SolveInfeasible, SolveOk
from backend.solver.conflicts import find_conflicts
from backend.solver.model import solve

START = date(2026, 12, 1)  # 화요일. 첫 주(월 11/30)에 이월 칸이 들어간다
HOLIDAYS = [25, 31]
LEAVE_DAY = 10  # 충돌 변형: 이날 휴가가 몰려 필요 인원을 채울 수 없다

# 근무 코드 8개(O 포함): 기본 D/E/N + 미드 M + 짧은 S + 더블 DE·ME
CONFIG = {
    "shifts": [
        {"code": "D", "name": "데이", "hours": 8},
        {"code": "E", "name": "이브닝", "hours": 8},
        {"code": "N", "name": "나이트", "hours": 8},
        {"code": "M", "name": "미드", "hours": 8},
        {"code": "S", "name": "단축", "hours": 4},
        {"code": "DE", "name": "더블", "hours": 16, "parts": ["D", "E"]},
        {"code": "ME", "name": "미드 더블", "hours": 16, "parts": ["M", "E"]},
        {"code": "O", "name": "휴무", "hours": 0},
    ]
}
assert len(CONFIG["shifts"]) == MAX_SHIFT_CODES

IN = lambda *codes: {"in": list(codes)}  # noqa: E731
WORK = {"not_in": ["O"]}
ALL_N = IN("N")


def nurses() -> list[dict]:
    """40명. 태그 3종: 나이트전담 4명, 책임 8명, 신규 6명."""
    rows = []
    for i in range(MAX_NURSES):
        tags = []
        if i >= MAX_NURSES - 4:
            tags.append(NIGHT_ONLY_TAG)
        elif i % 5 == 0:
            tags.append("책임")
        elif i % 6 == 1:
            tags.append("신규")
        rows.append({"id": f"n{i:02d}", "name": f"간호사{i:02d}", "years": 1 if "신규" in tags else 2 + i % 12, "tags": tags})
    return rows


def past_rows(people: list[dict]) -> dict[str, list[str]]:
    """기간 직전 28일 확정 배정. 규칙을 지키는 순환 패턴을 사람마다 어긋나게 둔다."""
    general = "DDEEONNOOO"
    night = "NNOONNNOOO"
    rows = {}
    for i, n in enumerate(people):
        cycle = night if NIGHT_ONLY_TAG in n["tags"] else general
        rows[n["id"]] = [cycle[(i + d) % len(cycle)] for d in range(HISTORY_DAYS)]
    return rows


def block(cid: str, type_: str, params: dict, hardness: str = "hard", **extra: Any) -> dict:
    return {"id": cid, "type": type_, "scope": "ward", "hardness": hardness, "source_text": cid, "params": params, **extra}


def count(cid: str, shifts: dict, per: str, lo=None, hi=None, hardness: str = "hard", priority: str = "normal", **params: Any) -> dict:
    p = {"shifts": shifts, "per": per, **params}
    if lo is not None:
        p["min"] = lo
    if hi is not None:
        p["max"] = hi
    return block(cid, "count", p, hardness, priority=priority)


def rules(people: list[dict]) -> list[dict]:
    """블록 60개."""
    general = {"exclude_tags": [NIGHT_ONLY_TAG]}
    rows: list[dict] = [night_dedicated_rule("night-only").model_dump(by_alias=True)]
    # 필요 인원: 근무조 4개 × 평일/주말 (8)
    staffing = {"D": (7, 6), "E": (7, 6), "N": (5, 5), "M": (2, 1)}
    for code, (weekday, weekend) in staffing.items():
        rows.append(count(f"cov-{code}-wd", IN(code), "day", weekday, weekday, days={"kind": "weekday"}))
        rows.append(count(f"cov-{code}-we", IN(code), "day", weekend, weekend, days={"kind": "weekend"}))
    # 태그·연차 배치 (10)
    for code in "DEN":
        rows.append(count(f"charge-{code}", IN(code), "day", lo=1, people={"tags": ["책임"]}))
        rows.append(count(f"senior-{code}", IN(code), "day", lo=2, people={"min_years": 3}))
        rows.append(count(f"new-{code}", IN(code), "day", hi=2, people={"tags": ["신규"]}))
    rows.append(count("charge-D-max", IN("D"), "day", hi=3, people={"tags": ["책임"]}))
    # 사람마다 세기 (9)
    rows += [
        count("min-off", IN("O"), "person", lo=9),
        count("week-hours", WORK, "person_week", hi=52, measure="hours"),
        count("week-off", IN("O"), "person_week", lo=1),
        count("window-7", IN("O"), "person_window", lo=1, window=7),
        count(f"window-{MAX_WINDOW_DAYS}", IN("O"), "person_window", lo=3, window=MAX_WINDOW_DAYS),
        count("double-max", IN("DE", "ME"), "person", hi=2),
        count("mid-max", IN("M"), "person", hi=8),
        count("weekend-max", WORK, "person", hi=7, days={"kind": "weekend"}),
        count("night-max", ALL_N, "person", hi=8, people=general),
    ]
    # 순서: 금지 패턴 블록 2개(패턴 수·길이 상한), 연속 구간 3개, 구간 뒤 휴무 1개 (6)
    rows.append(block("forbid-after-night", "sequence", {"forbid": [[ALL_N, IN(c)] for c in ("D", "E", "M", "DE")][:MAX_PATTERNS]}))
    long_pattern = [ALL_N, IN("O"), IN("D", "DE"), IN("N")][:MAX_PATTERN_LEN]
    rows.append(block("forbid-misc", "sequence", {"forbid": [[IN("E"), IN("D")], [IN("ME", "DE"), IN("D", "M")], [IN("E"), IN("M")], long_pattern][:MAX_PATTERNS]}))
    rows += [
        block("run-work", "sequence", {"run": WORK, "max_len": 5}),
        block("run-night", "sequence", {"run": ALL_N, "max_len": 3}),
        block("run-night-min", "sequence", {"run": ALL_N, "min_len": 2}),
        block("after-night", "sequence", {"after": ALL_N, "then_off": 2}),
    ]
    # 고르게 (3)
    rows += [
        block("fair-night", "balance", {"people": general, "shifts": ALL_N}, hardness="soft"),
        block("fair-weekend", "balance", {"days": {"kind": "weekend"}, "shifts": WORK}, hardness="soft"),
        block("fair-hours", "balance", {"shifts": WORK, "measure": "hours"}, hardness="soft"),
    ]
    # 가능하면 세기 (3)
    rows += [
        count("soft-new-night", ALL_N, "person", hi=4, hardness="soft", people={"tags": ["신규"]}, priority="high"),
        count("soft-hours", WORK, "person", hi=168, hardness="soft", measure="hours"),
        count("soft-mid-day", IN("M"), "day", hi=1, hardness="soft", days={"kind": "weekday"}),
    ]
    # 희망·기피 20개: 휴무 희망(특정일 3일) 10개, 나이트 기피 10개
    for i, n in enumerate(people[:20]):
        who = {"ids": [n["id"]]}
        if i % 2 == 0:
            days = [(i * 3) % 28 + 1, (i * 3) % 28 + 2, (i * 3) % 28 + 3]
            rows.append(count(f"wish-{n['id']}", IN("O"), "person", lo=3, hardness="soft", people=who, days={"days": days}))
        else:
            rows.append(count(f"avoid-{n['id']}", ALL_N, "person", hi=0, hardness="soft", people=who, days={"kind": "weekend"}))
    return rows


def worst_ward() -> dict:
    people = nurses()
    past = past_rows(people)
    return {
        "config": CONFIG,
        "nurses": people,
        "period": {"start_date": START.isoformat(), "length": MAX_PERIOD_DAYS},
        "holidays": HOLIDAYS,
        "constraints": rules(people),
        "carry_over": [{"nurse_id": nid, "shifts": row[-CARRY_OVER_DAYS:]} for nid, row in past.items()],
        "history": {"start_date": (START - timedelta(days=HISTORY_DAYS)).isoformat(), "rows": past, "holidays": []},
        "input_version": 1,
    }


def with_leave_conflict(data: dict) -> dict:
    """휴가 블록 하나: 일반 간호사 30명이 같은 날 쉬면 필요 인원을 채울 수 없다."""
    ids = [n["id"] for n in data["nurses"] if NIGHT_ONLY_TAG not in n["tags"]][:30]
    leave = count("leave-crowd", IN("O"), "person", lo=1, people={"ids": ids}, days={"days": [LEAVE_DAY]})
    return {**data, "constraints": data["constraints"] + [leave]}


# 솔버 자체는 max_time_in_seconds로 예산에 묶인다. 모델 만들기·통계 계산 시간만큼 벽시계 여유를 둔다
OVERHEAD_S = 1


def timed(fn, *args, **kwargs):
    t = time.monotonic()
    out = fn(*args, **kwargs)
    return out, time.monotonic() - t


def main() -> int:
    data = worst_ward()
    req = ScheduleRequest.model_validate(data)
    blocks = sum(1 for c in req.constraints if c.type in ("count", "sequence", "balance"))
    print(f"병동: 간호사 {len(req.nurses)}명 × {req.period.length}일, 근무 코드 {len(req.config.shifts)}개, 블록 {blocks}개")
    failed = False

    res, elapsed = timed(solve, req)
    optimal = res.result.optimal if isinstance(res, SolveOk) else None
    print(f"풀이: {res.status} (optimal={optimal}) {elapsed:.2f}s / 예산 {SOLVE_TIME_LIMIT_S}s")
    if not isinstance(res, SolveOk) or elapsed > SOLVE_TIME_LIMIT_S + OVERHEAD_S:
        print("실패: 시간 예산 안에 해를 내지 못했다")
        failed = True

    bad = ScheduleRequest.model_validate(with_leave_conflict(data))
    res, elapsed = timed(solve, bad, analyze_conflicts=False)
    print(f"충돌 변형 풀이: {res.status} {elapsed:.2f}s / 예산 {SOLVE_TIME_LIMIT_S}s")
    if not isinstance(res, SolveInfeasible):
        print("실패: 충돌 변형이 시간 예산 안에 해 없음으로 판정되지 않았다")
        failed = True

    conflicts, elapsed = timed(find_conflicts, bad, CONFLICT_TIME_LIMIT_S)
    ids = [c.constraint_id for c in conflicts or []]
    print(f"충돌 분석: {len(ids)}개 {ids} {elapsed:.2f}s / 예산 {CONFLICT_TIME_LIMIT_S}s")
    if conflicts is None or "leave-crowd" not in ids or elapsed > CONFLICT_TIME_LIMIT_S + OVERHEAD_S:
        print("실패: 충돌 분석이 시간 예산 안에 휴가 충돌을 찾지 못했다")
        failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
