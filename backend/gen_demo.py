"""샘플 데모(/demo)의 근무표를 미리 풀어 둔다. 실행: npm run gen:demo

데모는 모두에게 같은 고정 화면이라(ADR-016) 날짜도 고정하고, 열 때 솔버를 부르지 않는다.
샘플 병동(ward-15.json)은 블록 형식이라 식 규칙으로 바꿔 푼다(규칙 id는 그대로, 금지 패턴 여럿은 -2… 로 나뉜다).
"""

import json
from pathlib import Path

from backend.domain.constants import SOLVE_TIME_LIMIT_S
from backend.domain.convert import rules_request
from backend.domain.legacy import BlockScheduleRequest
from backend.domain.models import ScheduleRequest, SolveOk
from backend.solver.model import solve

ROOT = Path(__file__).resolve().parent.parent
WARD = ROOT / "lib" / "samples" / "ward-15.json"
OUT = ROOT / "lib" / "samples" / "demo-schedule.json"
DEMO_PERIOD = {"start_date": "2026-11-01", "length": 30}  # 공휴일 없는 달


def demo_request() -> ScheduleRequest:
    """샘플 간호사와 병동 규칙(식으로 바꾼 것)만으로 만든 요청. 공휴일·이월·요청 없음."""
    ward = json.loads(WARD.read_text(encoding="utf-8"))
    return rules_request(
        BlockScheduleRequest(
            config=ward["config"], nurses=ward["nurses"], period=DEMO_PERIOD, constraints=ward["constraints"], input_version=0
        )
    )


def main() -> None:
    res = solve(demo_request(), SOLVE_TIME_LIMIT_S, analyze_conflicts=False, deterministic=True)
    if not isinstance(res, SolveOk) or not res.result.optimal:
        raise SystemExit(f"최적해를 찾지 못했습니다({res.status})")
    out = {"period": DEMO_PERIOD, "result": res.result.model_dump(mode="json")}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
