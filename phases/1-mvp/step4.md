# Step 4: solver-reschedule

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/PRD.md` (저니 ⑥ 조정, ⑧ 월중 변경), `/docs/ARCHITECTURE.md`
- `/backend/domain/models.py` (`ScheduleRequest.previous`, `DiffCell`, `ScheduleResult.diff`)
- `/backend/solver/model.py`, `/backend/solver/soft.py`, `/backend/solver/stats.py`, `/backend/solver/conflicts.py`

## 작업

이전 해(`previous`)가 주어지면 최소 변경으로 다시 풀고 변경 칸을 반환한다. TDD로 진행한다(`backend/tests/test_solver_reschedule.py`).

- `request.previous`가 있으면, 이전 배정과 달라진 칸마다 `constants.DIFF_WEIGHT`만큼 페널티를 목적함수에 더한다.
- `DIFF_WEIGHT`는 soft 제약 가중치보다 충분히 크게 둔다. 그래야 기존 근무표가 크게 흔들리지 않는다. 필요하면 상수 값을 조정한다.
- **명단이나 기간이 바뀐 경우**: diff 페널티와 diff 계산은 `previous`와 현재 요청에 **공통으로 있는 nurse_id × 날짜**에만 적용한다. 새 간호사, 빠진 간호사, 범위를 벗어난 날짜는 무시한다.
- `ScheduleResult.diff`: `previous`가 있을 때만 `DiffCell` 목록을 채운다. 없으면 None이다.
- 수동 조정(칸 수정 + 고정)은 프론트가 `fixed_assignment` 제약을 추가해 보내는 방식이다. 솔버에 별도 경로를 만들지 않는다.

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
```

테스트는 최소한 다음을 포함한다.
- **병가 1건**: 샘플 병동 해를 previous로 두고 한 간호사에게 3일짜리 `leave` 추가 → 해가 있고, 변경 칸 수가 **12칸 이하**이며, `diff`가 실제 변경과 일치
- **고정 칸 수정**: previous에서 한 칸을 다른 근무로 `fixed_assignment` → 그 칸이 반영되고, 변경 칸이 소수로 유지됨
- **명단이 바뀐 previous**: previous에 없는 간호사가 추가되어도 오류 없이 풀리고, diff에 그 간호사가 포함되지 않음
- previous가 없으면 `diff is None`

## 검증 절차

1. AC를 실행한다.
2. 체크리스트를 확인한다.
   - 상수를 `constants.py`에서 가져오는가?
   - 기존 solver 테스트가 모두 통과하는가?
3. `phases/1-mvp/index.json`의 step 4를 업데이트한다.

## 금지사항

- 재스케줄 전용 솔버 함수를 따로 만들지 마라. 이유: 솔버 경로는 `solve()` 하나다(ARCHITECTURE의 "수동 조정" 패턴).
- 기존 테스트를 깨뜨리지 마라.
