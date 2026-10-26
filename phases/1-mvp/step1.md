# Step 1: solver-hard

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md`, `/docs/ADR.md` (ADR-001, 006, 008, 010)
- `/backend/domain/models.py`, `/backend/domain/constants.py` (step 0)
- `/lib/samples/ward-15.json` (step 0)
- `/backend/solver/demo.py` (0-spike의 CP-SAT 사용 예시. 참고만 하고 수정하지 않는다)

## 작업

CP-SAT 모델의 기본 구조와 hard 템플릿 1~9를 구현한다. TDD로 진행한다. 템플릿마다 테스트를 먼저 쓴다(`backend/tests/test_solver_hard.py`).

### 1. `backend/solver/model.py`
```python
@dataclass
class ModelContext:
    model: cp_model.CpModel
    request: ScheduleRequest
    x: dict[tuple[str, int, str], cp_model.IntVar]   # (nurse_id, day, shift) → bool, day는 1-based
    hard_literals: dict[str, cp_model.IntVar]        # 제약 id → 활성 리터럴
    objective_terms: list                            # soft 페널티 (step 2에서 사용)
    def is_weekend(self, day: int) -> bool: ...      # 토·일 또는 holidays

def build_model(request: ScheduleRequest) -> ModelContext: ...
def solve(request: ScheduleRequest, time_limit_s: float = SOLVE_TIME_LIMIT_S) -> SolveOk | SolveInfeasible | SolveTimeout: ...
```
- **기본 제약**(무조건 적용)
  - 간호사마다 하루 정확히 1개 근무조
  - `night_only` 간호사는 N 또는 O만
- **hard 제약 구현 규칙(중요)**: `enabled=True`인 hard 제약마다 bool 리터럴 하나를 만들어 `hard_literals[c.id]`에 저장한다. 그 제약의 모든 식은 `OnlyEnforceIf(literal)`로 건다. 풀 때는 이 리터럴들을 `model.AddAssumptions`로 넘긴다. 이유: step 3에서 같은 구조로 충돌 원인(unsat core)을 찾는다.
- `enabled=False` 제약은 무시한다.
- `hardness="soft"`로 토글된 템플릿 1~7 제약은 이 step에서는 건너뛴다. step 2에서 페널티로 처리한다.
- **반환 규칙**
  - OPTIMAL 또는 FEASIBLE → `SolveOk`(이 step에서는 assignments만 채우고, summary/stats는 0이나 빈 값. step 2에서 채운다)
  - INFEASIBLE → `SolveInfeasible(conflicts=[])` (원인 분석은 step 3)
  - UNKNOWN(시간 초과) → `SolveTimeout`
- `max_time_in_seconds`를 반드시 설정하라.

### 2. `backend/solver/hard.py`
템플릿마다 `add_<type>(ctx, c, lit)` 함수를 하나씩 둔다.
- `daily_coverage`: 해당 `day_kind`(평일 / 주말·공휴일)의 날마다 shift 인원이 min..max
- `forbidden_sequence`: 연속한 두 날 (first, second) 금지. **이월 마지막 날 → 1일**도 검사한다.
- `max_consecutive_work`: O가 아닌 날이 `days`일을 넘게 연속되지 않도록 한다.
- `max_consecutive_nights`: N이 `days`일을 넘게 연속되지 않도록 한다.
- `min_days_off`: 기간 내 O 개수 ≥ days
- `off_after_night_block`: N 블록이 끝난 다음 `days`일은 O
- `skill_mix`: 그 shift의 날마다, `years >= min_years`인 간호사가 min_count명 이상
- `leave`: 해당 날짜는 O
- `fixed_assignment`: 해당 칸은 지정한 shift

### 3. 이월 경계 규칙
- 이월 근무(`carry_over`)는 변수가 아니라 상수 데이터다. 연속 계열 제약(2, 3, 4, 6)은 이월 구간과 대상 월을 이어서 검사한다.
- **이월 구간 안에서만 일어나는 위반은 검사하지 않는다.** 대상 월의 날짜를 하나 이상 포함하는 구간만 검사한다.
- 이월 길이는 `CARRY_OVER_DAYS` 이하다.

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
```

`test_solver_hard.py`는 템플릿마다 "해가 그 제약을 지킨다"를 결과 assignments로 검증한다. 추가로 다음을 포함한다.
- 나이트 전담은 N/O만 배정됨
- 이월 경계: 전월 말일 N + `forbidden_sequence N→D`이면 1일은 D가 아님. 이월 구간 안에서만 위반이면 여전히 해가 있음
- 명백히 불가능한 입력(같은 칸에 leave와 fixed_assignment D)은 `SolveInfeasible` 반환
- 샘플 병동(`lib/samples/ward-15.json`)이 해를 가짐

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - `backend/solver/`가 `backend/llm/`을 import하지 않는가?
   - 상수를 하드코딩하지 않았는가?
   - 테스트가 정확한 배정값이 아니라 제약 충족 여부를 검증하는가? (병렬 탐색이라 결과가 비결정적이다)
3. `phases/1-mvp/index.json`의 step 1을 업데이트한다.

## 금지사항

- soft 제약, 통계, 충돌 분석, 재스케줄을 구현하지 마라. 이유: step 2~4의 범위다.
- hard 제약을 `OnlyEnforceIf` 없이 직접 추가하지 마라. 이유: step 3의 충돌 분석이 깨진다(기본 제약만 예외).
- `backend/solver/demo.py`를 수정하거나 삭제하지 마라.
- 기존 테스트를 깨뜨리지 마라.
