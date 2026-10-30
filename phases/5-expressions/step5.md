# Step 5: llm-expr

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§1 ★1·★7, §2 식 언어, §2.5·§2.6 모양별 예, §4.1 translate, §4.3 explain)
- `/docs/ADR.md` (ADR-004, ADR-009 가명, ADR-019), `/docs/ARCHITECTURE.md` (LLM 호출 방식, LLM 출력 검증, API 계약)
- `/backend/llm/prompts.py`, `/backend/llm/translator.py`, `/backend/llm/explainer.py`, `/backend/llm/client.py`, `/backend/llm/pseudonym.py`
- `/backend/domain/models.py` (step 1의 `Rule`), `/backend/domain/convert.py`
- `/backend/tests/test_llm_translator.py`, `/backend/tests/test_llm_explainer.py`, `/backend/tests/test_routes.py`

## 배경

LLM의 역할이 "블록을 고르고 칸을 채우는 번역기"에서 **"수간호사의 말을 규칙 식으로 세우는 모델러이자 해설자"**로 바뀐다(ADR-019). 이 step은 translate 출력을 식 규칙으로, explain 완화를 **값·끄기·hardness 바꾸기**로 바꾼다. 예시 판정(step 6)과 eval(step 7)은 다음 step이다. 클라이언트는 step 9까지 블록을 보내므로, 이 step 이후 앱 화면은 잠시 동작하지 않아도 된다(기능 브랜치). 백엔드 테스트는 모두 통과해야 한다.

## 작업

**테스트를 먼저 쓴다(TDD).** LLM은 mock(`client.py`의 테스트 대역)으로만 테스트한다.

### 1. translate 출력 (`prompts.py`)
- `TranslatorOutput{rules: list[RuleDraft], config_changes, clarification_question, unsupported_reason}`. `RuleDraft` = `Rule`에서 `id`·`scope`·`enabled`·`default`를 뺀 것. `hardness`·`priority` 생략 가능.
- tool `input_schema`는 `TranslatorOutput.model_json_schema()`에서 만든다(ADR-003). 스키마가 재귀하지 않는지 테스트로 확인한다(`$ref` 순환 없음).
- `TRANSLATE_SYSTEM` 재작성:
  - 역할: "말을 최적화 규칙 식으로 세우는 모델러". 실행 코드를 쓰지 않고 tool 하나만 호출.
  - 생각 순서: ① 무엇마다 지키나(범위 `for_each`) → ② 무엇을 세나(`Count`: 누가·언제·무슨 근무·offset) → ③ 어떻게 비교하나(숫자·값 이름·다른 세기) → ④ 조건이 있나(`when`).
  - 숫자는 `values`에 이름(영문 소문자)과 한국어 label로 두고 `{"value": 이름}`으로 참조.
  - 모양별 예시: 설계 §2.5 변환표의 모든 모양(필요 인원 범위, 휴가, 희망·기피, 금지 순서, 최대·최소 연속, 나이트 뒤 휴무, 주 52시간, 7일 중 휴무, 고르게) + §2.6 새 예시(조건부, 짝 금지, 짝 같이, 세기끼리 비교, 요일 조건부 순서).
  - 병동 소개 문장(근무 형태 + 필요 인원 여러 개를 한 번에)은 `config_changes` + 필요 인원 규칙 여러 개로.
  - 유지: 날짜 해석, 가명, 인젝션 무시, priority 표현 규칙, clarify/unsupported. unsupported는 근무 시각 겹침, 하루 세 근무 이상, 코드보다 잘게 쪼갠 시간(교육·회의)뿐이다. **짝 규칙과 조건부는 더 이상 unsupported가 아니다.**

### 2. translate 검증 (`translator.py`, 재시도 ≤ 2)
- 순서: Pydantic → 설정 변경(지금 그대로) → 참조(간호사 id, 태그 ⊂ known_tags, 코드 ⊂ config ∪ config_changes, 날짜 범위, ValueRef ⊂ values, offset은 day·person_day 범위에서만) → 빈 대상(범위의 사람 0명·날 0일, 또는 Count.who가 사람 0명) → 싼 모순(day 범위의 then이 `Count ≥ n`이고 n이 who 대상 인원보다 큼).
- 빈 대상·모순은 지금처럼 재시도 메시지 후 clarify 질문. 셀렉터 평가는 `llm/`이 `solver/`를 import하지 않도록 translator 안의 작은 순수 함수로 둔다(지금 `_people`·`_days`처럼).
- `TranslateOk.constraints`는 식 규칙 목록. id는 지금 규칙대로 만든다.
- 테스트: 모양별 mock 출력이 카드로 나오는지, 빈 대상(없는 태그 대상)·모순·없는 ValueRef·offset 범위 오류가 재시도 후 clarify, 짝·조건부 출력이 ok.

### 3. explain (`explainer.py`, `models.py`)
- `ConstraintChange.action`에 `set_value{name, value}`, `set_hardness`를 더한다. 식 규칙에는 `disable | set_value | set_hardness`만 허용하고, 식 규칙에 대한 구조 변경(`update`의 params 교체)은 거부한다. 블록에 대한 `update`는 step 8까지 그대로 둔다.
- 검증: `name`이 그 규칙의 `values`에 있음, `value ≥ 0`, 바꾼 규칙이 `Rule` 검증 통과. 기존 규칙(나이트전담 기본 규칙 끄기 제안 거부, 휴가는 마지막 수단, 고정 칸 해제) 유지.
- `EXPLAIN_SYSTEM`에 식 읽는 법(범위·when·then·values)과 "완화는 값·끄기·가능하면으로만"을 넣는다. 컨텍스트의 충돌 규칙은 식 JSON + label 있는 values + `source_text`.
- 재풀이 검증 경로(`routes.py`)는 그대로 쓰되 `set_value`·`set_hardness`를 적용하는 함수를 더한다(routes에서 조합).

### 4. routes 테스트
- `/translate`가 식 규칙을 돌려주는지, `/explain`의 `set_value` 제안이 재풀이로 검증되는지(mock LLM + 실제 솔버).

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
uv run python eval/run.py --dry-run
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `llm/`이 `solver/`를 import하지 않는가? API 키·호출이 `backend/`에만 있는가? LLM 출력은 Pydantic·참조 검사를 통과한 것만 쓰는가(CLAUDE.md CRITICAL)? 프롬프트는 `prompts.py` 상수인가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(출력 스키마, 검증 순서, explain 변경 종류, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 실제 API 호출은 step 7에서 한다. 설계 문서에 없는 세부 결정은 summary에 `결정: …`으로 적는다.

## 금지사항

- 실제 Anthropic API를 호출하지 마라. 이유: 이 step의 테스트는 mock이고, 실제 정확도 확인은 step 7이다.
- LLM이 실행 코드나 재귀 식을 출력하게 하지 마라. 이유: ADR-019.
- explain이 식 규칙의 구조(범위·셀렉터·조건)를 바꾸는 제안을 허용하지 마라. 이유: 결정 ★7, 설명 가능성과 재풀이 검증 범위를 지킨다.
- `llm/`에서 `solver/`를 import하지 마라. 조합이 필요하면 `routes.py`에서 한다(CLAUDE.md CRITICAL).
- 기존 테스트를 깨뜨리지 마라.
