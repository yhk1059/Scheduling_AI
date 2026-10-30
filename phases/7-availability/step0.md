# Step 0: availability-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/lib/store.ts`
- `/lib/rules.ts`
- `/backend/domain/models.py`
- `/docs/ARCHITECTURE.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

가능 시간을 근무표 요청에 넣는 순수 함수를 만든다. LLM과 DB를 거치지 않는다.

## 작업

테스트를 먼저 쓴다(TDD, vitest).

1. `lib/availability.ts`: `coversShift(ranges, shift) -> boolean`은 가능 시간이 근무조 시각을 완전히 덮는지 본다. 이어진 구간은 합쳐서 판단한다. 복합 코드는 `parts`가 모두 덮여야 한다.
2. `availabilityRules(employees, config, period, slotsByEmployee, fixedCells) -> Rule[]`: 직원 × 근무 코드마다 덮지 못하는 날을 금지하는 반드시 규칙이다. id는 `avail-{직원 id}-{코드}`, `source_text`는 "{이름} 가능 시간". 고정 칸은 뺀다. 가능 시간이 없는 직원은 휴무 말고 모두 금지다.
3. `store.ts`: 기간마다 `availability: { [employeeId]: slots }`를 두고, `toScheduleRequest`가 이 규칙을 더한다. 매장 조건에는 저장하지 않는다. `slots` 형식은 `{ "2026-11-02": [["09:00", "15:00"]] }`이다.
4. 입력 화면이 생기기 전까지 기존 흐름이 멈추지 않게, 기간에 `availability` 값이 아예 없으면 가능 시간 규칙을 더하지 않는다. 이 예외는 step 4(availability-ui)에서 지운다.
5. 백엔드 상한(`_check_limits`)이 `avail-` 규칙을 규칙 200개 상한에서 빼게 한다(테스트 먼저). 최악 입력을 `backend/bench.py`에 더한다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
npm run bench
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/7-availability/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 가능 시간 규칙을 LLM에 맡기지 마라. 이유: ADR-020.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
