"""해가 없을 때 원인이 된 hard 제약 집합을 찾는다.

hard 리터럴을 assumptions로 걸고 unsat core를 얻은 뒤, 남은 시간 예산 안에서 deletion 기반으로 줄인다.
assumption에 없는 hard 제약은 리터럴이 자유라서 꺼진 것과 같다.
기본 제약(하루 하나)은 assumption이 아니라서 core에 나오지 않는다. 나이트 전담은 규칙 블록이라 core에 나올 수 있다.
"""

import time

from ortools.sat.python import cp_model

from backend.domain.constants import CONFLICT_TIME_LIMIT_S
from backend.domain.models import Conflict, ScheduleRequest


def find_conflicts(request: ScheduleRequest, time_limit_s: float = CONFLICT_TIME_LIMIT_S) -> list[Conflict] | None:
    """충돌 제약 목록. 기본 제약만으로 불가능하면 [], 시간 안에 판정하지 못하면 None."""
    from backend.solver.model import build_model  # model.solve()가 이 모듈을 쓰므로 순환 import를 피한다

    deadline = time.monotonic() + time_limit_s
    ctx = build_model(request)
    id_by_index = {lit.index: cid for cid, lit in ctx.hard_literals.items()}

    def check(assumed: list[str]) -> tuple[int, list[str]]:
        ctx.model.clear_assumptions()
        ctx.model.add_assumptions([ctx.hard_literals[cid] for cid in assumed])
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(deadline - time.monotonic(), 0.0)
        status = solver.solve(ctx.model)
        if status != cp_model.INFEASIBLE:
            return status, []
        return status, [id_by_index[i] for i in solver.sufficient_assumptions_for_infeasibility()]

    status, core = check(list(ctx.hard_literals))
    if status != cp_model.INFEASIBLE:
        return None

    # deletion 기반 축소: 하나를 빼도 여전히 불가능하면 버리고, 해가 나오면 필수로 남긴다.
    i = 0
    while i < len(core) and time.monotonic() < deadline:
        status, sub_core = check(core[:i] + core[i + 1:])
        if status == cp_model.INFEASIBLE:
            core = [cid for cid in core if cid in sub_core]  # 순서 유지: 앞쪽은 이미 필수로 확인됨
        elif status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            i += 1
        else:
            break

    by_id = {c.id: c for c in request.constraints}
    return [Conflict(constraint_id=cid, type=by_id[cid].type, source_text=by_id[cid].source_text) for cid in core]
