# Step 3: solver-conflicts

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/backend/domain/models.py` (`Conflict`, `SolveInfeasible`)
- `/backend/solver/model.py`, `/backend/solver/hard.py`, `/backend/solver/soft.py` (step 1, 2)

## 작업

해가 없을 때 원인이 된 hard 제약 집합을 찾는다. TDD로 진행한다(`backend/tests/test_solver_conflicts.py`).

### `backend/solver/conflicts.py`
```python
def find_conflicts(request: ScheduleRequest, time_limit_s: float = CONFLICT_TIME_LIMIT_S) -> list[Conflict] | None: ...
```
- step 1의 `hard_literals`와 assumptions 구조를 그대로 쓴다. INFEASIBLE이면 `solver.SufficientAssumptionsForInfeasibility()`로 리터럴 집합을 얻고, 제약 id → `Conflict(constraint_id, type, source_text)`로 변환한다.
- 충돌 집합을 작게 만들기 위해 core에 대해 deletion 기반 축소를 시도해도 된다. 단, 시간 예산(`CONFLICT_TIME_LIMIT_S`) 안에서만 한다.
- **고정 배정(`fixed_assignment`)과 휴가(`leave`)도 일반 hard 제약처럼 assumption에 포함된다.** 고정 칸끼리 또는 고정 칸과 규칙의 충돌도 원인으로 나와야 한다.
- 결과가 빈 집합이면 `[]`를 반환한다. 기본 제약만으로 불가능한 경우가 여기에 해당한다(UI가 직접 끄기로 안내한다).
- 시간 예산 초과로 판정하지 못하면 `None`을 반환한다.

### `solve()` 연동
- INFEASIBLE이면 `find_conflicts`를 호출한다.
  - 결과가 리스트(빈 리스트 포함)이면 `SolveInfeasible(conflicts=...)`를 반환한다.
  - 결과가 None이면 `SolveInfeasible(conflicts=[])`를 반환한다.
- solve 전체 시간은 `SOLVE_TIME_LIMIT_S + CONFLICT_TIME_LIMIT_S` 안에 끝나야 한다.

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
```

테스트는 최소한 다음을 포함한다.
- **정확한 충돌 집합**: 샘플 병동에 휴가를 과도하게 넣어 주말 `daily_coverage`를 못 맞추는 픽스처 → 반환된 constraint_id 집합에 해당 coverage 제약과 휴가 제약들이 포함되고, 무관한 제약(예: `max_consecutive_nights`)은 포함되지 않음
- **고정 칸 충돌**: `fixed_assignment` 같은 칸 D와 N → 두 제약 id가 모두 포함됨
- **고정 칸과 규칙 충돌**: 1일 N 고정 + 2일 D 고정 + `forbidden_sequence N→D` → 세 id 모두 포함
- **판정 실패 경로**: `find_conflicts`가 None을 반환하는 상황(monkeypatch로 주입) → `solve()`가 `SolveInfeasible(conflicts=[])`를 반환
- **나이트 전담 충돌**: 나이트 전담 간호사에게 D `fixed_assignment` → 그 제약 id가 충돌에 포함됨(기본 제약은 assumption이 아니므로 core에는 고정 배정만 나온다)
- `enabled=False`인 제약은 충돌에 나오지 않음

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - 충돌 분석이 시간 예산 상수를 쓰는가?
   - `backend/llm/`을 import하지 않는가?
3. `phases/1-mvp/index.json`의 step 3을 업데이트한다.

## 금지사항

- 충돌을 자연어로 설명하는 로직을 넣지 마라. 이유: 설명은 llm/explainer의 범위다(step 6).
- 제약을 하나씩 끄며 전수 탐색하는 방식만으로 구현하지 마라. 이유: 시간 예산을 넘긴다. assumptions core를 기반으로 하라.
- 기존 테스트를 깨뜨리지 마라.
