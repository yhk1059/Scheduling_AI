# Step 4: llm-blocks

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§4 해 없음 설명, §5 LLM 출력과 검증, §5.3 설정 변경 카드, §2.5 변환표)
- `/docs/ADR.md` (ADR-004, ADR-006, ADR-009 가명, ADR-018)
- `/docs/ARCHITECTURE.md` (API 계약)
- `/backend/llm/prompts.py`, `translator.py`, `explainer.py`, `pseudonym.py`, `/backend/routes.py`
- `/backend/domain/models.py`, `convert.py`, `constants.py` (step 1~3)
- `/backend/tests/test_llm_translator.py`, `test_llm_explainer.py`, `test_routes.py`

## 배경

솔버가 블록을 풀 수 있게 됐다. 이제 LLM이 템플릿 대신 **블록과 설정 변경만** 출력하게 바꾼다. 결과는 여전히 검증을 통과한 제안 카드다(ADR-004). 클라이언트는 아직 옛 타입이라 이 step 뒤 실제 앱의 규칙 입력은 step 7까지 동작하지 않을 수 있다. 이 phase는 기능 브랜치에서 끝까지 진행한 뒤 합치므로 괜찮다.

## 작업

**테스트를 먼저 쓴다(TDD).** LLM은 mock한다.

### 1. translate 출력 (`prompts.py`, `translator.py`)
- `TranslatorOutput`(설계 §5.1): `constraints: list[BlockDraft]`(count | sequence | balance만. 템플릿과 fixed_assignment는 LLM 출력에서 뺀다), `config_changes: list[ShiftChange]`, `clarification_question`, `unsupported_reason`.
- `BlockDraft`는 블록에서 `id, scope, enabled, weight`를 뺀 것. `hardness`, `priority`는 생략 가능(기본값은 step 1과 같다).
- `TranslateOk`에 `config_changes: list[ShiftChange] = []`를 더한다. `ShiftChange`(`action: add | update`, `shift: ShiftDef`)는 `models.py`에.
- 프롬프트(`TRANSLATE_SYSTEM`)를 다시 쓴다:
  - 근무 코드는 고정 목록이 아니라 context의 `config.shifts`(코드, 이름, 시간, parts)다. 복합 코드의 의미.
  - 블록 3종, 셀렉터 문법(People/Days/Shifts, `in`/`not_in`을 언제 쓰는지: "나이트 다음 날은 휴무" 같은 규칙은 `not_in`으로 써서 새 코드에도 적용되게).
  - 설계 §2.5의 모양별 예시(필요 인원, 연차 배치, 최소 휴무, 휴가, 희망·기피, 금지 순서, 연속 근무, 연속 나이트, 나이트 다음 휴무(after), 고르게 2종)와 새 예시(태그 배치, 주 52시간, 7일 중 휴무, 나이트 블록 최소 길이, 요일).
  - 중요도 표현("제일 중요", "웬만하면", "되도록이면 꼭")→ priority. hard/soft 판정 규칙은 지금과 같게.
  - 설정 변경: "미드 근무 M 11시~19시 추가", "D+E 더블 허용" → `config_changes`. 새 코드를 쓰는 규칙은 같은 응답의 블록으로 함께 낸다. 코드 삭제는 하지 않는다.
  - 지원하지 않는 것(unsupported): 하루 세 근무 이상, 사람 사이 짝 규칙(같이·따로), 근무 시각 겹침 계산.
  - 날짜 해석, 가명, 인젝션 무시 규칙은 지금 것을 유지한다.
- context에 `config.shifts`, 명단의 `tags`, 병동 태그 목록(`known_tags`)을 넣는다. 가명화는 지금과 같다(태그는 치환하지 않는다).

### 2. 검증 (`translator.py`, 설계 §5.2, 재시도 ≤ 2)
- Pydantic → 참조 무결성(간호사 id, 태그는 `known_tags`에, 코드는 `config ∪ config_changes`, 날짜 범위) → **빈 대상 검사**(셀렉터가 이번 기간·명단에서 사람 0명 또는 날 0일이면 clarify) → **싼 모순 검사**(count per=day의 min이 대상 인원보다 크면 clarify).
- 참조·빈 대상·모순 오류는 지금처럼 재시도 메시지에 넣고, 재시도 뒤에도 남으면 사용자에게 되묻는 `clarify`로 돌려준다.
- `ShiftChange` 검증: 코드 중복(`add`인데 이미 있음 → 오류), parts 참조, 상한(`MAX_SHIFT_CODES`).
- 서버가 채우는 값: id, scope, enabled, weight(priority로부터).

### 3. explain (`explainer.py`, `prompts.py`, `routes.py`, 설계 §4)
- 입력 conflicts에 블록 params와 `source_text`, context에 `config.shifts`를 넣는다.
- `ConstraintChange.params`는 params **최상위 키 단위 교체**(셀렉터는 통째로)로 병합한다. 병합 결과는 Pydantic + 참조 무결성을 통과해야 하고, routes에서 지금처럼 재풀이로 검증한다.
- 프롬프트: "한 사람의 근무를 막는 기간 요청(휴가)은 마지막 수단", "고정 칸 충돌은 해제 제안", "`나이트전담` 태그 대상 규칙을 끄자는 제안은 하지 않는다". 템플릿 이름 대신 블록 설명.
- 대체 경로(`fallback_explanation`)는 그대로 `source_text`를 쓴다.

### 4. 테스트
- translator: 블록 출력 정상, config_changes + 딸린 블록, 없는 코드 참조 → 재시도 → clarify, 없는 태그 → clarify, 빈 대상 → clarify, 인원 모순 → clarify, unsupported, priority 기본값, 가명 복원.
- explainer: 블록 update 병합(셀렉터 교체), 잘못된 병합 거부, 나이트전담 규칙 disable 제안 거부(필터링).
- routes: `/translate` 응답에 `config_changes`, `/explain` 제안 검증 경로.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `llm/`이 `solver/`를 import하지 않는가(ADR-006)? 프롬프트는 `prompts.py`의 상수인가? tool `input_schema`는 Pydantic에서 생성되는가(ADR-003)? LLM 출력이 검증 없이 쓰이는 경로가 없는가?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 실제 Anthropic API를 테스트에서 부르지 마라. 이유: `npm run test`는 mock으로만 돈다. 실제 호출은 step 5의 eval에서 한다.
- `eval/`을 바꾸지 마라. 이유: step 5의 범위다(이 step 뒤 `eval/run.py`의 기대값 비교가 맞지 않아도 된다. 단 `npm run test`에 포함된 `test_eval_runner.py`는 통과해야 한다. 필요하면 그 테스트가 쓰는 비교 함수만 블록도 받게 넓힌다).
- 클라이언트(`lib/`, `components/`, `app/`)를 바꾸지 마라.
- 기존 테스트를 깨뜨리지 마라(템플릿 출력을 기대하던 LLM 테스트는 블록 기대값으로 바꾼다).
