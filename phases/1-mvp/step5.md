# Step 5: llm-translator

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md` (패턴: LLM 호출 방식, LLM 출력 검증, 가명 처리), `/docs/ADR.md` (ADR-002, 004, 009, 010, 011)
- `/backend/domain/models.py` (`ConstraintSpec`, `TranslateRequest`, `TranslateOk/Clarify/Unsupported`), `/backend/domain/constants.py`
- `/lib/samples/ward-15.json`

## 작업

자연어를 제약 스펙으로 번역하는 LLM 계층을 만든다. **테스트는 모두 mock 클라이언트로 한다. 실제 API를 호출하지 마라.** TDD로 진행한다(`backend/tests/test_llm_translator.py`, `test_pseudonym.py`, `test_env.py`).

### 1. `backend/env.py`
```python
def load_local_env(path: str = ".env.local") -> None: ...
```
- 파일이 있으면 `KEY=VALUE` 줄을 읽어 `os.environ`에 넣는다. 이미 설정된 키는 덮어쓰지 않는다.
- 주석, 빈 줄, 따옴표로 감싼 값을 처리한다. 파일이 없으면 아무것도 하지 않는다.
- 외부 패키지(python-dotenv 등)를 쓰지 않는다.

### 2. `backend/llm/client.py`
```python
class LLMClient(Protocol):
    def call_tool(self, *, system: str, messages: list[dict], tool: dict) -> ToolCallResult: ...
    # ToolCallResult: tool_input(dict | None), stop_reason, input_tokens, output_tokens

class AnthropicClient:  # 실제 구현
    def __init__(self, model: str | None = None): ...
```
- 모델은 env `ANTHROPIC_MODEL`을 쓰고, 없으면 `constants.DEFAULT_MODEL`을 쓴다.
- `tool_choice={"type": "tool", "name": tool["name"]}`로 tool 호출을 강제한다. `max_tokens=LLM_MAX_TOKENS`, 타임아웃은 `LLM_TIMEOUT_S`. 스트리밍은 쓰지 않는다.
- SDK 예외를 도메인 예외로 바꾼다.
  - 인증 실패, 키 없음 → `LLMConfigError`
  - 429/529/5xx/타임아웃/연결 실패 → `LLMUnavailableError`
- 키 값을 로그나 예외 메시지에 넣지 마라.

### 3. `backend/llm/pseudonym.py`
```python
def pseudonymize(text: str, nurses: list[Nurse]) -> str: ...      # 이름 → nurse.id
def restore(text: str, nurses: list[Nurse]) -> str: ...           # nurse.id → 이름
```
- 치환 대상은 **성명 전체**와, 명단에서 **유일한 이름(성을 뺀 부분)**이다. 긴 이름부터 치환한다.
- 여러 명이 공유하는 이름(성 제외)은 치환하지 않는다.

### 4. `backend/llm/prompts.py`
- 번역용 system 프롬프트와 tool 정의를 상수로 둔다.
- tool `submit_constraints`의 `input_schema`는 Pydantic 모델에서 생성한다(ADR-003). 손으로 JSON을 쓰지 마라.
  - 구성: `constraints`(id·enabled 없이 type·hardness·params·source_text), `clarification_question`(선택), `unsupported_reason`(선택)
- 프롬프트에 포함할 내용
  - 템플릿 12개의 의미
  - hard/soft 판정 규칙: "무조건, 절대, 반드시" → hard / "가능하면, 되도록, 희망" → soft / 표현이 없으면 템플릿 기본값
  - 날짜 해석 규칙: 대상 월과 오늘 날짜 기준. "다음 주 수요일", "15~17일", "3주차"
  - 명단에 없는 사람, 모호한 표현이면 `clarification_question`을 쓸 것
  - 템플릿으로 표현할 수 없으면 `unsupported_reason`을 쓸 것

### 5. `backend/llm/translator.py`
```python
def translate(req: TranslateRequest, client: LLMClient) -> TranslateOk | TranslateClarify | TranslateUnsupported: ...
```
1. `text`를 가명 처리한다. context(가명 id, 연차, 나이트 전담, 대상 월, 일수, 주말·공휴일 날짜, 오늘)와 함께 tool 호출을 한다.
2. 응답 처리
   - `unsupported_reason`이 있으면 → Unsupported
   - `clarification_question`이 있으면 → Clarify(질문을 이름 복원해서 반환)
   - 그 외에는 constraints마다 서버가 `id`(uuid4 앞 8자리), `scope`(요청값), `enabled=True`를 채워 `ConstraintSpec`으로 검증한다. 검증 범위는 Pydantic 검증, 참조 무결성(nurse_id ∈ 명단, day ∈ 1..days), weight 기본값(soft는 `DEFAULT_SOFT_WEIGHTS`, hard는 1)이다.
3. **실패 처리**: 검증 실패, tool_use 없음, `stop_reason == "max_tokens"`이면 오류 메시지를 user 턴에 추가해 **최대 `LLM_MAX_RETRIES`회 재시도**한다. 그래도 실패했을 때는 아래와 같이 처리한다.
   - 명단 밖 nurse_id나 범위 밖 날짜가 원인이면 → Clarify(무엇이 문제인지 한국어로)
   - 그 외에는 `LLMInvalidOutputError`
4. 반환 전에 `source_text`와 질문의 가명을 이름으로 되돌린다.
5. 빈 constraints이면서 질문도 사유도 없으면 → Clarify("어떤 규칙인지 조금 더 구체적으로 알려 주세요" 류)

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
```

mock 테스트는 최소한 다음 케이스를 다룬다.
- 정상 번역(규칙 2개, hard/soft 판정 포함)
- leave의 hardness가 soft로 와도 hard로 강제됨
- 첫 응답 스키마 위반 → 재시도 후 성공(재시도 메시지에 오류 내용 포함)
- 재시도 소진 → `LLMInvalidOutputError`
- 명단 밖 nurse_id → Clarify
- 범위 밖 날짜(32일) → 재시도 → Clarify
- `max_tokens` 중단 → 재시도
- clarification_question → Clarify(이름 복원)
- unsupported_reason → Unsupported
- 가명 처리: 성명 전체, 유일 이름 치환, 공유 이름 미치환, 복원 왕복
- SDK 예외 매핑(401 → Config, 429/529/timeout → Unavailable). 실제 SDK 예외 클래스를 mock으로 던져서 확인
- `load_local_env`: 기존 env를 덮어쓰지 않음, 따옴표와 주석 처리

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - `backend/llm/`이 `backend/solver/`를 import하지 않는가?
   - 테스트가 네트워크를 쓰지 않는가?
   - 키를 출력하는 코드가 없는가?
3. `phases/1-mvp/index.json`의 step 5를 업데이트한다.

## 금지사항

- 실제 Anthropic API를 호출하지 마라. 이유: 비용이 들고 결과가 비결정적이다. 실제 호출은 step 9(eval-run)에서만 한다.
- `.env.local` 내용을 출력(cat, print, 로그)하지 마라. 이유: API 키가 들어 있다.
- LangChain 등 LLM 프레임워크나 python-dotenv를 추가하지 마라. 이유: 런타임 의존성 추가 금지(ADR-007).
- 기존 테스트를 깨뜨리지 마라.
