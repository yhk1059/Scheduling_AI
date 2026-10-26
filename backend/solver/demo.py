"""0-spike용 최소 CP-SAT 예제. 4명 x 7일, 매일 D/E/N 각 1명, N 다음 날 D 금지."""

import time

from ortools.sat.python import cp_model

NURSES = 4
DAYS = 7
SHIFTS = "DENO"


def solve_demo() -> dict:
    model = cp_model.CpModel()
    x = {
        (n, d, s): model.new_bool_var(f"x_{n}_{d}_{s}")
        for n in range(NURSES)
        for d in range(DAYS)
        for s in SHIFTS
    }
    for n in range(NURSES):
        for d in range(DAYS):
            model.add_exactly_one(x[n, d, s] for s in SHIFTS)
    for d in range(DAYS):
        for s in "DEN":
            model.add_exactly_one(x[n, d, s] for n in range(NURSES))
    for n in range(NURSES):
        for d in range(DAYS - 1):
            model.add_bool_or([x[n, d, "N"].Not(), x[n, d + 1, "D"].Not()])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    started = time.perf_counter()
    status = solver.solve(model)
    elapsed = time.perf_counter() - started

    assignments = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assignments = [
            "".join(next(s for s in SHIFTS if solver.value(x[n, d, s])) for d in range(DAYS))
            for n in range(NURSES)
        ]
    return {
        "status": solver.status_name(status),
        "assignments": assignments,
        "solve_seconds": round(elapsed, 4),
    }
