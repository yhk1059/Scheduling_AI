# Step 3: sample-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (**J7 샘플 병동**, J0 끝, J4)
- `/docs/ARCHITECTURE.md` ("상태 관리")
- `/lib/samples/ward-15.json`, `/lib/samples/confirmed-schedules.json` (step 0: 병동 규칙, `next_requests`, `"L-W"` 키의 확정 근무표 28개)
- `/lib/store.ts`, `/lib/store.test.ts` (`loadSample`, `newPeriod`, `confirm`, `WorkPeriod`, `PeriodVersion`, `snapshot`, `isSample`)
- `/lib/period.ts` (`firstPeriodStart`, `periodFrom`, `nextPeriod`), `/lib/continuity.ts` (`historyLoadFor`, `carryOverFrom`, `isOperating`)
- `/components/StartScreen.tsx` (샘플 버튼)

## 배경

PRD J7: 샘플 병동은 열자마자 반복 사용 상태를 보여 준다. **오늘이 속한 달은 확정된 근무표(운영 중)**, **다음 달은 요청이 적용된 작성 중 근무표**다. 확정 근무표는 step 0이 미리 계산해 둔 28개 중 오늘이 속한 달의 모양(길이-1일 요일)에 맞는 것을 고른다. 솔버 호출 없이 즉시 열린다.

## 작업

**테스트를 먼저 쓴다(TDD).** `lib/sample.test.ts`, 필요하면 `lib/store.test.ts`

### 1. `lib/sample.ts` (순수 함수)
```ts
export function buildSample(today: string, makeId: () => string): { ward: Ward; periods: WorkPeriod[] };
```
- 병동: 이름 "샘플 병동", 단위 `month`, 간호사 15명(모두 활성), 병동 규칙 = 필요 인원 + 병동 규칙 6개, `isSample: true`
- **이번 달 기간**(오늘이 속한 달): `status: "confirmed"`, `result` = 확정 근무표(`confirmed-schedules.json`의 `"{길이}-{1일 요일(월=0)}"`), `versions` 1개(`confirmed_at`은 오늘 이전 시각, 예: 지난달 말일 또는 이번 달 1일 전날 18:00 KST의 ISO), `snapshot` = 그때의 명단·병동 규칙, `carryOverUsed: []`, 요청 없음
- **다음 달 기간**: `status: "draft"`, `requests` = `next_requests`(적용된 상태), `result: null`
- 두 기간의 id는 `makeId`로 만든다(테스트에서 결정적으로).
- 이 결과로 `toScheduleRequest(ward, 다음 달, periods, today)`를 만들면 `carry_over`가 이번 달 마지막 며칠로 채워지고 `history_load`가 비어 있지 않아야 한다.

### 2. store `loadSample(today)`
- `buildSample`을 써서 상태를 바꾸고 `view`를 `{ screen: "home" }`로 둔다.
- 기존의 "다음 달 기간 하나만 만들기" 코드는 지운다.
- `StartScreen`이 샘플 뒤에 홈으로 보내는 코드가 있으면 중복을 정리한다(동작만, 화면 문구는 step 6).

### 테스트가 최소한 다룰 것
- 2026-10-28 → 10월(31일, 1일 목요일 → 키 `"31-3"`) 확정 + 11월 초안, 2027-02-15 → 2월(28일) 확정
- 확정 기간의 `isOperating`이 true, 다음 달의 `carry_over`·`history_load`가 채워짐
- 다음 달 요청 3개가 적용 상태이고 날짜가 기간 길이 안에 있음
- 홈 상태(`nextTask` 또는 `homeSummary`)가 "운영 중 10월 + 작성 중 11월"로 나옴
- 샘플 병동 규칙 수(`wardRuleCount`) = 6

## Acceptance Criteria

```bash
npx vitest run lib/sample.test.ts lib/store.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 수동 확인: `npm run dev` → `/app` → [샘플로 체험하기] → 홈에 운영 중 근무표와 다음 근무표가 보이는지, 다음 근무표의 ③에서 생성하면 이월·최근 4주 열이 채워지는지 확인한다(문구는 아직 옛 문구여도 된다). 확인 후 서버를 종료한다.
3. 아키텍처 체크리스트를 확인한다:
   - 샘플 로드에서 네트워크 호출이 없는가?
   - `STORAGE_VERSION`을 올리지 않았는가(step 1 결정)?
4. 결과에 따라 `phases/3-ux/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 샘플을 열 때 `/solve`를 부르지 마라. 이유: 미리 계산한 근무표를 쓰기로 했다(즉시 열림).
- 샘플 날짜를 특정 연월로 고정하지 마라. 이유: 오늘 기준으로 맞춰야 운영 중 상태가 성립한다.
- 화면 문구나 레이아웃을 바꾸지 마라. 이유: step 4~6의 범위다.
- 기존 테스트를 깨뜨리지 마라.
