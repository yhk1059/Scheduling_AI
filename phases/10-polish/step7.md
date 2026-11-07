# Step 7: availability-drag-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/phases/10-polish/index.json` — step 6의 summary
- `/lib/availability.ts` — step 6의 `applyDrag(base, dates, start, end)`, `copyDay`
- `/components/AvailabilityForm.tsx` — `Calendar`(드래그 상태 `drag.current`, `dragSpan`, 그림자 `span`, `startDrag`/`moveDrag`/`toggle`, 주 넘기기 `page`·`shown`), `PaintedSummary`("이번 주 칠한 시간" 카드: 요일마다 구간, 합계), 아래 고정 줄, `md:hidden` "PC에서 입력해 주세요" 문장
- `/docs/UI_GUIDE.md` — "직원 가능 시간 입력"(캘린더, 드래그, 두 열 배치, 아래 고정 줄), "버튼"(Text 버튼), "접근성 › 키보드", "문구"
- `/docs/PRD.md` — "직원 화면"
- `/docs/BROWSER_TEST_SCENARIOS.md` — S7(드래그 좌표와 칸 수를 세는 방식)
- `/e2e/test-helpers.ts` — `dragCells`(마우스로 두 칸 사이를 드래그한다. 이 동작이 그대로 통해야 한다)

## 배경

step 6이 직사각형 드래그와 복사 함수를 만들었다. 이 step은 직원 캘린더에서 (1) 열을 건너 드래그하면 직사각형을 칠하고, (2) "이번 주 칠한 시간" 카드의 날마다 [모든 날에 복사]를 둔다. 데스크톱(마우스) 기준이다. 폰 폭·터치 드래그는 이 phase의 범위가 아니다(UI_GUIDE "데스크톱 전용", "PC에서 입력해 주세요" 안내 유지).

## 작업

1. `components/AvailabilityForm.tsx` `Calendar`:
   - 드래그 상태를 `{ base, startDate, start }`로 두고, `moveDrag(date, slot)`에서 다른 열이면 무시하던 것을 **시작 열부터 지금 열까지의 날짜**(이번 주 `shown` 안에서, 순서 무관)로 `applyDrag(base, dates, start, slot)`를 부르게 한다. `dragSpan`에 `dates`(또는 시작·끝 열 인덱스)를 함께 두어 그림자 `span`이 `gridColumn: "{시작열} / {끝열+1}"`로 여러 열을 덮게 한다.
   - 주를 넘기면(`page` 변경) 드래그 상태를 버린다(마우스를 누른 채 [다음 주]를 누를 수는 없지만 안전하게).
   - 키보드 토글(`e.detail === 0`)과 한 칸 클릭은 그대로다.
   - `window` `mouseup`에서 끝내는 것은 그대로.
2. `PaintedSummary`: 구간이 있는 날의 줄 오른쪽에 Text 버튼 **[모든 날에 복사]**(`ui.textSm`, `aria-label="{M}월 {D}일 칠한 시간을 모든 날에 복사"`)를 둔다. 누르면 `copyDay(cells, 그날, 기간의 모든 날짜)`(이번 주만이 아니라 기간 전체. 2주 이상도 한 번에)로 바꾸고 `status`를 `idle`로 둔다. 잠겼으면(`locked`) 버튼을 두지 않는다. 구간이 없는 날에는 버튼이 없다. 복사 뒤 그 줄 글자를 2초간 "복사했어요"로 바꾸지 않는다(칸이 바로 칠해져 보인다).
   - `PaintedSummary`가 `cells`를 바꿀 수 있도록 `onCopy(date)` prop을 받는다(`Calendar`가 `setCells`한다).
3. 카드 아래 안내 두 줄("제출한 뒤에도…", "근무표가 확정되면 잠겨요") 위에 한 줄을 더한다: `"여러 날을 가로질러 드래그하면 한 번에 칠해져요"`(`text-xs text-[#66665E]`). 잠긴 뒤에는 없다.
4. 아래 고정 줄의 "{n}일 · {시간}시간 칠했어요"는 기간 전체 기준 그대로.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 제출 형식·`submitAvailability` 호출이 그대로인가?
   - 칸 `button`의 `aria-pressed`·`aria-label="{M}월 {D}일 {시작}~{끝}"`이 그대로인가(e2e S7이 쓴다)?
   - `useAppStore`를 쓰지 않는가(직원 화면)?
   - UI_GUIDE 색(칠한 칸 `bg-[#155E75]`, 드래그 그림자)과 Text 버튼 규격을 지켰는가? 이모지 없음?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`, 공용 링크를 로그인 없는 창 1280×800에서): 월 09:00 칸에서 수 15:00 칸까지 드래그 → 3열 × 12칸이 칠해지고 그림자가 3열을 덮는다. 칠한 칸에서 시작해 같은 범위를 드래그 → 지워진다. 한 열 안 드래그는 전과 같다. 카드의 [모든 날에 복사] → 다른 날에 같은 구간이 생기고 [다음 주]에도 보인다. 환경이 없으면 "확인 못 함".
4. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구·접근성 이름·버튼 위치를 적어라**([모든 날에 복사]의 이름, 새 안내 줄, 그림자 범위). e2e S7의 `dragCells`가 같은 열 드래그로 그대로 통하는지, 새 시나리오 줄이 필요한지 적는다. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 터치 이벤트·폰 레이아웃을 더하지 마라. 이유: UI_GUIDE "데스크톱 전용"과 "PC에서 입력해 주세요" 안내가 기준이다. 폰 입력은 따로 정한다.
- [평일에 복사] 같은 복사 종류를 늘리지 마라. 이유: 직사각형 드래그가 평일·주말 구분을 이미 해결한다. 한 동작만 둔다.
- 복사·드래그를 서버에 바로 보내지 마라. 이유: 저장은 [제출] 한 번이다(PRD).
- 칸 `button`의 역할·이름·`aria-pressed`를 바꾸지 마라. 이유: 키보드 접근성과 e2e S7.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
