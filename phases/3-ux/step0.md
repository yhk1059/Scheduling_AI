# Step 0: sample-schedules

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (**J7 샘플 병동**, 핵심 기능 1·2)
- `/docs/ADR.md` (ADR-007 Python 의존성, ADR-008 시간 예산, ADR-015)
- `/lib/samples/ward-15.json` (지금 샘플: 간호사 15명, 필요 인원 6개만 있고 병동 규칙 없음)
- `/backend/domain/models.py` (`ScheduleRequest`, `Period`, `ConstraintSpec`, `ScheduleResult`, `SolveResponse`)
- `/backend/solver/model.py` (`solve`)
- `/backend/gen_types.py` (생성 스크립트의 선례: `python -m backend.gen_types`, `npm run gen:types`)
- `/package.json` (scripts)

## 배경

2026-10-29 UX 점검에서 샘플로 근무표를 만들면 나이트 전담 2명이 30일 연속 나이트, 휴무 0일이 나왔다. 샘플에 병동 규칙이 하나도 없어서다. 또 샘플이 다음 달 초안 하나만 만들어서, 이월·최근 4주 부담·운영 중 변경 같은 반복 사용 기능을 체험할 수 없었다.
PRD J7에 따라 샘플은 **오늘이 속한 달의 확정 근무표(운영 중)** 와 **다음 달 작성 중 근무표(요청 적용됨)** 를 가진다. 날짜는 오늘 기준으로 바뀌므로, 확정 근무표를 샘플을 열 때마다 솔버로 풀면 최대 10초를 기다려야 한다. 그래서 **가능한 달 모양 28개(길이 28~31 × 1일 요일 7)의 확정 근무표를 미리 계산해 JSON으로 둔다.**
이 step은 데이터와 생성 스크립트, 검증 테스트만 만든다. 샘플을 store에 싣는 것은 step 3이다.

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_sample_schedules.py`

### 1. 샘플 병동 규칙과 요청 (`lib/samples/ward-15.json`)
- 기존 `nurses`, 필요 인원(`daily_coverage` 6개)은 유지한다.
- `constraints`에 병동 규칙(scope `"ward"`)을 더한다. `source_text`는 수간호사 말투로 쓴다.
  | type | hardness | params | source_text 예 |
  |---|---|---|---|
  | `off_after_night_block` | hard | days 1 | "나이트 끝나면 다음 날은 무조건 쉬게" |
  | `max_consecutive_work` | hard | days 5 | "6일 연속 근무는 안 돼요" |
  | `max_consecutive_nights` | hard | days 3 | "나이트는 3번 연속까지만" |
  | `min_days_off` | hard | days 8 | "한 달에 최소 8일은 쉬게" |
  | `night_fairness` | soft | | "나이트는 골고루" |
  | `weekend_fairness` | soft | | "주말 근무도 골고루" |
- `next_requests`(새 키)에 다음 달에 적용할 요청 3개를 둔다(scope `"period"`, 날짜는 기간 인덱스 1..N). 기간 길이 28일에서도 유효한 날짜만 쓴다.
  - 휴가(`leave`, hard): 이영희(n01) 10~12일
  - 기피(`shift_preference`, soft): 박민수(n02) 주말·공휴일 N 기피
  - 희망(`shift_preference`, soft): 한 명의 특정 날짜 D 희망(예: 정유진 20일 D)
- 나머지 키(`period`, `holidays`, `carry_over`, `previous`, `input_version`)는 지금 쓰는 곳(eval 등)이 있으면 유지한다. 지울 때는 참조를 grep으로 확인한다.

### 2. 생성 스크립트 (`backend/gen_sample.py`, `npm run gen:sample`)
- `lib/samples/ward-15.json`의 간호사와 병동 규칙으로, 아래 28개 조합마다 `ScheduleRequest`를 만들어 `backend.solver.model.solve`로 푼다.
  - 길이 `L ∈ {28, 29, 30, 31}`, 1일 요일 `W ∈ {0..6}`(월=0). `Period.start_date`는 그 조합을 만족하는 실제 날짜 아무거나(예: 2026~2030년에서 찾기) 쓴다. 공휴일 없음, 이월 없음, 요청 없음.
- 결과를 `lib/samples/confirmed-schedules.json`에 `{ "L-W": ScheduleResult }` 형태로 쓴다(`SolveResponse`의 결과 부분 그대로. 프런트에서 `ScheduleResult` 타입으로 쓸 수 있어야 한다). 키 예: `"31-3"`.
- 결정적이어야 한다: 솔버 파라미터에 고정 시드와 단일 워커를 지정하거나, 그와 같은 방법으로 다시 돌려도 같은 파일이 나오게 한다. 시간 제한은 조합당 `SOLVE_TIME_LIMIT_S` 이내.
- 해가 없으면 스크립트를 실패시킨다. 규칙 값(예: `min_days_off`)을 조정해야 하면 조정하고 그 사실을 summary에 적는다.
- `package.json`에 `"gen:sample": "uv run python -m backend.gen_sample"`를 추가하고, 스크립트를 실행해 JSON을 커밋 대상에 둔다.
- 모듈 위치: `backend/gen_sample.py`. `backend/solver/`와 `backend/llm/` 사이 import 규칙을 지킨다(이 모듈은 solver만 쓴다).

### 3. 검증 테스트 (`backend/tests/test_sample_schedules.py`)
- 28개 키가 모두 있다.
- 각 조합에서 근무표의 날짜 수가 L이고 간호사 15명이 모두 있다.
- 각 조합의 근무표가 샘플 병동 규칙(필요 인원 + hard 규칙)을 모두 지킨다. 방법은 재량이다. 예: 모든 칸을 `fixed_assignment`로 고정한 요청을 다시 풀어 해가 있는지 확인.
- 나이트 전담 간호사도 휴무가 8일 이상이고, 최대 연속 근무가 5일 이하다(UX 점검의 회귀 테스트).
- 테스트가 너무 느려지면(28개 재풀이) 조합 일부를 대표로 골라도 된다. 단 4가지 길이는 모두 포함한다.

## Acceptance Criteria

```bash
npm run gen:sample && git diff --exit-code lib/samples/confirmed-schedules.json   # 다시 돌려도 같은 결과
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(첫 번째 줄은 JSON을 만든 뒤 한 번 더 실행해 결정성을 확인한다. 커밋 전이면 `git diff` 대신 두 번 생성한 파일을 비교한다).
2. 아키텍처 체크리스트를 확인한다:
   - Python 의존성을 추가하지 않았는가(ADR-007)?
   - `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가?
   - 생성 결과 JSON 크기를 summary에 적었는가(번들에 들어간다)?
3. 결과에 따라 `phases/3-ux/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (최종 규칙 값, JSON 크기 포함)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 샘플 로드(store, 컴포넌트)를 고치지 마라. 이유: step 3의 범위다.
- 샘플에 공휴일을 넣지 마라. 이유: 날짜가 오늘 기준으로 바뀌므로 특정 날짜 공휴일은 맞지 않는다.
- 런타임에 솔버를 불러 샘플을 만드는 방식으로 바꾸지 마라. 이유: 샘플은 네트워크 없이 즉시 열려야 한다.
- 기존 테스트를 깨뜨리지 마라.
