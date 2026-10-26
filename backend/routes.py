from fastapi import FastAPI

from backend.solver.demo import solve_demo

app = FastAPI(docs_url="/api/py/docs", openapi_url="/api/py/openapi.json")


@app.get("/api/py/health")
def health():
    return {"status": "ok"}


@app.get("/api/py/solve-demo")
def solve_demo_endpoint():
    return solve_demo()
