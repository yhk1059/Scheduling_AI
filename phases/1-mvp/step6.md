# Step 6: llm-explainer

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md` (패턴: 결정적 대체 경로), `/docs/ADR.md` (ADR-004)
- `/backend/domain/models.py` (`Conflict`, `RelaxationProposal`, `ConstraintChange`, `ExplainResponse`)
- `/backend/llm/client.py`, `/backend/llm/prompts.py`, `/backend/llm/pseudonym.py`, `/backend/llm/translator.py` (step 5)

## 작업

충돌을 자연어로 설명하고 완화 제안 후보를 만든다. **이 모듈은 솔버를 모른다.** 제안 검증(재풀이)은 step 7의 routes에서 한다. 테스트는 mock 클라이언트로 TDD한다(`backend/tests/test_llm_explainer.py`).

### `backend/llm/explainer.py`
```python
def explain(request: ScheduleRequest, conflicts: list[Conflict], client: LLMClient) -> tuple[str, list[RelaxationProposal]]: ...
def fallback_explanation(request: ScheduleRequest, conflicts: list[Conflict]) -> str: ...
```
- **`explain`**
  - 충돌 제약들(id, type, hardness, params, source_text)과 병동 요약(인원, 대상 월, 주말·공휴일 날짜)을 가명 처리해 tool `submit_explanation`으로 호출한다. tool 스키마는 Pydantic에서 생성하고, `prompts.py`에 둔다.
  - 출력은 `text`(2~4문장의 한국어 설명)와 `proposals`(최대 `MAX_PROPOSALS`개)다. 각 proposal은 `title`, `description`, `changes`(`disable` 또는 `update`)로 구성된다.
  - 프롬프트 지시
    - 휴가(`leave`)는 가능한 한 마지막 수단으로 제안한다.
    - 고정 배정 충돌이면 고정 해제(`disable`)를 제안한다.
    - `update`는 같은 템플릿의 params만 바꾼다.
  - **후처리 규칙**
    - `changes`가 conflicts에 없는 constraint_id를 참조하면 그 proposal을 버린다.
    - `update`의 params가 해당 템플릿 검증을 통과하지 못하면 그 proposal을 버린다.
  - 스키마 위반이면 `LLM_MAX_RETRIES`회까지 재시도한다. 그래도 실패하면 `LLMInvalidOutputError`를 던진다.
  - 텍스트의 가명을 이름으로 되돌린다.
- **`fallback_explanation`**: LLM 없이 결정적으로 문장을 만든다.
  - 예: "다음 규칙들이 동시에 지켜질 수 없습니다: “주말 D 최소 3명”, “이영희 15~17일 휴가” …"
  - conflicts가 비었으면 "원인을 특정하지 못했습니다. 규칙을 하나씩 꺼서 확인해 주세요."
  - routes에서 LLM이 실패했을 때 이 함수를 쓴다.

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
```

mock 테스트는 최소한 다음을 다룬다.
- 정상 설명과 제안 3개
- 존재하지 않는 id를 참조한 제안 제거
- 잘못된 params의 update 제안 제거
- 제안이 3개를 넘으면 잘림
- 재시도 후 성공, 재시도 소진 시 예외
- 이름 복원
- `fallback_explanation`: 일반 케이스와 빈 conflicts 케이스

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - `backend/llm/explainer.py`가 `backend/solver/`를 import하지 않는가?
3. `phases/1-mvp/index.json`의 step 6을 업데이트한다.

## 금지사항

- explainer 안에서 솔버를 호출해 제안을 검증하지 마라. 이유: solver와 llm은 서로 import하지 않는다(CLAUDE.md CRITICAL). 검증은 routes에서 한다.
- 실제 API를 호출하지 마라.
- 기존 테스트를 깨뜨리지 마라.
