# Step 2: solver-soft-stats

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/PRD.md` (핵심 기능 2, 5: 통계), `/docs/ARCHITECTURE.md`, `/docs/ADR.md` (ADR-010)
- `/backend/domain/models.py`, `/backend/domain/constants.py`
- `/backend/solver/model.py`, `/backend/solver/hard.py`, `/backend/tests/test_solver_hard.py` (step 1)
- `/lib/samples/ward-15.json`

## 작업

soft 제약, 목적함수, 요약과 통계를 구현한다. TDD로 진행한다(`backend/tests/test_solver_soft_stats.py`).

### 1. `backend/solver/soft.py`
- `shift_preference`: 해당 날짜들에서 희망(prefer=True)이 지켜지지 않거나, 기피(prefer=False)한 근무가 배정되면 칸마다 weight만큼 페널티를 준다.
  - `days=None`이면 기간 전체가 대상이다. `weekends_only=True`이면 주말·공휴일만 대상이다.
- `night_fairness`: 나이트 전담을 **제외한** 간호사들의 N 개수 (최대 − 최소) × weight
- `weekend_fairness`: 전체 간호사의 주말·공휴일 근무(O 제외) 수 (최대 − 최소) × weight
- **soft로 토글된 템플릿 1~7**: 위반량에 비례하는 페널티 변수로 처리한다. 예: 인원 부족 수, 초과 연속 일수.
- soft 제약은 hard_literals를 만들지 않는다.
- 목적함수는 `ctx.objective_terms`의 합을 최소화한다.

### 2. `backend/solver/stats.py`
`compute_result(request, assignments, optimal) -> ScheduleResult`는 결정적 순수 함수다(솔버 변수를 쓰지 않는다).
- `stats`(간호사별)
  - D/E/N/O 개수
  - 주말·공휴일 근무 수(O 제외)
  - 최대 연속 근무(이월 포함하지 않음)
  - 희망 반영률: 그 간호사 대상 `shift_preference` 칸 중 지켜진 비율. 대상이 없으면 None
  - 평균 대비 편차: 근무일 수(O 제외) − 전체 평균
- `summary`
  - `preferences_total`, `preferences_met`: shift_preference 대상 칸 기준
  - `soft_violation_count`
- `soft_violations`: 지켜지지 않은 soft 제약을 칸 또는 제약 단위로 나열한다.

### 3. `solve()` 확장
- 해가 있으면 `compute_result`로 `SolveOk.result`를 채운다.
- 상태가 FEASIBLE(시간 제한 안에 최적 증명 실패)이면 `optimal=False`, OPTIMAL이면 True로 둔다.
- 공휴일(`holidays`)은 `is_weekend`에 이미 반영되어 있어야 한다. 주말 인원 기준과 주말 공정성 모두에 적용된다.

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
```

테스트는 최소한 다음을 포함한다.
- 희망 근무가 반영됨(충돌이 없을 때)
- 기피 근무가 배정되지 않음(가능할 때)
- 나이트 공정성 적용 시 비전담 간호사 간 N 개수 편차가 적용 전보다 작거나 같음
- 공휴일 날짜가 주말 인원 기준(`daily_coverage` weekend)을 따름
- `compute_result` 단위 테스트(손으로 만든 assignments로 통계 값 검증)
- **성능**: 샘플 병동(15명 × 30일)에 기본 규칙(금지 순서 N→D, N→E, E→D / 최대 연속 근무 5 / 연속 나이트 3 / N-OFF 2 / 최소 오프 8 / 숙련도 믹스 / 나이트·주말 공정성 / 희망 3건)을 넣고 31일 달(2026년 12월로 period 변경)에서 `solve()`가 **10초 안에** SolveOk를 반환

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - `stats.py`가 순수 함수인가?
   - 가중치는 `constants.DEFAULT_SOFT_WEIGHTS`와 제약의 weight를 쓰는가?
3. `phases/1-mvp/index.json`의 step 2를 업데이트한다.

## 금지사항

- 충돌 분석(unsat core)이나 재스케줄(diff)을 구현하지 마라. 이유: step 3, 4의 범위다.
- 성능 테스트를 통과시키려고 시간 제한 상수를 늘리지 마라. 이유: Vercel 함수 시간 예산이 정해져 있다(ADR-008). 모델링을 개선하라.
- 기존 테스트를 깨뜨리지 마라.
