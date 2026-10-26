"""0-spike: CP-SAT가 동작하고 FastAPI로 노출되는지만 확인한다. 1-backend에서 실제 솔버로 대체된다."""

from fastapi.testclient import TestClient

from backend.routes import app
from backend.solver.demo import NURSES, DAYS, solve_demo

client = TestClient(app)


def test_solve_demo_finds_schedule():
    result = solve_demo()
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    assignments = result["assignments"]
    assert len(assignments) == NURSES
    assert all(len(row) == DAYS for row in assignments)


def test_solve_demo_covers_each_shift_once_per_day():
    assignments = solve_demo()["assignments"]
    for d in range(DAYS):
        day = [row[d] for row in assignments]
        for shift in "DEN":
            assert day.count(shift) == 1


def test_solve_demo_forbids_night_then_day():
    for row in solve_demo()["assignments"]:
        for d in range(DAYS - 1):
            assert not (row[d] == "N" and row[d + 1] == "D")


def test_health():
    r = client.get("/api/py/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_solve_demo_endpoint():
    r = client.get("/api/py/solve-demo")
    assert r.status_code == 200
    assert r.json()["status"] in ("OPTIMAL", "FEASIBLE")
