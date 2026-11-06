# Step 5: restore-josa

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `backend/`는 TDD, `solver/`와 `llm/`은 서로 import 금지
- `/docs/ADR.md` — ADR-009(이름 가명화: LLM에는 employee.id만 보낸다)
- `/backend/llm/pseudonym.py` — `pseudonymize`, `restore`(`(?<![A-Za-z0-9_])e01(?![A-Za-z0-9_])` 꼴로 id를 이름으로 되돌린다), `_replace`
- `/backend/tests/test_pseudonym.py` — 테스트 방식
- `/backend/llm/explainer.py` — `restore(output.text, …)`, 제안의 `title`·`description`에도 `restore`
- `/backend/llm/translator.py` — `restore`를 `source_text`·`clarification_question`·`unsupported_reason`에 쓴다
- `/backend/llm/prompts.py` — `EXPLAIN_SYSTEM`의 "이름은 가명 id(예: e01)로 바뀌어 있다. 사람을 가리킬 때는 그 id를 그대로 쓴다", 번역 프롬프트의 가명 안내
- `/lib/wording.ts` — step 4의 `josa` 규칙(숫자 읽기, 영문자 읽기). 파이썬 구현이 **같은 규칙**이어야 한다

## 배경

LLM은 사람을 "e01"처럼 가명 id로 쓰고, 서버가 `restore`로 이름을 되돌린다. LLM은 id에 맞는 조사를 붙이므로("e01이", 1은 "일"로 받침 있음) 이름으로 바꾸면 조사가 어긋난다("김철수이 마감을 …"). 설명 문장(`text`), 제안 제목·설명, 되묻기 질문, 원문(`source_text`)이 모두 이 길을 지난다. 이 step은 `restore`가 이름을 되돌릴 때 **바로 뒤의 조사를 이름의 받침에 맞게 고치게** 한다. LLM 프롬프트는 바꾸지 않는다(결정적으로 고칠 수 있는 것을 LLM에 맡기지 않는다).

## 작업

TDD: `backend/tests/test_pseudonym.py`에 테스트를 먼저 더한다.

1. `backend/llm/pseudonym.py`:
   ```python
   _PARTICLES: list[tuple[str, str]] = [("이에요", "예요"), ("으로", "로"), ("이", "가"), ("은", "는"), ("을", "를"), ("과", "와")]  # (받침 있음, 받침 없음). 긴 것 먼저

   def has_final_consonant(word: str) -> bool | None:
       """마지막 글자(닫는 기호·공백은 건너뛴다)의 받침 여부. 한글은 받침, 숫자·영문자는 읽는 소리(step 4 lib/wording.ts josa와 같은 표). 판단 못 하면 None."""

   def fix_particle(name: str, following: str) -> str:
       """following이 조사로 시작하면 name의 받침에 맞는 쪽으로 바꾼 following. "으로/로"는 ㄹ 받침 뒤에서 "로"."""

   def restore(text: str, employees: list[Employee]) -> str:  # 시그니처 그대로. 이름으로 바꾼 뒤 바로 이어지는 조사를 fix_particle로 고친다
   ```
   - 조사는 이름 **바로 뒤**(공백 없이)에 올 때만 고친다. 조사 뒤에 한글이 더 이어지면(예: "e01이름"은 없겠지만 "e01은행") 고치지 않는다 — 조사 다음 글자가 공백·문장 부호·끝일 때만.
   - "이에요/예요"는 "이"보다 먼저 맞춘다(긴 것 먼저).
   - 조사가 이미 맞으면 그대로다. 이름 뒤에 조사가 아닌 말이 오면 그대로다.
   - `pseudonymize`(이름 → id)는 바꾸지 않는다. LLM 입력의 조사는 어긋나도 뜻을 바꾸지 않고, 데이터셋·eval이 그 입력에 묶여 있다.
   - 테스트: `restore("e01이 마감을 세 번 해요", …)` → "이영희가 마감을 세 번 해요"; "e02는" → "김민수는"; "e10을" → "최지훈을"; "e01으로" → "이영희로"; "e03은요" 같은 경계(조사 뒤 한글)는 그대로; 조사 없는 "e01 15~17일 휴가"는 그대로; 두 사람 "e01과 e02가" → "이영희와 김민수가"; 이미 맞는 조사는 그대로; 이름이 영문/숫자로 끝나는 직원("Kim2"처럼)은 읽는 소리 규칙.
2. `explainer.py`·`translator.py`는 바꾸지 않는다(`restore`를 이미 쓴다). 번역 결과의 `source_text`도 같은 혜택을 받는다는 것을 summary에 적는다.
3. eval(`eval/run.py`)은 돌리지 않는다. 판정이 의미 기준이고 `source_text`는 비교하지 않으므로 영향이 없다(확인해서 summary에 적는다. 영향이 있으면 돌리지 말고 `error`로 보고).

## Acceptance Criteria

```bash
uv run pytest backend/tests/test_pseudonym.py -q
npm test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `backend/llm/`이 `backend/solver/`를 import하지 않는가?
   - `restore`의 시그니처와 호출처가 그대로인가?
   - 받침 표가 step 4의 `lib/wording.ts` `josa`와 같은가(숫자·영문자)? 다르면 맞춘다.
   - 프롬프트(`prompts.py`)가 바뀌지 않았는가?
3. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(함수, 처리하는 조사 목록, eval 영향 없음 확인)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 프롬프트에 "조사를 맞춰라" 같은 지시를 더하지 마라. 이유: LLM은 id만 보고 이름을 모른다. 결정적 후처리가 맞는 자리다.
- `pseudonymize`를 바꾸지 마라. 이유: eval 데이터셋과 번역 입력이 지금 동작에 묶여 있다.
- 한국어 처리 패키지를 더하지 마라. 이유: 마지막 글자 규칙으로 충분하다(`requirements*.txt` 변경 없음).
- `eval/run.py`를 돌리거나 `eval/results.md`를 고치지 마라. 이유: 비용이 크고 이 step과 무관하다.
- 기존 테스트를 깨뜨리지 마라.
