"""솔버 회귀 기준(solver-cases.json). 실행: npm run gen:golden

solver-cases.json의 요청을 지금 솔버로 다시 풀어 기대값(status, 목적값·배정 또는 충돌 규칙 id)을 쓴다.
`--check`는 파일을 쓰지 않고 다시 만들어 기존 파일과 비교한다(다르면 exit 1).
"""

import json
import sys
from pathlib import Path
from typing import Any

from ortools.sat.python import cp_model

from backend.domain.constants import SOLVE_TIME_LIMIT_S
from backend.domain.models import ScheduleRequest
from backend.solver.conflicts import find_conflicts
from backend.solver.model import build_model

ROOT = Path(__file__).resolve().parent.parent
SOLVER_CASES_PATH = ROOT / "backend" / "tests" / "golden" / "solver-cases.json"


# --- 풀이 ---


def solve_case(request: ScheduleRequest, conflicts: bool = True) -> dict[str, Any]:
    """solve()와 같은 방식(hard 리터럴 고정, 단일 워커, 고정 시드)으로 풀어 목적값을 읽는다."""
    ctx = build_model(request)
    ctx.model.add_bool_and(list(ctx.hard_literals.values()))
    if ctx.objective_terms:
        ctx.model.minimize(sum(ctx.objective_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_S
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    status = solver.solve(ctx.model)
    if status == cp_model.OPTIMAL:
        assignments = {
            n.id: [next(s for s in ctx.codes if solver.boolean_value(ctx.x[n.id, d, s])) for d in range(1, ctx.days + 1)]
            for n in request.employees
        }
        objective = round(solver.objective_value) if ctx.objective_terms else 0
        return {"status": "ok", "optimal": True, "objective": objective, "assignments": assignments}
    if status == cp_model.INFEASIBLE:
        found = find_conflicts(request) if conflicts else []
        return {"status": "infeasible", "conflict_ids": [c.constraint_id for c in found or []]}
    return {"status": solver.status_name(status)}


# --- 솔버 회귀 기준(solver-cases.json): 식 규칙 요청만 읽는다 ---


def build_solver_cases() -> list[dict]:
    """solver-cases.json의 요청(id·설명·요청은 그대로)을 지금 솔버로 풀어 기대값을 다시 쓴다."""
    cases = json.loads(SOLVER_CASES_PATH.read_text(encoding="utf-8"))
    return [
        {**case, "expected": solve_case(ScheduleRequest.model_validate(case["request"]))}
        for case in cases
    ]


def render(cases: list[dict]) -> str:
    return json.dumps(cases, ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    text = render(build_solver_cases())
    if "--check" in sys.argv[1:]:
        if SOLVER_CASES_PATH.read_text(encoding="utf-8") != text:
            print(f"{SOLVER_CASES_PATH.relative_to(ROOT)}가 지금 결과와 다릅니다", file=sys.stderr)
            sys.exit(1)
        print("golden cases ok")
        return
    SOLVER_CASES_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {SOLVER_CASES_PATH.relative_to(ROOT)} ({len(json.loads(text))} cases)")


if __name__ == "__main__":
    main()
