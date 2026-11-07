# Step 2: solver-blocks

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§2.3·§2.4 블록 의미, §2.6 중요도·시간 정규화, §3 솔버 변경)
- `/backend/domain/models.py`, `/backend/domain/convert.py`, `/backend/domain/constants.py` (step 1)
- `/backend/solver/model.py`, `hard.py`, `soft.py`, `stats.py`, `conflicts.py`
- `/backend/tests/test_solver_*.py`, `/backend/tests/test_golden.py`, `/backend/tests/golden/cases.json`

## 배경

step 1에서 블록 모델과 변환 함수가 생겼다. 이 step은 솔버가 블록을 풀게 한다. 템플릿 경로는 아직 남겨 두고(step 6에서 지움) **블록 경로를 더한다.** 핵심 완료 기준은 골든 케이스를 블록으로 바꿔 풀어도 목적값이 같은 것이다.

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_solver_blocks.py`, `backend/tests/test_golden.py`(블록 비교 추가)

### 1. 대상 고르기 (`backend/solver/select.py`, 순수 함수)
- `people(request, sel) -> list[nurse_id]`, `days(request, sel) -> list[int]`, `matches(config, code, shifts_sel) -> bool`, `codes_matching(config, shifts_sel) -> list[str]`.
- 주말 = 토·일 ∪ 공휴일(`stats.is_weekend`와 같은 정의). `weekday` = 주말이 아닌 날, `holiday` = 체크한 공휴일.
- 이력(`history`) 원본에서 같은 셀렉터로 세는 함수: `history_count(request, people_id, days_sel, shifts_sel, measure)` — 이력 날짜의 요일·공휴일은 `history.start_date`와 `history.holidays`로 판정한다.

### 2. 모델 골격 (`model.py`)
- 변수 `x[n, d, c]`의 `c`는 `request.config`의 **활성** 코드다(기본 config면 지금과 같은 D/E/N/O). `SHIFTS` 상수 대신 config를 쓴다.
- `add_exactly_one`, 나이트 전담 기본 제약, DIFF_WEIGHT는 그대로.
- `ModelContext`에 `match(nurse_id, day, shifts_sel)`(변수 합 또는 이월 상수)와 `minutes(nurse_id, day, shifts_sel)` 도우미를 둔다.

### 3. 블록 hard/soft (`hard.py`, `soft.py`에 블록 함수 추가, 설계 §3)
- count: 묶음(per)마다 합에 범위. `person_week`는 달력 주(월~일), 기간 첫 주는 이월 칸 포함. `person_window`는 연속 `window`일. `measure=hours`는 분 단위 정수로 계산하고, soft 위반량은 `기본 근무 시간(constants, 8h)`으로 나눈 단위(정수 반올림 규칙은 constants에 주석으로).
- sequence.forbid: 패턴·시작일마다 `Σ match ≤ len−1`. sequence.run: max_len은 지금 `_max_run`과 같은 식, min_len은 길이 L < min_len인 구간 금지(기간 끝에 닿는 구간 제외). sequence.after: 지금 `off_after_night_block` 절을 셀렉터로 일반화.
- balance: soft는 `_spread`와 같은 식 + `history_count`(with_history일 때), hard는 (최대 − 최소) ≤ max_gap.
- 블록은 모두 hard/soft 전환 가능. `ADDERS`에 type `count`, `sequence`, `balance`를 등록한다.

### 4. 결과·통계 (`stats.py`)
- 블록의 soft 위반 목록을 계산한다(설계 §2.7 일반 문구 "{묶음} {값} (기준 {범위})", 코드 이름은 config). 솔버 식과 같은 의미여야 한다(같은 `select.py` 사용).
- `NurseStats`에 `counts: dict[str, int]`, `hours: float`를 **더한다**(D/E/N/O 필드는 step 6까지 유지, 기본 config 밖 코드는 counts에만).
- `preferences_*`: 템플릿 `shift_preference`와 함께, "한 사람·기간 범위·soft 세기 블록"도 희망·기피로 센다(설계 §2.5 끝).
- 위반 판정 함수는 eval(step 5)이 재사용할 수 있게 `violations(request, assignments, constraint) -> list[SoftViolation]` 형태의 공개 함수로 둔다. hard 블록에도 쓸 수 있어야 한다.

### 5. 골든 동등성 (`test_golden.py`에 추가)
- 모든 골든 케이스를 `convert_request`로 바꾸고, 케이스의 `history_raw`가 있으면 그것을 `history`로 넣어 블록으로 푼다:
  - feasible → OPTIMAL이고 `objective`가 골든과 같다. 기록된 골든 `assignments`가 변환된 hard 블록을 모두 만족한다.
  - infeasible → 여전히 infeasible.
- 변환 결과의 공유 픽스처 `backend/tests/golden/convert-cases.json`을 만든다(템플릿 제약 → 변환된 블록 JSON. 12종과 토글·옵션 조합 전부, 나이트 전담 규칙 포함). step 7의 TS 변환이 이 파일과 같은 결과를 내야 한다. 생성은 `python -m backend.gen_golden`에 포함하고 `--check`로도 비교한다.

### 6. 새 기능 테스트(설계 §10 2단계)
- M 코드 추가(필요 인원 블록이 M을 센다), DE 복합 코드(D 인원과 E 인원에 모두 들어감, DE ≤ 2 per person), 주 52시간(hours, person_week, 이월 포함), 7일 중 휴무 1일(person_window), 나이트 블록 최소 2일(run.min_len), 나이트 끝나면 2일 휴무(after), 태그 배치(책임 태그 매일 데이 1명 이상), hard balance(max_gap), 요일 셀렉터(토요일만), 고르게 + history 원본.
- infeasible 블록이 unsat core(`find_conflicts`)에 id로 나온다.

## Acceptance Criteria

```bash
uv run python -m backend.gen_golden --check
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `solver/`가 `llm/`을 import하지 않는가? 상수(분 단위, 정규화 기준 시간, 가중치)는 `constants.py`에 있는가? 템플릿 경로의 결과가 바뀌지 않았는가(기존 솔버 테스트 그대로 통과)?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(골든 동등성 결과 포함)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 골든 `cases.json`의 기대값(objective)을 고치지 마라. 이유: 지금 동작의 기록이다. 목적값이 다르면 변환이나 블록 식이 틀린 것이다.
- 템플릿 경로를 지우지 마라. 이유: step 6에서 지운다.
- LLM(`backend/llm/`)과 클라이언트를 바꾸지 마라.
- 시간 예산 상수(`SOLVE_TIME_LIMIT_S` 등)를 바꾸지 마라.
- 기존 테스트를 깨뜨리지 마라.
