# Step 2: coverage-table

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/` 순수 함수는 TDD
- `/docs/ADR.md` — ADR-019(식 언어), ADR-023(필요 인원 기본 해석 "이상")
- `/docs/UI_GUIDE.md` — "근무표 작성 › ② 매장 조건 › 맨 위 요약표", "문구"
- `/lib/coverage-conflict.ts`, `/lib/coverage-conflict.test.ts` — `coverageBounds`(필요 인원 모양의 범위, max null = 이상), `coverageDays`(날짜 고르기 → 날 인덱스). 이 step이 재사용한다
- `/lib/store.ts` — `coverageKey`·`coverageRule`·`coverageRange`(폼 모양: 평일/주말·공휴일 × 코드 하나), `tagCoverage`, `isCoverageRule`, `liveShopRules`, `coverageCodes`
- `/lib/wording.ts` — `coverageText`(범위 → "1~2명", "1명 이상", "2명")
- `/lib/rules.ts` — `ruleShape`
- `/lib/period.ts` — `periodDays`, `isWeekendDay`
- `/components/PeriodWork.tsx` — `CoverageSummary`(② 맨 위 표: 근무조 × 평일/주말·공휴일, `need()`), ② 아래 "필요 인원 없이 만들면 인원을 맞추지 않아요"(`hasStaffing`)
- `/components/RulesStep.tsx` — 요약표에 든 규칙을 카드에서 빼는 곳(`isCoverageRule`·`default`)

## 배경

② 맨 위 요약표는 숫자 폼(근무조별 필요 인원)으로 만든 규칙만 읽는다(`coverageRange`: 평일 또는 주말·공휴일, 코드 하나). 말로 만든 "매일 오픈 1명 이상"(반드시, 켜짐)은 날짜 고르기가 "매일"이라 표에 나오지 않고, 매니저는 평일 오픈 칸이 비어 보여 인원 조건이 없는 줄 안다. 이 step은 표가 **켜진 반드시 필요 인원 규칙 전부**를 합쳐 보여 주게 한다. 표가 무엇을 보여 주는지 한 줄로 밝힌다.

## 작업

TDD: 1의 순수 함수는 `lib/coverage-conflict.test.ts`에 테스트를 먼저 쓴다.

1. `lib/coverage-conflict.ts`에 더한다(`lib/store.ts`를 import하지 않는다):

   ```ts
   export type DayKind = "weekday" | "weekend";  // store.ts의 DayKind와 같은 값. store가 이 모듈을 import하므로 여기서 정의하고 store는 re-export하거나 그대로 둔다
   /**
    * 요약표 한 칸: 켜진 반드시 필요 인원 규칙(사람 고르기 없음, shifts.in이 코드 하나) 중
    * 그 요일 종류(평일 / 주말·공휴일)의 **모든 날**에 적용되는 규칙을 합친 범위.
    * min은 가장 큰 min, max는 가장 작은 max(상한 없는 규칙만 있으면 null). 그런 규칙이 없으면 null.
    * 일부 날에만 적용되는 규칙("토요일만 3명", "11/15~11/17 2명")은 넣지 않는다(그 규칙은 카드로 남는다).
    */
   export function effectiveCoverage(rules: ConstraintSpec[], code: string, kind: DayKind, period: PeriodRange, holidays: number[]): { min: number; max: number | null } | null;
   ```
   - "그 요일 종류의 모든 날"은 `coverageDays(rule.days, period, holidays)`가 `periodDays(period)` 중 `isWeekendDay(period, day, holidays)`가 kind와 맞는 날을 전부 포함하는 것이다. 그런 날이 하나도 없는 기간(예: 공휴일 없는 평일만의 기간은 없지만, 하루짜리 기간)은 null.
   - `coverageBounds`로 범위를 읽고, shifts는 `ruleShape(rule).shifts.in`이 `[code]`인 것만(복합 코드·not_in은 제외. 지금 표와 같다).
   - 반드시(hardness 없음 또는 "hard")이고 `enabled !== false`인 규칙만. 호출하는 쪽이 `liveShopRules`(이 근무표의 수정본·끄기 반영)를 넘긴다.
   - 테스트: 폼 규칙만 있을 때 지금 `coverageRange`와 같은 값; "매일 오픈 1명 이상"(kind all) + 폼 "평일 오픈 1~2명" → 평일 `{1, 2}`, 주말 `{1, null}`; 두 규칙의 min 중 큰 값과 max 중 작은 값; 토요일만 규칙은 무시; 가능하면 규칙은 무시; 꺼진 규칙은 무시; 공휴일 때문에 주말 날이 늘어도 kind all 규칙은 여전히 전부 덮음.
2. `components/PeriodWork.tsx` `CoverageSummary`:
   - `need()`의 전체 필요 인원을 `coverageText(effectiveCoverage(rules, code, kind, period, period.holidays))`로 바꾼다. 직급별(`tagCoverage`)은 그대로 잇는다.
   - 표 아래에 `ui.help` 한 줄: `"켜진 반드시 필요 인원 규칙을 합친 값이에요. 일부 날짜에만 적용되는 규칙은 카드에서 봐요"`.
   - `[바꾸기]`로 펼치는 근무 코드 표, 폼은 그대로.
3. 카드: 요약표에 든 규칙을 카드에서 빼는 규칙(`isCoverageRule`·`default`)은 **바꾸지 않는다**. 말로 만든 "매일 오픈 1명 이상"은 표에도 나오고 카드로도 남는다(직급별 규칙과 같은 취급). UI_GUIDE 문장을 그에 맞게 고치는 것은 마지막 step이 한다. summary에 적는다.
4. `hasStaffing`("필요 인원 없이 만들면…")은 그대로 둔다(이미 `isStaffingRule`로 말로 만든 규칙도 센다. 아니면 summary에 적는다).

## Acceptance Criteria

```bash
npx vitest run lib/coverage-conflict.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/coverage-conflict.ts`가 `lib/store.ts`·`components/`를 import하지 않는가(순환 금지)?
   - 표가 보여 주는 값과 솔버가 받는 규칙이 같은 규칙 집합(`liveShopRules`)에서 나오는가?
   - 폼으로 넣은 값을 바꾸는 경로(`setCoverage` 등)는 그대로인가?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`): ②에서 "매일 오픈 1명 이상"을 적용하면 표의 오픈 평일·주말 칸에 반영된다(폼 값 1~2가 있으면 "1~2명" 그대로, 폼 값이 없으면 "1명 이상"). 끄면 사라진다. 환경이 없으면 "확인 못 함".
4. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구(표 아래 한 줄)와 e2e 영향(S8-a 요약표 값이 말로 만든 규칙에도 반응)을 적어라.** 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 말로 만든 규칙을 폼 모양으로 자동 변환하거나 합쳐서 저장하지 마라. 이유: 규칙 원본은 매니저가 적용한 그대로다(ADR-023 "저장 규칙은 자동 변환하지 않는다"). 표는 읽기만 한다.
- 일부 날짜 규칙을 표에 "최대값"으로 섞어 넣지 마라. 이유: "토요일만 3명"이 주말 칸에 3으로 보이면 일요일 조건을 오해한다.
- 폼(`숫자로 입력하기`)의 동작·저장 모양을 바꾸지 마라. 이유: 이 step은 표시만 고친다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
