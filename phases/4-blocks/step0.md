# Step 0: golden-record

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (이 phase 전체의 설계. 특히 §2.5 변환표, §10 구현 순서)
- `/docs/ADR.md` (ADR-018)
- `/backend/domain/models.py`, `/backend/domain/constants.py`
- `/backend/solver/model.py` (`build_model`, `solve`), `/backend/solver/hard.py`, `/backend/solver/soft.py`
- `/lib/samples/ward-15.json` (샘플 병동: 명단 15명, 필요 인원, 병동 규칙 6개)
- `/backend/gen_demo.py` (생성 스크립트의 선례)

## 배경

이 phase는 템플릿 12종을 범용 블록 3종으로 바꾼다(ADR-018). 기본값은 지금 동작과 같아야 하고, 기존 병동은 블록으로 바꾼 뒤에도 **같은 목적값**이 나와야 한다.
그 비교 기준을 만들려면 **지금 솔버**의 결과를 블록화 전에 기록해 둬야 한다. 이 step은 기록만 하고, 솔버·모델은 바꾸지 않는다.

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_golden.py`

### 1. 골든 케이스 생성 스크립트 (`backend/gen_golden.py`, `python -m backend.gen_golden`)
- 케이스를 코드에 정의하고, 지금 솔버로 풀어 `backend/tests/golden/cases.json`에 쓴다. 케이스마다:
  - `id`, `description`, `request`(지금 형식의 `ScheduleRequest` JSON: 템플릿 제약)
  - `history_raw`: `history_load`를 쓰는 케이스는 직전 28일의 원본 배정(`{start_date, rows: {nurse_id: [code×28]}, holidays: [date…]}`)을 고정 시드로 만들고, `history_load`는 이 원본에서 계산해 넣는다(나이트 = N 수, 주말 = 토·일·공휴일의 근무 수). 나중에 블록 요청은 숫자 대신 이 원본을 쓴다. `history_load`가 없는 케이스는 `null`.
  - `status`(ok / infeasible), `optimal`, `objective`(정수), `assignments`, infeasible이면 `conflict_ids`
- 목적값은 `build_model`로 모델을 만들고 hard 리터럴을 참으로 고정한 뒤 `CpSolver`로 풀어 `ObjectiveValue`를 읽는다(`solve()`와 같은 방식, 단일 워커·고정 시드). 솔버 모듈에 기능을 더하지 말고 스크립트 안에서 한다.
- **feasible 케이스는 모두 OPTIMAL이어야 한다.** 시간 안에 최적이 증명되지 않으면 그 케이스를 작게 줄인다(사람 수·기간). 스크립트는 OPTIMAL이 아니면 실패한다.
- 케이스 구성(모든 템플릿과 hard/soft 토글을 덮는다):
  1. 샘플 병동(`ward-15.json`)의 필요 인원 + 병동 규칙 6개, 2주(14일), 공휴일 1일, 이월(carry_over) 있음, `history_load` 있음
  2. 같은 병동, 1주(7일), 요청: 휴가 1건, 주말 나이트 기피(`weekends_only`), 특정일 데이 희망, 고정 배정 1건
  3. 작은 병동(6~8명, 7~10일)에서 템플릿 1~7을 각각 soft로 토글한 케이스(한 케이스에 몇 개씩 묶어도 된다)
  4. `forbidden_sequence`(N→D), `off_after_night_block` days=2, `skill_mix`, `min_days_off`, 나이트 전담 간호사 포함 케이스
  5. 공휴일이 평일에 있는 케이스(주말 판정 = 토·일 ∪ 공휴일)
  6. 재스케줄: `previous`가 있는 케이스(DIFF_WEIGHT 반영)
  7. infeasible 케이스 2개(예: 휴가가 겹쳐 필요 인원을 못 채움, 나이트 전담 + 나이트 금지 요청). `conflict_ids` 기록
- 같은 스크립트를 두 번 돌리면 같은 파일이 나와야 한다(결정적).
- `--check` 옵션: 파일을 쓰지 않고 다시 만들어 기존 `cases.json`과 비교한다. 다르면 exit 1.

### 2. 테스트 (`backend/tests/test_golden.py`)
- `cases.json`의 모든 `request`가 `ScheduleRequest`로 검증된다.
- feasible 케이스는 지금 솔버로 다시 풀면 같은 `objective`가 나온다(목적값 비교. 배정은 동점 해가 있을 수 있으니 비교하지 않는다).
- 기록된 `assignments`는 그 케이스의 모든 hard 제약을 만족한다(각 칸을 `fixed_assignment`로 고정해 다시 풀면 feasible).
- infeasible 케이스는 다시 풀어도 infeasible이다.
- 전체 테스트 시간이 60초를 넘지 않게 케이스 크기를 조절한다.

### 3. package.json
- `"gen:golden": "uv run python -m backend.gen_golden"` 스크립트를 추가한다.

## Acceptance Criteria

```bash
uv run python -m backend.gen_golden --check
npm run test
npm run build && npm run lint
```

## 검증 절차

1. `uv run python -m backend.gen_golden`으로 파일을 만든 뒤 위 AC 커맨드를 실행한다(`--check`는 생성이 결정적인지 확인한다).
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? 솔버 코드를 바꾸지 않았는가?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(케이스 수, 각 케이스 크기, 생성 시간)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- `backend/solver/`, `backend/domain/models.py`, `backend/llm/`을 바꾸지 마라. 이유: 이 step은 지금 동작의 기록이다.
- 케이스를 OPTIMAL로 만들려고 시간 제한을 늘리지 마라. 이유: 케이스를 줄이는 것이 맞다. 골든 테스트가 느려진다.
- Python 의존성을 추가하지 마라(ADR-007).
