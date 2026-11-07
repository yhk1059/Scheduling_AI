# Step 1: holidays-apply

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/phases/10-polish/index.json` — step 0의 summary
- `/lib/holidays.ts`, `/lib/holidays.test.ts` — step 0의 `holidayDays`, `holidayName`
- `/lib/store.ts` — `newPeriod`, `createPeriod`(첫 근무표는 시작일을 받고, 다음 근무표는 `upcomingRange`), `postponeStart`(공휴일을 날짜로 옮긴다), `toggleHoliday`, `WorkPeriod.holidays`
- `/lib/store.test.ts` — store 테스트 방식(phase 9 step 5에서 `createPeriod`·기본 규칙을 검사한 예)
- `/components/PeriodWork.tsx` — `PrepareSummary`("공휴일 n일" / "공휴일 없음"), `HolidayCalendar`, "날짜를 누르면 공휴일로 체크돼요. 주말과 같은 인원 기준을 써요"
- `/docs/UI_GUIDE.md` — "근무표 작성 › ① 가능 시간"(준비 요약 한 줄, 펼치면 공휴일 체크), "문구"
- `/docs/PRD.md` — J2 ① 준비
- `/e2e/fixtures/*.json` — 시드 매장의 `holidays`(고정값. 이 step이 바꾸지 않는다)

## 배경

step 0이 공휴일 상수와 `holidayDays`를 만들었다. 이 step은 **근무표를 만들 때** 그 기간의 공휴일을 자동으로 채우고, 매니저가 ①에서 고친 것은 그대로 두게 한다. 저장된 매장(이미 있는 근무표)의 공휴일은 건드리지 않는다.

## 작업

TDD: `lib/store.test.ts`에 테스트를 먼저 더한다.

1. `lib/store.ts`:
   - `newPeriod(range)`가 `holidays: holidayDays(range)`로 시작한다. `createPeriod`(첫 근무표·다음 근무표 모두)가 이것을 쓰므로 자동으로 채워진다.
   - `postponeStart`: 지금은 기존 공휴일을 날짜로 옮긴다. 이것을 **옮긴 뒤 새 기간의 `holidayDays`와 합친다**(합집합, 오름차순). 이유: 미룬 뒤 새로 들어온 날짜의 공휴일이 빠지지 않게. 매니저가 **뺀** 공휴일은 미루면 다시 들어올 수 있는데, 이 phase에서는 그것을 추적하지 않는다(summary에 `결정`으로 적는다).
   - `toggleHoliday`는 그대로(매니저가 고친 값이 최종이다).
   - 저장 문서를 읽을 때(`loaded`)와 확정 근무표는 바꾸지 않는다.
   - 테스트: 2026-12-15 시작 31일 근무표를 `createPeriod`로 만들면 holidays가 `[11, 18]`; 2026-11-02 시작 1주는 `[]`; `toggleHoliday`로 뺀 뒤 그대로 남는 것; `postponeStart`로 미룬 뒤 옮긴 공휴일과 새 공휴일이 합쳐지는 것.
2. `components/PeriodWork.tsx`:
   - `HolidayCalendar`의 도움말을 `"한국 공휴일은 자동으로 체크돼요. 날짜를 누르면 바꿀 수 있어요. 주말과 같은 인원 기준을 써요"`로 바꾼다.
   - 달력의 공휴일 버튼에 `title={holidayName(date) ?? undefined}`를 둔다(이름은 마우스를 올리면 보인다. 접근 가능한 이름 `"{M}월 {D}일 공휴일 지정/해제"`는 그대로 둔다 — e2e S6이 쓴다).
   - 준비 요약 한 줄("공휴일 n일")은 그대로다.
3. 2028년 이후 기간(상수 없음)에는 아무 안내도 두지 않는다("공휴일 없음"으로 보인다. 2027년 안에 상수를 늘린다는 메모를 `lib/holidays.ts` 머리에 두는 것으로 충분하다).

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 공휴일이 `WorkPeriod.holidays` 한 곳에만 있고 자동값과 수동값을 따로 저장하지 않는가(저장 문서 모양 불변)?
   - 저장된 근무표를 읽을 때 공휴일을 덮어쓰지 않는가?
   - `backend/`를 손대지 않았는가?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`, 시계가 2026-11이면): 매장 홈에서 다음 근무표를 시작해 ① 준비 요약에 "공휴일 n일"이 자동으로 보이고, [바꾸기]로 펼친 달력에 그 날이 체크돼 있고 title에 이름이 보인다. 하나를 눌러 빼면 "공휴일 n−1일". 환경이 없으면 summary에 "확인 못 함"을 적는다.
4. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **e2e에 영향을 적어라**: UI로 만든 근무표에 공휴일이 자동으로 들어가므로 12/25·1/1이 든 기간(S15 다음 근무표 등)의 주말·공휴일 칸 수와 필요 인원이 달라질 수 있다. 바뀐 문구(달력 도움말)도 적는다. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 저장 문서(`shops.data`)의 모양을 바꾸거나 `holidaysAuto` 같은 필드를 더하지 마라. 이유: 저장 문서는 `WorkPeriod.holidays` 하나로 충분하고, 마이그레이션이 없다.
- `e2e/fixtures/*.json`·`lib/seed-scenarios.ts`의 공휴일을 바꾸지 마라. 이유: 시드는 고정값이고 e2e 기대값이 거기에 묶여 있다. e2e 동기화는 마지막 step이 한다.
- 확정 근무표·저장된 작성 중 근무표의 공휴일을 자동으로 고치지 마라. 이유: 매니저가 이미 본 값이다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
