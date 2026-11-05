# Step 0: coverage-conflict-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — "패턴 › 식 언어", "제약 단일 표현"
- `/docs/ADR.md` — ADR-019(식 언어, 조정 가능한 값), ADR-020("시간대 필요 인원")
- `/lib/rules.ts` — `ruleShape`, `RuleShape`(kind "count"의 `per`·`days`·`shifts`·`min`·`max`), `normalizeRule`, `stableJson`
- `/lib/store.ts` — `coverageKey`, `isStaffingRule`, `replaceKey`, `findReplaced`, `liveShopRules`(필요 인원 규칙을 어떻게 알아보는지)
- `/lib/period.ts` — `PeriodRange`, `periodDays`, `isWeekendDay`
- `/lib/types.gen.ts` — `ConstraintSpec`, `Rule`, `Days`, `Shifts`, `People`(직접 수정 금지)
- `/lib/rules.test.ts`, `/lib/test-rules.ts` — 테스트 작성 방식과 규칙 빌더(`count`, `DEN_CONFIG` 등)

## 배경

phase `9-rules-and-confirm`은 매니저가 앱을 한 주기 써 본 뒤 나온 개선점을 반영한다. 이 phase에서 필요 인원의 기본 해석이 "정확히 n명"에서 "n명 이상"으로 바뀐다(step 2). 이미 저장된 "정확히" 카드는 자동 변환하지 않는다. 대신 새 필요 인원 카드를 [적용]하려는 순간, 같은 근무조·겹치는 날짜의 기존 필요 인원 규칙과 함께 지킬 수 없으면(예: 기존 "매일 오픈 정확히 1명" vs 새 "주말 오픈 2명 이상") 카드에 경고와 [기존 규칙 끄기]를 보여 준다(step 1).

이 step은 그 판정을 하는 **순수 함수**만 만든다. 솔버를 부르지 않고, 두 규칙의 필요 인원 범위 비교와 날짜 겹침만 본다. 화면은 바꾸지 않는다.

## 작업

TDD: `lib/coverage-conflict.test.ts`를 먼저 쓰고, 통과하는 `lib/coverage-conflict.ts`를 만든다.

1. `lib/coverage-conflict.ts`(새 파일, `lib/rules.ts`·`lib/period.ts`만 import. `lib/store.ts`를 import하지 않는다 — store가 이 모듈을 쓸 수 있어야 하므로 순환을 피한다):

   ```ts
   import type { PeriodRange } from "./period";
   import type { ConstraintSpec, Days } from "./types.gen";

   /** 필요 인원 모양의 범위. 모양이 아니면 null. max null = 상한 없음("이상"). */
   export function coverageBounds(c: ConstraintSpec): { min: number; max: number | null } | null;

   /** 날짜 고르기가 이 근무표에서 가리키는 날(1..length). kind·weekdays·days를 모두 적용한다. */
   export function coverageDays(days: Days | undefined, period: PeriodRange, holidays: number[]): number[];

   /**
    * card를 적용하면 함께 지킬 수 없게 되는 기존 필요 인원 규칙. 없으면 null.
    * 둘 다 반드시(hard)이고, 같은 근무 고르기(shifts)이고, 사람 고르기가 없고, 날짜가 하루라도 겹치고,
    * 범위가 겹치지 않을 때([minA, maxA]와 [minB, maxB]가 교차하지 않을 때)다. 첫 번째 것을 돌려준다.
    */
   export function findCoverageConflict(
     rules: ConstraintSpec[],
     card: ConstraintSpec,
     period: PeriodRange,
     holidays: number[],
   ): ConstraintSpec | null;
   ```

   핵심 규칙:
   - "필요 인원 모양"은 `lib/store.ts`의 `isStaffingRule`과 같다: `scope === "shop"`, `ruleShape`가 `kind: "count"`, `per: "day"`, `measure: "count"`, 사람 고르기 없음(`ids`·`tags`·`exclude_tags` 모두 없음). 폼 모양이 아니어도(토요일만, 매일) 된다. `isStaffingRule`은 store의 비공개 함수이므로 복사하지 말고 `ruleShape`로 같은 조건을 여기서 판정한다. store.ts는 건드리지 않는다.
   - 범위는 `RuleShape.min`·`max`에서 읽는다. `eq`는 `min === max`, `ge`만 있으면 `max: null`, `le`만 있으면 `min: 0`.
   - 근무 고르기는 `stableJson(shifts)`로 비교한다(`{in:["A"]}`와 `{in:["A","M"]}`은 다른 규칙이라 충돌로 보지 않는다. 시간대 필요 인원처럼 코드 집합이 다른 규칙끼리의 관계는 솔버가 판정한다).
   - 날짜 겹침은 `coverageDays`로 두 규칙의 날짜 집합을 기간 안에서 열거해 교집합이 있는지로 본다. `kind: "weekend"`는 토·일과 `holidays`, `kind: "holiday"`는 `holidays`만, `weekday`는 그 나머지, `all`은 전부. `weekdays`(0=월)와 `days`(1..length)는 `lib/wording.ts`의 `daysLabel`과 같은 뜻으로 거른다(둘 다 있으면 교집합).
   - `rules`에서 `card.id`와 같은 id, `enabled === false`, 가능하면(soft) 규칙, 필요 인원 모양이 아닌 규칙은 건너뛴다. card가 반드시가 아니거나 필요 인원 모양이 아니면 바로 null.
   - 호출자가 `findReplaced`로 대체될 규칙을 빼고 넘긴다(같은 모양·같은 날짜 종류의 카드는 충돌이 아니라 교체다). 이 함수는 그것을 모른다.

