# Step 0: domain-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (핵심 기능의 템플릿 12개, 통계, CSV)
- `/docs/ARCHITECTURE.md` (API 계약, 패턴, 시간 예산)
- `/docs/ADR.md` (ADR-002, 003, 010)
- `/backend/routes.py`, `/backend/solver/demo.py`, `/backend/tests/test_spike.py` (0-spike에서 만든 임시 코드. 이 step에서는 건드리지 않는다)

## 작업

Pydantic v2로 도메인 모델과 상수를 정의한다. 이 모델이 tool input_schema, 입력 검증, 솔버 입력, TS 타입의 단일 기준이다(ADR-003). TDD로 진행한다. `backend/tests/test_domain.py`를 먼저 작성하라.

### 1. `backend/domain/constants.py`
모든 상수를 여기에 둔다. 다른 모듈은 숫자를 하드코딩하지 말고 여기서 import한다.
```python
MAX_NURSES = 40
MAX_CONSTRAINTS = 200
MAX_TEXT_CHARS = 1000
CARRY_OVER_DAYS = 7
LLM_MAX_RETRIES = 2
LLM_TIMEOUT_S = 30
LLM_MAX_TOKENS = 2048
MAX_PROPOSALS = 3
SOLVE_TIME_LIMIT_S = 10
CONFLICT_TIME_LIMIT_S = 5
PROPOSAL_VERIFY_TIME_LIMIT_S = 3
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_SOFT_WEIGHTS: dict[str, int]  # shift_preference, night_fairness, weekend_fairness 각각의 기본 가중치
DIFF_WEIGHT: int                      # 재스케줄 시 변경 칸 1개당 페널티
```

### 2. `backend/domain/models.py`
- `ShiftCode = Literal["D", "E", "N", "O"]`
- `Nurse`: `id`(예: "n01", 명단 내 유일), `name`(유일), `years`(int ≥ 0), `night_only`(bool)
- `Period`: `year`, `month`. `days` 속성은 그 달의 일수(28~31)를 반환한다.
- 제약은 공통 필드를 가진 `type` 기반 **discriminated union** `ConstraintSpec`으로 정의한다.
  - 공통 필드: `id`(str), `type`, `scope: Literal["ward","month"]`, `hardness: Literal["hard","soft"]`, `weight: int`(> 0), `source_text: str`, `enabled: bool = True`
  - 템플릿 12개와 params(필드 이름은 아래를 따른다. day는 대상 월의 1-based 일자):

| # | type | params | 기본 hardness |
|---|---|---|---|
| 1 | `daily_coverage` | `shift`(D/E/N), `day_kind`("weekday"\|"weekend"), `min`, `max` | hard |
| 2 | `forbidden_sequence` | `first`, `second` (ShiftCode, 전날 → 다음날) | hard |
| 3 | `max_consecutive_work` | `days` | hard |
| 4 | `max_consecutive_nights` | `days` | hard |
| 5 | `min_days_off` | `days` (기간 전체) | hard |
| 6 | `off_after_night_block` | `days` (N 연속 블록이 끝난 뒤 최소 O 일수) | hard |
| 7 | `skill_mix` | `shift`(D/E/N), `min_years`, `min_count` | hard |
| 8 | `leave` | `nurse_id`, `days: list[int]` | **항상 hard** |
| 9 | `fixed_assignment` | `nurse_id`, `day`, `shift` | **항상 hard** |
| 10 | `shift_preference` | `nurse_id`, `shift`, `prefer: bool`(True 희망 / False 기피), `days: list[int] \| None`, `weekends_only: bool` | soft |
| 11 | `night_fairness` | 없음 (나이트 전담 제외 간호사 간 N 개수 편차 최소화) | soft |
| 12 | `weekend_fairness` | 없음 (주말·공휴일 근무 수 편차 최소화) | soft |

  - validator 규칙
    - `leave`와 `fixed_assignment`는 hardness가 무엇으로 들어와도 "hard"로 강제한다.
    - `min <= max`, `days >= 1`, `weight > 0`, `min_count >= 1`
- `CarryOverRow`: `nurse_id`, `shifts: list[ShiftCode]` (전월 말 최대 `CARRY_OVER_DAYS`일, 시간순)
- `Assignments = dict[str, list[ShiftCode]]` (nurse_id → 1~말일 근무)
- `ScheduleRequest`: `nurses`, `period`, `holidays: list[int]`, `constraints: list[ConstraintSpec]`, `carry_over: list[CarryOverRow] = []`, `previous: Assignments | None = None`, `input_version: int`
  - `model_validator`로 참조 무결성을 검사한다. 제약과 이월의 `nurse_id`가 명단에 있어야 하고, day가 1..days 범위여야 하며, holidays도 범위 안이어야 한다. 실패하면 어떤 제약 id가 문제인지 메시지에 담는다.
  - 상한(`MAX_NURSES`, `MAX_CONSTRAINTS`)은 여기서 검증하지 않는다. 413 처리는 routes에서 한다(step 7).
