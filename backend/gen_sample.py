"""샘플 병동의 확정 근무표를 달 모양 28개(길이 28~31 × 1일 요일 7)마다 미리 풀어 둔다. 실행: npm run gen:sample

샘플은 날짜가 오늘 기준으로 바뀌므로, 열 때마다 솔버를 부르지 않고 이 파일에서 달 모양으로 찾아 쓴다.
"""

import json
from datetime import date
from pathlib import Path

from backend.domain.constants import SOLVE_TIME_LIMIT_S
from backend.domain.models import ScheduleRequest, SolveOk
from backend.solver.model import solve

ROOT = Path(__file__).resolve().parent.parent
WARD = ROOT / "lib" / "samples" / "ward-15.json"
OUT = ROOT / "lib" / "samples" / "confirmed-schedules.json"
LENGTHS = (28, 29, 30, 31)
SEARCH_YEARS = range(2026, 2060)  # 윤년 2월(29일)은 28년 주기로 모든 1일 요일이 나온다


def _month_length(year: int, month: int) -> int:
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return (nxt - date(year, month, 1)).days


def start_date_for(length: int, weekday: int) -> date:
    """길이가 length이고 1일이 weekday(월=0)인 실제 달의 1일."""
    for year in SEARCH_YEARS:
        for month in range(1, 13):
            first = date(year, month, 1)
            if _month_length(year, month) == length and first.weekday() == weekday:
                return first
    raise ValueError(f"{length}일, 1일 요일 {weekday}인 달이 없습니다")


def sample_request(length: int, weekday: int) -> ScheduleRequest:
    """샘플 간호사와 병동 규칙만으로 만든 요청. 공휴일·이월·요청 없음."""
    ward = json.loads(WARD.read_text(encoding="utf-8"))
    return ScheduleRequest(
        nurses=ward["nurses"],
        period={"start_date": start_date_for(length, weekday), "length": length},
        constraints=ward["constraints"],
        input_version=0,
    )


def build() -> dict:
    out = {}
    for length in LENGTHS:
        for weekday in range(7):
            key = f"{length}-{weekday}"
            res = solve(sample_request(length, weekday), SOLVE_TIME_LIMIT_S, analyze_conflicts=False, deterministic=True)
            if not isinstance(res, SolveOk) or not res.result.optimal:
                raise SystemExit(f"{key}: 최적해를 찾지 못했습니다({res.status})")
            out[key] = res.result.model_dump(mode="json")
    return out


def main() -> None:
    OUT.write_text(json.dumps(build(), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
