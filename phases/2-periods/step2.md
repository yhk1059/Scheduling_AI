# Step 2: translator-period

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ADR.md` (ADR-002, ADR-004, ADR-009, ADR-010의 날짜 해석, ADR-015)
- `/docs/ARCHITECTURE.md` (LLM 호출 방식, LLM 출력 검증)
- `/backend/domain/models.py` (step 1에서 바뀐 `Period.date_of`, `weekday`)
- `/backend/llm/prompts.py`, `/backend/llm/translator.py`, `/backend/llm/explainer.py`
- `/backend/tests/test_llm_translator.py`, `/backend/tests/test_llm_explainer.py`, `/backend/tests/test_eval_runner.py`
- `/eval/run.py`, `/eval/dataset.jsonl`, `/eval/results.md`

## 배경

기간이 `start_date + length`가 되면서 기간이 월 경계를 넘을 수 있다(예: 2026-11-23부터 2주). 사용자는 "12월 1일"처럼 달력 날짜로 말하고, 제약은 기간 안의 1..length 인덱스로 표현해야 한다. 이 step은 LLM이 그 변환을 할 수 있도록 컨텍스트와 프롬프트를 바꾸고, eval 데이터셋에 기간 케이스를 추가한다.

## 작업

**테스트를 먼저 작성한다**(LLM은 mock).

### 1. translator 컨텍스트 (`backend/llm/translator.py`)
`_context_message`가 보내는 JSON을 다음으로 바꾼다.
```json
{
  "today": "2026-11-20", "today_weekday": "Friday",
  "period": { "start": "2026-11-23", "end": "2026-12-06", "length": 14 },
  "days": [ { "day": 1, "date": "2026-11-23", "weekday": "Mon", "weekend": false }, ... ],
  "weekend_and_holiday_days": [6, 7, 13, 14],
  "holidays": [], "nurses": [...]
}
```
- `days`는 기간의 모든 날을 담는다(최대 31개). 공휴일이면 `weekend: true`.

### 2. 프롬프트 (`backend/llm/prompts.py` `TRANSLATE_SYSTEM`)
- "한 달", "월" 기준 표현을 "기간" 기준으로 바꾼다(템플릿 5 `min_days_off`: "기간당 최소 오프 일수", 템플릿 10의 days 생략 = "기간 전체").
- 날짜 해석 규칙을 추가한다: 사용자가 말한 날짜를 `days`의 `date`와 맞춰 `day` 인덱스로 바꾼다. "15일"처럼 월이 없으면 기간 안에서 그 일(日)이 하나뿐일 때만 그 날로 보고, 둘이거나 없으면 `clarification_question`으로 되묻는다. 기간 밖 날짜도 되묻는다.
- scope `"period"`는 "이번 기간에만 적용되는 요청"이라고 설명한다.

### 3. explainer 컨텍스트 (`backend/llm/explainer.py`)
- 병동 요약의 `target_month`/`days_in_month`를 `period`(start/end/length)로 바꾸고, 충돌 제약의 day 인덱스를 설명할 때 쓸 수 있도록 `days`(day, date)를 같이 보낸다. 설명 문장에는 "11/30"처럼 날짜로 쓰라고 `EXPLAIN_SYSTEM`에 적는다.

### 4. eval (`eval/run.py`, `eval/dataset.jsonl`)
- 케이스에 선택 필드 `period: { start_date, length }`를 둔다. 없으면 샘플 병동의 기간을 쓴다. `_request`와 데이터셋 검증 함수가 이를 반영한다.
- 월 경계를 넘는 2주 기간 케이스를 4개 이상 추가한다. 예: `period {2026-11-23, 14}`, "이영희 12월 1~3일 휴가" → leave days [9, 10, 11]; "박민수 11월 28일 나이트 고정" → fixed_assignment day 6; "김철수 15일 휴가"(기간에 15일이 없음) → clarify. 이름은 `lib/samples/ward-15.json` 명단에 있는 이름을 쓴다.
- `test_eval_runner.py`에 period 필드 처리 테스트를 추가한다.
- 실제 eval 실행(`uv run python -m eval.run`)은 API 비용이 들므로 이 step의 AC에 넣지 않는다. `eval/results.md`는 수정하지 않는다.

### 테스트가 최소한 다룰 것
- 컨텍스트 JSON에 `period`, `days`가 들어가고, 월 경계를 넘는 기간의 `date`가 올바른 것
- mock LLM이 기간 밖 day를 내면 기존 참조 무결성 경로로 clarify가 되는 것
- explainer 컨텍스트에 `period`와 `days`가 들어가는 것

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - LLM 출력이 여전히 Pydantic 검증과 참조 무결성 검사를 거치는가?
   - 가명 처리(ADR-009)가 새 컨텍스트에서도 유지되는가(이름 원문이 컨텍스트에 없는가)?
   - `backend/llm/`이 `backend/solver/`를 import하지 않는가?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 날짜→인덱스 변환을 서버 코드로 후처리하지 마라(LLM이 낸 day를 날짜로 재해석하는 등). 이유: 출력은 검증만 하고 고치지 않는다(ADR-004). 틀리면 재시도나 clarify로 간다.
- 템플릿 12개의 params 스키마를 바꾸지 마라. 이유: ADR-002, eval 비교 기준이 깨진다.
- 프론트엔드 파일을 수정하지 마라. 이유: 이 step은 backend/llm과 eval만 다룬다.
- 기존 테스트를 깨뜨리지 마라.