- 결과 모델
  - `NurseStats`: `D`, `E`, `N`, `O`, `weekend_holiday_work`, `max_consecutive_work`, `preference_rate: float | None`, `deviation: float`
  - `Summary`: `preferences_total`, `preferences_met`, `soft_violation_count`
  - `SoftViolation`: `constraint_id`, `nurse_id | None`, `day | None`, `detail`
  - `DiffCell`: `nurse_id`, `day`, `before`, `after`
  - `ScheduleResult`: `assignments`, `summary`, `stats: dict[str, NurseStats]`, `soft_violations`, `diff: list[DiffCell] | None`, `optimal: bool`
  - `Conflict`: `constraint_id`, `type`, `source_text`
- 응답 모델(`status` discriminated union, 모두 `input_version` 포함)
  - `SolveOk` / `SolveInfeasible(conflicts)` / `SolveTimeout`
- 번역과 설명 모델
  - `TranslateContext`: `nurses`, `period`, `holidays`, `today: date`
  - `TranslateRequest`: `text`, `scope`, `context`, `input_version`
  - `TranslateOk(constraints)` / `TranslateClarify(question)` / `TranslateUnsupported(reason)`
  - `ConstraintChange`: `action: Literal["disable","update"]`, `constraint_id`, `params: dict | None`, `hardness | None`
  - `RelaxationProposal`: `title`, `description`, `changes: list[ConstraintChange]`, `verified_summary: Summary | None`
  - `ExplainRequest`: `request: ScheduleRequest`, `conflicts`
  - `ExplainResponse`: `text`, `proposals`, `fallback: bool`, `input_version`
- `ErrorBody`: `error: { code, message, request_id }`

### 3. `lib/samples/ward-15.json`
샘플 병동 데이터를 만든다. 백엔드 테스트와 프론트가 함께 쓰는 단일 샘플이다.
- 가상의 한국 이름 15명, 연차는 1~15년으로 다양하게, 나이트 전담 2명
- `period`: 2026년 11월
- `holidays`: []
- 필요 인원을 `daily_coverage` 제약(scope "ward", hard)으로 넣는다. 예시는 평일 D 3~4 / E 3 / N 2, 주말 D 3 / E 2 / N 2. 기본 규칙만으로 해가 나오는 값이어야 한다.
- 다음 이름을 반드시 포함한다(데모 저니에서 쓴다): 이영희, 박민수, 김철수, 정유진, 최지훈
- `ScheduleRequest`로 검증을 통과해야 한다(`input_version` 0).

### 4. `backend/gen_types.py`와 `lib/types.gen.ts`
- `gen_types.py`는 최상위 모델(ScheduleRequest, Solve 응답, Translate 요청/응답, Explain 요청/응답, ErrorBody)의 JSON Schema를 모아 `json-schema-to-typescript`(npm devDependency로 추가)로 `lib/types.gen.ts`를 만든다.
- `package.json`에 `"gen:types": "uv run python -m backend.gen_types"` 스크립트를 추가한다.
- `lib/types.gen.ts`는 반드시 이 스크립트로 생성하라. Write나 Edit 도구로 직접 만들지 마라(TDD 가드 훅이 막는다).

## Acceptance Criteria

```bash
uv run pytest backend/tests -q        # test_domain.py 포함 전체 통과
npm run gen:types && test -s lib/types.gen.ts
npm run build && npm run lint
```

`test_domain.py`는 최소한 다음을 검증한다.
- 템플릿 12개의 직렬화 왕복
- leave와 fixed_assignment의 hard 강제
- 잘못된 params 거부(min > max, days 0, weight 0)
- 참조 무결성 실패(없는 nurse_id, 범위 밖 day)
- 샘플 JSON 검증 통과
- `Period(2026, 2).days == 28`

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다.
   - 상수는 모두 `constants.py`에 있는가?
   - 런타임 Python 의존성을 추가하지 않았는가?
3. `phases/1-mvp/index.json`의 step 0을 업데이트한다.
   - summary에 핵심 모델 이름과 파일 경로, 샘플 JSON 경로를 담는다.

## 금지사항

- `requirements.txt`에 패키지를 추가하지 마라. 이유: Vercel Python 번들 한도 여유가 약 30MB뿐이다(ADR-007).
- 솔버나 LLM 로직을 만들지 마라. 이유: 이후 step의 범위다.
- `backend/solver/demo.py`, `/api/py/solve-demo`를 지우지 마라. 이유: step 7에서 정리한다.
- 기존 테스트를 깨뜨리지 마라.
