"""HTTP 계층. solver와 llm의 조합(제안 재풀이 검증)은 이 파일에서만 한다(ADR-006)."""

import json
import logging
import uuid
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from backend.domain.constants import (
    MAX_CONSTRAINTS,
    MAX_FIXED_ASSIGNMENTS,
    MAX_NURSES,
    MAX_PROPOSALS,
    MAX_SHIFT_CODES,
    MAX_TAGS_PER_NURSE,
    MAX_TEXT_CHARS,
    PROPOSAL_VERIFY_TIME_LIMIT_S,
)
from backend.domain.models import (
    ConstraintChange,
    ConstraintSpec,
    ErrorBody,
    ErrorDetail,
    ExplainRequest,
    ExplainResponse,
    RelaxationProposal,
    ScheduleRequest,
    SolveInfeasible,
    SolveOk,
    SolveTimeout,
    TranslateClarify,
    TranslateOk,
    TranslateRequest,
    TranslateUnsupported,
)
from backend.env import load_local_env
from backend.llm.client import (
    AnthropicClient,
    LLMClient,
    LLMConfigError,
    LLMInvalidOutputError,
    LLMUnavailableError,
    ToolCallResult,
)
from backend.llm.explainer import explain, fallback_explanation
from backend.llm.translator import translate
from backend.solver.model import solve

logger = logging.getLogger(__name__)
_spec_adapter = TypeAdapter(ConstraintSpec)


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_local_env()
    yield


app = FastAPI(docs_url="/api/py/docs", openapi_url="/api/py/openapi.json", lifespan=lifespan)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


class _MeteredClient:
    """로그용으로 LLM 호출 횟수와 토큰 수를 센다."""

    def __init__(self, inner: LLMClient):
        self.inner = inner
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0

    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult:
        self.calls += 1
        result = self.inner.call_tool(system=system, messages=messages, tool=tool)
        self.input_tokens += result.input_tokens
        self.output_tokens += result.output_tokens
        return result


def get_llm_client() -> LLMClient:
    return AnthropicClient()


def _metered(request: Request, client: LLMClient) -> _MeteredClient:
    request.state.llm = _MeteredClient(client)
    return request.state.llm


# --- 오류 변환과 구조화 로그 ---


def _to_error(e: Exception) -> tuple[int, str, str]:
    if isinstance(e, ApiError):
        return e.status, e.code, str(e)
    if isinstance(e, ValidationError):
        details = "; ".join(
            f"{'.'.join(map(str, err['loc'])) or '(root)'}: {err['msg']}" for err in e.errors(include_input=False)
        )
        return 422, "VALIDATION_ERROR", details
    if isinstance(e, LLMInvalidOutputError):
        return 502, "LLM_INVALID_OUTPUT", "LLM 출력이 재시도 후에도 유효하지 않습니다"
    if isinstance(e, LLMUnavailableError):
        return 503, "LLM_UNAVAILABLE", "LLM을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요"
    if isinstance(e, LLMConfigError):
        return 500, "CONFIG_ERROR", "서버 LLM 설정 오류입니다"
    return 500, "INTERNAL", "서버 내부 오류입니다"


