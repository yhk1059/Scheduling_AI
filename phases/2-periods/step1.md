# Step 1: period-domain

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ADR.md` (ADR-003, ADR-010, ADR-015)
- `/docs/ARCHITECTURE.md` (API 계약, 단일 스키마)
- `/backend/domain/models.py`, `/backend/domain/constants.py`
- `/backend/solver/model.py`, `/backend/solver/stats.py`, `/backend/solver/hard.py`, `/backend/solver/soft.py`
- `/backend/llm/translator.py`, `/backend/llm/explainer.py`, `/backend/llm/prompts.py`
- `/backend/routes.py`, `/backend/gen_types.py`, `/eval/run.py`, `/eval/dataset.jsonl`
- `/backend/tests/` 전체 (특히 `test_domain.py`, `test_routes.py`, `test_eval_runner.py`)
- `/lib/period.ts`, `/lib/period.test.ts` (step 0에서 만든 기간 순수 함수)
- `/lib/store.ts`, `/lib/csv.ts`, `/lib/samples/ward-15.json`, `components/` 중 `period`를 쓰는 파일

## 배경

ADR-015에 따라 `Period`를 `{ year, month }`에서 `{ start_date, length }`로 바꾼다. 솔버 내부는 계속 1..N 날짜 인덱스를 쓴다.
이 step은 **계약 변경 step**이다. 백엔드 모델이 바뀌면 `lib/types.gen.ts`가 바뀌고 프론트 컴파일이 깨지므로, 백엔드·eval·생성 타입·프론트 호출부를 한 번에 맞춘다.
단, 프론트는 **컴파일과 기존 동작 유지까지만** 한다. 화면 구조는 step 4~5에서 바꾼다. 번역 프롬프트의 의미 변경(월 경계를 넘는 날짜 해석)은 step 2에서 한다.

## 작업

**테스트를 먼저 고친다**(TDD): `test_domain.py`에 새 `Period` 검증 테스트를 추가하고, 기존 테스트의 `Period(year, month)` 사용을 새 모양으로 바꾼 뒤 구현한다.

### 1. `backend/domain/constants.py`
- `MAX_PERIOD_DAYS = 31` 추가

### 2. `backend/domain/models.py`
```python
Scope = Literal["ward", "period"]   # "month" → "period"

class Period(_Strict):
    start_date: date
    length: int = Field(ge=1, le=MAX_PERIOD_DAYS)

    @property
    def days(self) -> int: ...            # = length (솔버·검증 호출부 호환)
    def date_of(self, day: int) -> date: ...   # 1-based 인덱스 → 날짜
    def weekday(self, day: int) -> int: ...    # 0=월 … 6=일 (date.weekday 기준)
```
- 기존 `__init__(year, month)` 오버로드는 지운다.
- 주말 판정은 `period.weekday(day) >= 5 or day in holidays`로 통일한다.

### 3. 호출부 교체 (의미는 그대로, 기계적으로)
- `backend/solver/stats.py`의 `calendar.weekday(p.year, p.month, day)` → `request.period.weekday(day)`
- `backend/llm/translator.py`, `backend/llm/explainer.py`의 `date(period.year, period.month, d)` → `period.date_of(d)`. 컨텍스트 키는 일단 `target_month` 대신 `period_start`(ISO), `period_end`(ISO), `period_length`로 바꾸고 `first_day_weekday`는 `period_start`의 요일로 둔다. 프롬프트 문구 개편은 step 2에서 한다.
- `backend/llm/prompts.py`·translator의 scope 값 `"month"` → `"period"`
- `eval/run.py`의 `SCOPES = ("ward", "period")`, `eval/dataset.jsonl`의 `"scope": "month"` 21건 → `"period"`
- `lib/samples/ward-15.json`의 `period` → `{ "start_date": "2026-11-01", "length": 30 }`
- `npm run gen:types`로 `lib/types.gen.ts` 재생성 (직접 수정 금지)

### 4. 프론트 컴파일 맞추기 (동작 유지)
- `lib/store.ts`: 초기 기간은 `periodFrom("month", 오늘 다음 달 1일)`처럼 `lib/period.ts`로 계산해 지금처럼 "다음 달 전체"를 유지한다. `setFixed`의 source_text `M/D`는 `dateOfDay`로 계산한다. `isData`는 `period.start_date`/`length`를 확인한다. `STORAGE_VERSION`을 2로 올린다(기존 localStorage 데이터는 초기화해도 된다는 결정이 있다).
- `lib/csv.ts`: 요일·날짜 헤더를 `periodDays`로 계산한다. `csv.test.ts`의 기대값도 새 `Period`로 바꾼다.
- `components/`: `period.year`/`period.month`를 쓰는 곳(헤더 표기, 월 선택, 공휴일 달력, 그리드 aria-label, CSV 파일명)을 `lib/period.ts` 함수로 바꾼다. 월 선택 UI는 "달력 월 단위 기간 선택"으로 동작을 유지한다. 그리드 aria-label `"{이름} {M}월 {D}일 {코드}"`의 M은 날짜마다 계산한다.
- RulesStep 등에서 scope `"month"`를 쓰던 곳을 `"period"`로 바꾼다.

## Acceptance Criteria

```bash
npm run gen:types          # 재생성 결과(lib/types.gen.ts)를 변경에 포함
uv run pytest backend/tests -q
npm run test
npm run build && npm run lint
! grep -rnE 'scope.{0,4}"month"' backend eval lib components --include=*.py --include=*.ts --include=*.tsx --include=*.jsonl   # scope "month" 잔존 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `Period`가 `models.py` 한 곳에서 정의되고 TS 타입은 생성 스크립트로만 바뀌었는가?
   - `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가?
   - 솔버 내부가 여전히 1..N 인덱스로만 동작하는가?
3. `npm run dev`로 띄워 샘플 병동 → 생성까지 한 번 확인하고(LLM 불필요) 서버를 종료한다.
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 화면 구조(병동 홈, 탭, 스테퍼)를 바꾸지 마라. 이유: step 4~5의 범위다. 이 step은 계약 변경과 컴파일 유지만 한다.
- translator/explainer 프롬프트의 규칙 문장을 다시 쓰지 마라. 이유: step 2의 범위다. 키 이름과 scope 값만 바꾼다.
- `lib/types.gen.ts`를 손으로 고치지 마라. 이유: ADR-003 단일 스키마.
- Python 의존성을 추가하지 마라. 이유: ADR-007 번들 한도.
- 기존 테스트를 깨뜨리지 마라(기대값이 `Period` 모양 때문에 바뀌는 것은 고쳐도 된다).
