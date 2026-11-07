# Step 0: golden-blocks

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§2.5 변환표, §8 마지막 줄 골든, §9)
- `/docs/ADR.md` (ADR-018, ADR-019)
- `/backend/gen_golden.py`, `/backend/tests/test_golden.py`, `/backend/tests/golden/cases.json`, `/backend/tests/golden/convert-cases.json`
- `/backend/tests/blocks.py`, `/backend/tests/test_solver_blocks.py`
- `/backend/domain/convert.py`, `/backend/solver/model.py`

## 배경

phase 5는 블록 3종(count·sequence·balance)을 **규칙 식**(ADR-019) 하나로 바꾼다. 바꾼 뒤에도 기존 병동은 같은 근무표가 나와야 하므로, 이 step에서 **지금 블록 솔버의 결과를 골든으로 기록**한다. 이후 step 3·8이 블록 → 식 변환 결과를 이 기록과 비교한다. 이 step은 기록만 하고 솔버·모델은 바꾸지 않는다.

## 작업

**테스트를 먼저 쓴다(TDD).**

### 1. 블록 골든 케이스 (`backend/tests/golden/blocks-cases.json`)
- 케이스 = `{ "id", "request": ScheduleRequest(블록 형식, JSON), "expected": solve_case 결과 }`.
- 포함할 케이스:
  - 기존 `cases.json`의 9케이스를 `convert_request`(+ `history_raw`)로 바꾼 블록 요청(지금 `test_golden`이 하는 변환과 같게).
  - 블록 기능 케이스 8개 이상: M 코드 추가, DE 더블 커버, 주 52시간(person_week, hours), 7일 창(person_window), run.min_len, sequence.after then_off 2, 태그 배치(책임 1명 이상), hard balance(max_gap), soft count(희망·기피), soft sequence(forbid). 작은 병동(6~8명 × 7~10일)으로 1초 안에 풀리게 만든다. 이미 `test_solver_blocks.py`에 같은 픽스처가 있으면 `backend/tests/blocks.py` 빌더를 재사용한다.
- 모든 feasible 케이스는 OPTIMAL이어야 한다(아니면 병동을 줄인다). infeasible 케이스 1개 이상(conflict_ids 기록).

### 2. 생성·검사 (`backend/gen_golden.py`)
- `npm run gen:golden`이 `convert-cases.json`과 함께 `blocks-cases.json`을 쓴다. `--check`는 둘 다 다시 만들어 기존 파일과 비교한다(다르면 exit 1).
- `solve_case`(단일 워커, 고정 시드)를 그대로 쓴다.

### 3. 테스트 (`backend/tests/test_golden.py`)
- `blocks-cases.json`의 각 요청을 지금 솔버로 다시 풀어 status·목적값이 같은지, 기록된 배정이 hard 블록 위반 0인지(`stats.violations`) 확인한다.

## Acceptance Criteria

```bash
npm run gen:golden -- --check
npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 상수는 `constants.py`에 있는가? `solver/`와 `llm/`이 서로 import하지 않는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(케이스 수·이름, 생성 시간, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 솔버·도메인 모델의 동작을 바꾸지 마라. 이유: 이 step의 산출물은 "지금 동작"의 기록이다.
- `cases.json`과 `convert-cases.json`의 내용을 바꾸지 마라. 이유: 이전 phase들의 기준이다.
- 풀이가 1초를 넘는 케이스를 넣지 마라. 이유: `npm run test`가 매 step 돈다.
- 기존 테스트를 깨뜨리지 마라.