@app.middleware("http")
async def handle_errors_and_log(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    started = monotonic()
    try:
        response = await call_next(request)
    except Exception as e:
        status, code, message = _to_error(e)
        if code in ("INTERNAL", "CONFIG_ERROR"):
            logger.error("request_id=%s %s", request_id, code, exc_info=e)  # 스택은 로그에만 남긴다
        body = ErrorBody(error=ErrorDetail(code=code, message=message, request_id=request_id))
        response = JSONResponse(body.model_dump(), status_code=status)

    record: dict[str, Any] = {
        "request_id": request_id,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": round((monotonic() - started) * 1000, 1),
    }
    llm = getattr(request.state, "llm", None)
    if llm is not None:
        record |= {
            "llm_retries": max(llm.calls - 1, 0),
            "input_tokens": llm.input_tokens,
            "output_tokens": llm.output_tokens,
        }
    print(json.dumps(record), flush=True)
    return response


# --- 입력 ---


def _check_limits(data: Any) -> None:
    """Pydantic 검증 전에 개수와 길이만 가볍게 확인한다."""
    if not isinstance(data, dict):
        return
    for part in (data, data.get("context"), data.get("request")):
        if not isinstance(part, dict):
            continue
        nurses, constraints = part.get("nurses"), part.get("constraints")
        if isinstance(nurses, list) and len(nurses) > MAX_NURSES:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", f"간호사는 최대 {MAX_NURSES}명입니다")
        if isinstance(nurses, list) and any(
            isinstance(n, dict) and isinstance(n.get("tags"), list) and len(n["tags"]) > MAX_TAGS_PER_NURSE for n in nurses
        ):
            raise ApiError(413, "PAYLOAD_TOO_LARGE", f"태그는 사람당 최대 {MAX_TAGS_PER_NURSE}개입니다")
        config = part.get("config")
        if isinstance(config, dict) and isinstance(config.get("shifts"), list) and len(config["shifts"]) > MAX_SHIFT_CODES:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", f"근무 코드는 최대 {MAX_SHIFT_CODES}개입니다")
        if isinstance(constraints, list):
            fixed = sum(1 for c in constraints if isinstance(c, dict) and c.get("type") == "fixed_assignment")
            if len(constraints) - fixed > MAX_CONSTRAINTS:
                raise ApiError(413, "PAYLOAD_TOO_LARGE", f"제약은 최대 {MAX_CONSTRAINTS}개입니다")
            if fixed > MAX_FIXED_ASSIGNMENTS:
                raise ApiError(413, "PAYLOAD_TOO_LARGE", f"고정 근무는 최대 {MAX_FIXED_ASSIGNMENTS}개입니다")
    text = data.get("text")
    if isinstance(text, str) and len(text) > MAX_TEXT_CHARS:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", f"텍스트는 최대 {MAX_TEXT_CHARS}자입니다")


def _body(model: type[BaseModel]):
    """본문 의존성. LLM 클라이언트보다 먼저 선언해 413·422를 키 확인보다 먼저 판정한다."""

    async def parse(request: Request):
        try:
            data = await request.json()
        except ValueError as e:
            raise ApiError(422, "VALIDATION_ERROR", "본문이 올바른 JSON이 아닙니다") from e
        _check_limits(data)
        return model.model_validate(data)

    return parse


# --- 엔드포인트 ---


@app.get("/api/py/health")
def health():
    return {"status": "ok"}


@app.post("/api/py/solve")
async def solve_endpoint(req: ScheduleRequest = Depends(_body(ScheduleRequest))) -> SolveOk | SolveInfeasible | SolveTimeout:
    return await run_in_threadpool(solve, req)


@app.post("/api/py/translate")
async def translate_endpoint(
    request: Request,
    req: TranslateRequest = Depends(_body(TranslateRequest)),
    client: LLMClient = Depends(get_llm_client),
) -> TranslateOk | TranslateClarify | TranslateUnsupported:
    return await run_in_threadpool(translate, req, _metered(request, client))


@app.post("/api/py/explain")
async def explain_endpoint(
    request: Request,
    req: ExplainRequest = Depends(_body(ExplainRequest)),
    client: LLMClient = Depends(get_llm_client),
) -> ExplainResponse:
    return await run_in_threadpool(_explain, req, _metered(request, client))


# --- /explain 오케스트레이션 ---


def _apply(request: ScheduleRequest, changes: list[ConstraintChange]) -> ScheduleRequest:
    specs = {c.id: c for c in request.constraints}
    for change in changes:
        spec = specs[change.constraint_id]
        if change.action == "disable":
            specs[spec.id] = spec.model_copy(update={"enabled": False})
            continue
        data = spec.model_dump()
        if change.params is not None:
            data["params"] = change.params
        if change.hardness is not None:
            data["hardness"] = change.hardness
        specs[spec.id] = _spec_adapter.validate_python(data)
    return request.model_copy(update={"constraints": list(specs.values())})


def _verify(request: ScheduleRequest, proposals: list[RelaxationProposal]) -> list[RelaxationProposal]:
    """재풀이로 해가 나오는 제안만 남긴다. 전체 예산을 넘기면 그때까지 검증된 것만 돌려준다."""
    budget = PROPOSAL_VERIFY_TIME_LIMIT_S * MAX_PROPOSALS
    started = monotonic()
    verified = []
    for proposal in proposals:
        remaining = budget - (monotonic() - started)
        if remaining <= 0:
            break
        res = solve(
            _apply(request, proposal.changes),
            time_limit_s=min(PROPOSAL_VERIFY_TIME_LIMIT_S, remaining),
            analyze_conflicts=False,
        )
        if isinstance(res, SolveOk):
            verified.append(proposal.model_copy(update={"verified_summary": res.result.summary}))
    return verified


def _explain(req: ExplainRequest, client: LLMClient) -> ExplainResponse:
    version = req.request.input_version
    try:
        text, proposals = explain(req.request, req.conflicts, client)
    except (LLMInvalidOutputError, LLMUnavailableError):
        text = fallback_explanation(req.request, req.conflicts)
        return ExplainResponse(text=text, proposals=[], fallback=True, input_version=version)
    return ExplainResponse(text=text, proposals=_verify(req.request, proposals), fallback=False, input_version=version)
