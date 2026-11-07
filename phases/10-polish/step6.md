# Step 6: availability-drag-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/` 순수 함수는 TDD
- `/docs/ADR.md` — ADR-020(가능 시간은 LLM을 거치지 않는다), ADR-021(직원 링크)
- `/docs/PRD.md` — "직원 화면"(드래그로 칠한다, 칠한 칸에서 시작한 드래그는 지운다)
- `/docs/UI_GUIDE.md` — "직원 가능 시간 입력 › 캘린더 › 드래그"("같은 날 열 안에서만 칠한다" — 이 phase가 바꾼다)
- `/lib/availability.ts` — `cellKey`, `cellsFromSlots`, `slotsFromCells`, `applyDrag(base, date, start, end)`, `SLOT_COUNT`, `slotLabel`
- `/lib/availability.test.ts` — 테스트 방식
- `/lib/period.ts` — `periodDays`, `PeriodDay`
- `/components/AvailabilityForm.tsx` — `Calendar`의 드래그 상태(`drag.current = { base, date, start }`, `moveDrag`가 다른 열이면 무시), `PaintedSummary`. 이 step은 읽기만 한다

## 배경

직원 캘린더의 드래그는 날짜 열 하나 안에서만 칠해진다. 같은 시간을 여러 날에 넣으려면 날마다 다시 드래그해야 한다. 이 phase는 (1) **열을 건너 드래그**하면 직사각형(날짜 범위 × 시간 범위)을 한 번에 칠하거나 지우고, (2) 하루의 칠한 시간을 **다른 날에 복사**하는 한 동작을 둔다. 이 step은 **순수 함수만** 만든다. 화면은 step 7이다.

## 작업

TDD: `lib/availability.test.ts`를 먼저 고치고 더한다.

1. `lib/availability.ts`:
   ```ts
   /**
    * 드래그 한 번의 결과. 시작 칸(dates[0], start)이 비어 있으면 dates × [start..end] 직사각형을 칠하고, 칠해져 있으면 지운다.
    * dates는 시작 열부터 지금 열까지의 날짜(화면에 보이는 순서, 시작 열이 뒤에 있으면 뒤집힌 순서라도 된다). base는 드래그를 시작할 때의 칸이다.
    */
   export function applyDrag(base: Set<string>, dates: string[], start: number, end: number): Set<string>;

   /** from 날의 칠한 구간을 to 날들에 더한다(합집합. to의 기존 칸은 남긴다). from이 비어 있으면 그대로. from이 to에 있어도 된다. */
   export function copyDay(cells: Set<string>, from: string, to: string[]): Set<string>;
   ```
   - 기존 `applyDrag(base, date, start, end)` 호출은 `applyDrag(base, [date], start, end)`로 바꾼다(호출처는 `components/AvailabilityForm.tsx` 하나. 시그니처만 맞추고 동작은 step 7에서 바꾼다).
   - 지우기 판정은 **시작 칸 하나**로만 한다(지금과 같다). 직사각형 안에 칠한 칸과 빈 칸이 섞여 있어도 시작 칸 기준으로 전부 칠하거나 전부 지운다.
   - 테스트: 열 하나(기존 테스트 그대로), 열 셋 × 칸 넷 = 12칸 칠하기, 시작 칸이 칠해져 있으면 12칸 지우기(일부만 칠해져 있던 경우 포함), 뒤집힌 순서(`end < start`, dates 역순), `copyDay`로 월요일 09:00~15:00을 화·수에 복사(기존 화요일 칸 유지), from이 비어 있으면 변화 없음, from이 to에 포함.
2. `components/AvailabilityForm.tsx`는 시그니처 변경에 맞춘 최소 수정만 한다(`[d.date]`).

## Acceptance Criteria

```bash
npx vitest run lib/availability.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/availability.ts`가 `components/`·`lib/store.ts`를 import하지 않는가?
   - `slotsFromCells`/`cellsFromSlots`(제출 형식)가 바뀌지 않았는가? DB 함수·`submitAvailability`의 입력 모양이 그대로인가?
   - 화면 동작이 아직 그대로인가(열 하나만 칠한다)?
3. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(함수 시그니처, 지우기 판정 규칙)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 제출 형식(`AvailabilitySlots`)과 DB 함수(`submit_availability`)를 바꾸지 마라. 이유: 저장 모양은 그대로다. 칠하는 방법만 바뀐다.
- 화면(`AvailabilityForm.tsx`)의 드래그 동작을 이 step에서 바꾸지 마라. 이유: step 7이 한다. 시그니처만 맞춘다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라(옛 `applyDrag` 테스트는 새 시그니처로 옮긴다).