2. 테스트(`lib/coverage-conflict.test.ts`)에 최소한 다음을 둔다. 규칙은 `lib/test-rules.ts`의 `count`로 만들거나 `setCoverage`가 만드는 모양(`lib/store.ts` 1000행 부근)을 그대로 적는다.
   - "매일 오픈 정확히 1명"(eq 1, all) vs "주말 오픈 2명 이상"(ge 2, weekend) → 충돌.
   - "평일 오픈 2명 이상" vs "주말 오픈 3명 이상" → 날짜가 안 겹쳐 null.
   - "매일 오픈 1~3명" vs "주말 오픈 2명 이상" → 범위가 겹쳐 null.
   - 같은 날짜·다른 근무조(오픈 vs 마감) → null.
   - 기존 규칙이 `enabled: false`거나 soft → null. card가 soft → null.
   - `weekdays: [5, 6]`(토·일요일)과 `kind: "weekend"`가 겹친다. `days: [3]`과 `kind: "weekday"`는 3일이 평일일 때만 겹친다. 공휴일(`holidays: [3]`)이면 `weekend`와 겹친다.
   - `coverageDays`: 7일 기간(2026-11-02 월요일 시작)에서 `weekend` + `holidays: [4]` → `[4, 6, 7]`.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run lib/coverage-conflict.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/coverage-conflict.ts`가 `lib/store.ts`·`components/`를 import하지 않는가?
   - `lib/types.gen.ts`를 손대지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, export한 함수 시그니처, 충돌 판정 조건)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다. 바뀐 화면 문구·접근성 이름·버튼 위치가 있으면 적는다(이 step은 없어야 정상).
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 화면 컴포넌트를 고치지 마라. 이유: 경고 카드는 step 1이 한다.
- `lib/store.ts`를 고치지 마라. 이유: 이 step은 모듈 하나(순수 함수)만 만든다. store 연결은 step 1이 한다.
- 솔버(`/api/py/solve`)를 부르거나 CP-SAT 흉내를 내지 마라. 이유: 이 판정은 범위 비교·날짜 겹침만 본다. 진짜 가능 여부는 ③에서 솔버가 알려 준다.
- 저장된 "정확히" 규칙을 자동으로 "이상"으로 바꾸지 마라. 이유: 매니저가 정한 값이다. 결정은 사람이 한다(UI_GUIDE 원칙 6).
- `npm run test:e2e`를 돌리지 마라. 이유: 실제 API 키가 들어가고, e2e 동기화는 마지막 step(e2e-sync)이 한다.
- 기존 테스트를 깨뜨리지 마라.
