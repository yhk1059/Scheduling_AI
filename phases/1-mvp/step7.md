# Step 7: api-routes

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md` (API 계약, 오류 코드 표, 시간 예산, 관측), `/docs/ADR.md` (ADR-004, 006, 008)
- `/backend/domain/models.py`, `/backend/domain/constants.py`
- `/backend/solver/model.py`(`solve`), `/backend/solver/conflicts.py`
- `/backend/llm/client.py`, `/backend/llm/translator.py`, `/backend/llm/explainer.py`, `/backend/env.py`
- `/backend/routes.py`, `/api/index.py`, `/backend/solver/demo.py`, `/backend/tests/test_spike.py` (0-spike 임시 코드)

## 작업

HTTP 계층과, solver·llm을 조합하는 오케스트레이션을 만든다. TDD로 진행한다(`backend/tests/test_routes.py`, FastAPI `TestClient`, LLM은 의존성 주입한 mock 클라이언트를 쓴다).

### 1. 0-spike 정리
- `backend/solver/demo.py`와 `/api/py/solve-demo`를 삭제한다.
- `test_spike.py`의 solve-demo 테스트를 삭제하고, health 테스트는 `test_routes.py`로 옮긴다.

### 2. `backend/routes.py`
- `GET /api/py/health` → `{"status": "ok"}`
- `POST /api/py/translate` → `translate()`
- `POST /api/py/solve` → `solve()`
- `POST /api/py/explain` → 아래 오케스트레이션
- 모든 성공 응답에 요청의 `input_version`을 그대로 담는다.
- LLM 클라이언트는 FastAPI 의존성(`get_llm_client`)으로 주입한다. 테스트에서는 `app.dependency_overrides`로 mock을 넣는다.
- 앱이 시작될 때 `load_local_env()`를 호출한다. 로컬 개발용이고, 이미 설정된 env는 덮어쓰지 않는다.

### 3. `/explain` 오케스트레이션 (이 파일에서만 solver와 llm을 조합한다)
1. `explain()`을 호출한다.
   - `LLMInvalidOutputError` 또는 `LLMUnavailableError`면 → `ExplainResponse(text=fallback_explanation(...), proposals=[], fallback=True)`
   - `LLMConfigError`는 500 `CONFIG_ERROR`로 처리한다.
2. proposal마다 changes를 요청 사본에 적용한다(`disable` → `enabled=False`, `update` → params/hardness 교체).
3. `solve(..., time_limit_s=PROPOSAL_VERIFY_TIME_LIMIT_S)`로 검증한다. `SolveOk`이면 `verified_summary`를 채워 남기고, 아니면 버린다.
4. 전체 검증 시간이 `PROPOSAL_VERIFY_TIME_LIMIT_S * MAX_PROPOSALS`를 넘으면 중단하고, 그때까지 검증된 것만 반환한다.

### 4. 오류 처리 (예외 핸들러 하나에서 `ErrorBody` 형식으로 변환)
| 조건 | HTTP | code |
|---|---|---|
| 간호사 > `MAX_NURSES`, 제약 > `MAX_CONSTRAINTS`, text > `MAX_TEXT_CHARS` | 413 | `PAYLOAD_TOO_LARGE` |
| Pydantic 검증 실패, 참조 무결성 실패 | 422 | `VALIDATION_ERROR` (message에 필드 경로나 제약 id) |
| `LLMInvalidOutputError` (translate) | 502 | `LLM_INVALID_OUTPUT` |
| `LLMUnavailableError` (translate) | 503 | `LLM_UNAVAILABLE` |
| `LLMConfigError` | 500 | `CONFIG_ERROR` |
| 그 외 예외 | 500 | `INTERNAL` (스택은 로그에만 남김) |

- 413 상한 검사는 Pydantic 검증보다 먼저 한다. raw JSON 크기를 확인하거나 별도로 가볍게 검사한다.
- 모든 요청에 `request_id`(uuid4)를 붙여 오류 응답과 로그에 넣는다.

### 5. 구조화 로그
- 요청마다 stdout에 JSON 한 줄을 남긴다: `request_id`, path, status, `duration_ms`, (LLM이면) `llm_retries`, `input_tokens`, `output_tokens`.
- **로그에 텍스트 원문, 간호사 이름, API 키를 남기지 마라.**

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
npm run gen:types && npm run build && npm run lint
```

`test_routes.py`는 최소한 다음을 다룬다.
- health
- solve: ok, infeasible(conflicts 포함), `input_version` 반환
- translate: ok, clarify, unsupported (mock)
- explain: 검증 통과 제안만 반환(해가 안 나는 제안 제거), LLM 실패 시 `fallback=True`
- 오류 코드별 1개 이상: 413 ×3종, 422, 502, 503, 500 CONFIG_ERROR, 500 INTERNAL. 모두 `ErrorBody` 형식과 request_id 포함
- 로그에 텍스트 원문이 없음(caplog 또는 capsys로 확인)

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - solver와 llm의 조합이 `routes.py`에만 있는가?
   - `api/index.py`는 import만 하는가?
3. 로컬 수동 확인: `npm run dev`를 실행하고 `curl -X POST localhost:3000/api/py/solve`에 샘플 병동 JSON(+input_version)을 보내 200을 확인한다. 확인 후 서버를 종료한다.
4. `phases/1-mvp/index.json`의 step 7을 업데이트한다.

## 금지사항

- 서비스 계층이나 추가 추상화 레이어를 만들지 마라. 이유: 오케스트레이션은 routes에 둔다(ADR-006).
- 메모리 기반 레이트 리밋을 만들지 마라. 이유: 서버리스에서 효과가 없다(ADR-011).
- 실제 API를 호출하지 마라.
- 기존 테스트를 깨뜨리지 마라(삭제 대상인 solve-demo 테스트는 예외).
