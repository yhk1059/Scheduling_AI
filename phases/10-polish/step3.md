# Step 3: pre-summary

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/` 순수 함수는 TDD
- `/docs/UI_GUIDE.md` — "근무표 작성 › ③ 근무표", "③ 근무표의 버튼" 표(만들기 전: 설명 한 줄 "가능 시간과 매장 조건으로 근무표를 만들어요"), "요약 지표", "문구"(반드시/가능하면, 이번 근무표에서만 끄기, 지난 근무 마지막 며칠)
- `/docs/PRD.md` — J2 ③
- `/components/ScheduleStep.tsx` — `ScheduleStep`의 `actions`(만들기 전 `!result` 분기), `readAvailability`(③에 들어오면 가능 시간을 다시 읽어 `period.availability`에 둔다), `SummaryCard`(만든 뒤 요약 지표 — 모양 참고)
- `/lib/store.ts` — `WorkPeriod.availability`(직원 id → 칸. 제출한 직원만 있다), `liveShopRules`, `disabledRulesFor`, `period.requests`(`enabled`), `period.disabledIds`, `toScheduleRequest`(솔버에 보내는 직원·제약·carry_over를 만드는 곳 — 요약도 이것과 같은 수를 세야 한다)
- `/lib/continuity.ts` — `carryOverFrom`(지난 확정본 마지막 며칠), `previousConfirmedPeriod`(있는 곳을 grep으로 확인), `CARRY_OVER_DAYS`
- `/lib/availability.ts` — `isAvailabilityRule`(가능 시간 규칙은 세지 않는다)
- `/lib/wording.ts`, `/lib/wording.test.ts` — 문장 함수와 테스트 방식(`shopRuleCount`)

## 배경

③ 첫 화면은 "가능 시간과 매장 조건으로 근무표를 만들어요" 한 줄과 [근무표 만들기]뿐이다. 매니저는 무엇이 들어가는지 모른 채 누른다(제출이 몇 명인지, 끈 규칙이 있는지, 지난 근무가 이어지는지). 이 step은 그 줄을 **들어가는 것의 한 줄 요약**으로 바꾼다. 만든 뒤의 요약 지표(`SummaryCard`)는 그대로다.

## 작업

TDD: 1의 순수 함수는 `lib/wording.test.ts`에 테스트를 먼저 쓴다.

1. `lib/wording.ts`에 더한다:

   ```ts
   export interface ScheduleInputs {
     submitted: number;   // 가능 시간을 제출한 직원 수(활성 직원 중 period.availability에 있는 id)
     employees: number;   // 새 근무표에 들어가는 직원 수(활성)
     hard: number;        // 켜진 반드시 규칙·요청 수(매장 조건 + 이번 근무표 요청, 가능 시간 규칙 제외)
     soft: number;        // 켜진 가능하면 규칙·요청 수
     disabled: number;    // 이번 근무표에서 끈 규칙·요청 수(disabledRulesFor)
     carryDays: number;   // 이어받는 지난 근무 일수(0이면 없음)
   }
   /** ③ 만들기 전 한 줄: "제출 10/12명 · 반드시 6개 · 가능하면 2개 · 이번 근무표에서 끈 규칙 1개 · 지난 근무 7일 이어받아요". 끈 규칙 0·지난 근무 0은 뺀다. */
   export function scheduleInputsText(i: ScheduleInputs): string;
   ```
   - 숫자 부분은 화면이 mono로 그릴 수 있게, 문장 조각 배열 `{ text } | { value: string }`으로 돌려주는 기존 `SentencePart` 방식을 써도 된다(그 경우 시그니처를 `SentencePart[]`로 바꾸고 테스트는 `.map(p => p.text).join("")`으로 비교).
   - `hard`/`soft`의 기준은 카드 토글과 같다: `hardness ?? (balance면 "soft", 아니면 "hard")`(ConstraintCard의 `hardness` 계산과 같은 규칙. `lib/rules.ts`나 wording에 이미 있는 헬퍼가 있으면 쓴다).
2. `lib/store.ts`에 계산 함수를 더한다(순수, store 상태를 인자로):

   ```ts
   /** ③ 만들기 전 요약에 쓰는 수. toScheduleRequest와 같은 직원·규칙·carry_over 기준으로 센다. */
   export function scheduleInputs(shop: Shop, period: WorkPeriod, periods: WorkPeriod[]): ScheduleInputs;
   ```
   - `employees`·`hard`·`soft`는 `toScheduleRequest(shop, period, periods, today)`가 만드는 `employees`와 `constraints`(가능 시간 규칙·칸 고정 제외)에서 센다. 같은 기준을 두 번 쓰지 말고 `toScheduleRequest`의 결과를 세거나, 그 안의 공통 함수를 꺼내 쓴다.
   - `carryDays`는 `toScheduleRequest`의 `carry_over`가 비어 있지 않으면 행 중 가장 긴 `shifts.length`, 아니면 0.
   - `lib/store.test.ts`에 테스트: 시드 매장(`e2e/fixtures/shop-oct.json`을 읽는 기존 테스트 방식)으로 제출 수·규칙 수·끈 규칙·지난 근무 일수.
3. `components/ScheduleStep.tsx` `ScheduleStep`의 `actions`(만들기 전 분기): `"가능 시간과 매장 조건으로 근무표를 만들어요"`를 `scheduleInputsText(scheduleInputs(shop, period, periods))`로 바꾼다. `text-sm text-[#3D3D38]`, 숫자는 `font-mono`. 길면 두 줄로 접히게 `max-w`를 둔다(버튼과 같은 줄, 오른쪽 정렬 유지). 제출 수는 ③에 들어올 때 `readAvailability`가 읽은 `period.availability`를 쓴다(새로 읽지 않는다).
4. 근무표 없음 패널·만든 뒤 지표는 바꾸지 않는다.

## Acceptance Criteria

```bash
npx vitest run lib/wording.test.ts lib/store.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 요약의 직원·규칙 수가 솔버 요청(`toScheduleRequest`)과 같은 기준인가(따로 센 로직이 없는가)?
   - 개발 용어(hard/soft, carry_over)가 화면에 없는가? UI_GUIDE "문구" 표의 말(반드시/가능하면, 이번 근무표에서만 끄기, 지난 근무)만 썼는가?
   - 백엔드를 부르지 않는가?
3. 수동 체크: 시드 매장 ③ 첫 화면에 "제출 12/12명 · 반드시 n개 · …"가 보이고, ②에서 규칙을 끄면 "이번 근무표에서 끈 규칙 1개"가 더해진다. 환경이 없으면 "확인 못 함".
4. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구를 적어라**(없어진 "가능 시간과 매장 조건으로 근무표를 만들어요", 새 한 줄의 꼴). e2e S9-b가 그 문장을 찾으면 바뀐다는 것을 적는다. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 미제출 직원 이름을 ③에 나열하거나 경고 색을 쓰지 마라. 이유: PRD "미제출 경고·독촉을 두지 않는다". 수만 보여 준다.
- [근무표 만들기]를 제출 수로 막지 마라. 이유: 같은 PRD 원칙. ① [다음]도 막지 않는다.
- 규칙 수를 세는 로직을 `components/`에 두지 마라. 이유: `lib/`의 순수 함수(TDD)와 `toScheduleRequest` 기준을 공유해야 한다.
- `SummaryCard`(만든 뒤 지표)를 바꾸지 마라. 이유: phase 9 step 4의 결정("끈 규칙 N개" 배지)이 거기 있다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
