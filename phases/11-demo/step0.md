# Step 0: demo-doc-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/`의 순수 함수는 TDD
- `/docs/ARCHITECTURE.md` — "디렉토리 구조 › lib/", "상태 관리"
- `/docs/ADR.md` — ADR-015(기간은 시작일 + 길이, 날짜는 1..length 인덱스), ADR-016·ADR-022(이전 샘플 데모와 영상, 왜 걷어냈는지), ADR-020(로그인 필요)
- `/docs/DEMO_SCENARIO.md` — 한강 다이닝 시나리오(직원 20명, 규칙, 화요일 주방 마감 리더 불가능)
- `/lib/period.ts` — `PeriodRange`, `firstPeriodStart`, `periodFrom`, `dateOfDay`, `dayOfDate`(타임존 무관 날짜 계산)
- `/lib/store.ts` — `Data`, `Shop`, `ShopEmployee`, `WorkPeriod`, `newPeriod`, `toScheduleRequest`(요청에 `avail-` 규칙과 고정 배정이 어떻게 섞이는지)
- `/lib/availability.ts` — `AvailabilitySlots`, `AVAILABILITY_RULE_PREFIX`, `isAvailabilityRule`
- `/lib/rules.ts` — `stableJson`, `STORAGE_VERSION`
- `/lib/supabase.ts` — `AvailabilityLink` 타입(토큰, 직원 id, 칸, 제출 시각)
- `/lib/types.gen.ts` — `ScheduleRequest`, `ExplainResponse`, `RelaxationProposal`, `ConstraintSpec`
- `/lib/seed-scenarios.ts`, `/lib/seed-scenarios.test.ts` — 날짜를 옮겨 시드를 만드는 방식과 테스트 작성 방식

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝, 직원 20명, `docs/DEMO_SCENARIO.md`)을 실제 앱 화면으로 눌러 본다. 자유 입력은 없고 버튼만 누른다. LLM 엔드포인트(`/translate`, `/explain`)는 부르지 않고 솔버(`/solve`)만 실제로 부른다. 상태는 메모리에만 두고 저장하지 않는다. 확정·직원 링크·저장은 막고 [내 매장으로 시작하기]로 안내한다.

이 step은 **체험 데이터를 다루는 순수 함수만** 만든다. 데이터 파일(`lib/samples/demo-shop.json`)은 step 1이 생성하고, store와 화면은 step 2 이후가 바꾼다.

체험 문서는 날짜를 기준 주(월요일 시작 7일, 예: 2026-11-09~15)에 묶어 저장한다. 체험을 열 때 오늘 이후 첫 월요일로 옮긴다. 과거 날짜를 그대로 쓰면 화면이 낡아 보이고, 확정 근무표라면 지난 날짜가 고정 배정으로 잠기기 때문이다. 공휴일은 비운다(주에 공휴일이 끼면 주말 필요 인원이 달라져 시나리오의 "해 없음"이 깨질 수 있다).

해 없음 설명은 LLM을 부르지 않고 미리 저장한 응답을 쓴다. 저장 시점의 요청과 지금 요청의 **규칙 제약이 같을 때만** 보여 준다. 방문자가 카드를 끄거나 값을 바꾸면 설명 없이 충돌 규칙 목록만 보인다(ARCHITECTURE "결정적 대체 경로").

## 작업

TDD: `lib/demo.test.ts`를 먼저 쓰고, 통과하는 `lib/demo.ts`를 만든다.

1. `lib/demo.ts`(새 파일). `lib/` 안의 모듈과 `types.gen.ts`만 import한다(`components/`, `supabase.ts`의 런타임 함수는 금지. `AvailabilityLink`는 `import type`).

   ```ts
   import type { AvailabilitySlots } from "./availability";
   import type { PeriodRange } from "./period";
   import type { Data, Shop, ShopEmployee } from "./store";
   import type { AvailabilityLink } from "./supabase";
   import type { ExplainResponse, ScheduleRequest } from "./types.gen";

   /** lib/samples/demo-shop.json의 모양(step 1이 만든다). 날짜는 기준 주 base에 묶여 있고, 체험할 때 오늘 기준으로 옮긴다. */
   export interface DemoDoc {
     /** STORAGE_VERSION. 다르면 쓰지 않는다 */
     version: number;
     /** 규칙 8문장은 rules에 적용된 상태, 2문장은 pendingRules(예시 판정은 shop.examples) */
     shop: Shop;
     /** 기준 주. 월요일 시작, length 7 */
     base: PeriodRange;
     /** 직원 id → 기준 주 날짜별 가능 시간. 제출한 직원만 있다 */
     availability: Record<string, AvailabilitySlots>;
     /** 대기 카드를 모두 적용한 기준 상태에서 /solve가 해 없음일 때의 /explain 응답. signature는 그 요청의 requestSignature */
     explanation: { signature: string; response: Omit<ExplainResponse, "input_version"> } | null;
   }

   /**
    * 체험 시작 상태. 기준 주를 firstPeriodStart("1w", today)로 옮긴다(오늘이 월요일이면 오늘).
    * 공휴일은 빈 배열. 가능 시간의 날짜 키는 같은 요일로 옮기고 기준 주 밖의 키는 버린다.
    * 화면은 ② 매장 조건({ screen: "period", periodId, step: 2 }), inputVersion 0.
    */
   export function demoData(doc: DemoDoc, today: string): Data;

   /** 요청의 규칙 제약(type "rule", enabled !== false, avail- 제외)만 id 순으로 정렬해 stableJson한 문자열. */
   export function requestSignature(req: Omit<ScheduleRequest, "input_version">): string;

   /** 저장된 설명이 이 요청의 signature와 같으면 input_version을 붙여 돌려준다. 아니면 null. */
   export function demoExplanation(doc: DemoDoc, req: Omit<ScheduleRequest, "input_version">, inputVersion: number): ExplainResponse | null;

   /** ①과 매장 홈이 링크 행 대신 쓰는 제출 현황. 가능 시간이 있는 직원은 submitted_at = submittedAt, 없으면 null. token은 빈 문자열. */
   export function demoLinkRows(availability: Record<string, AvailabilitySlots>, employees: ShopEmployee[], submittedAt: string): AvailabilityLink[];
   ```

   - `demoData`의 기간은 `newPeriod(periodFrom("1w", start))`로 만들고 `holidays: []`와 옮긴 `availability`를 덮어쓴다. `availabilityUsed`는 null. `periods`는 그 하나뿐이다.
   - 날짜를 옮길 때 `dayOfDate(doc.base, 날짜)`로 인덱스를 얻고 `dateOfDay(새 기간, 인덱스)`로 바꾼다. 문자열 연산으로 날짜를 더하지 마라.
   - `shop`은 그대로 쓴다(`withDefaultRules`를 거쳐도 된다). 깊은 복사는 하지 않아도 된다(JSON import는 모듈마다 하나지만 store는 불변 갱신이다).
   - `requestSignature`는 `fixed_assignment`, `avail-`로 시작하는 id, `enabled === false`인 제약을 뺀다. 같은 규칙이 순서만 다르면 같은 문자열이어야 한다. 가능 시간 규칙은 날짜에 따라 id·내용이 바뀌므로 반드시 뺀다.

2. 테스트(`lib/demo.test.ts`). 작은 `DemoDoc` 픽스처를 테스트 안에서 만든다(직원 2~3명, 규칙 2개, 가능 시간 2명). 다룰 것:
   - 수요일 `2026-10-28` → 시작일 `2026-11-02`, `length` 7, `holidays` `[]`, 화면이 ② (`periodId`는 `p-2026-11-02`)
   - 월요일 `2026-11-09` → 시작일 그대로 `2026-11-09`
   - 기준 주 월·화에 있던 가능 시간이 새 주 월·화 날짜로 옮겨지고 시간대는 같다. 기준 주 밖의 키는 사라진다
   - 공휴일이 든 주로 옮겨도 `holidays`는 `[]`(예: today `2026-12-16` → 12/21 시작, 12/25 성탄절)
   - `requestSignature`: 순서가 달라도 같다 / `avail-` 규칙·고정 배정·`enabled: false` 규칙은 영향이 없다 / 규칙의 hardness나 값이 바뀌면 다르다
   - `demoExplanation`: signature가 같으면 `response`에 `input_version`이 붙어 돌아온다 / 다르면 null / `explanation`이 null이면 null
   - `demoLinkRows`: 가능 시간이 있는 직원은 `submitted_at`이 주어진 값, 없는 직원은 null, 순서는 `employees` 순서

## Acceptance Criteria

```bash
npx vitest run lib/demo.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/demo.ts`가 `components/`나 `lib/supabase.ts`의 런타임 함수를 import하지 않는가(타입만)?
   - 타임존에 의존하는 `new Date(문자열)` 파싱을 쓰지 않았는가(`lib/period.ts`의 함수만, ADR-015)?
   - store·화면·backend가 바뀌지 않았는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 내보낸 함수 시그니처, DemoDoc 필드)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `lib/samples/demo-shop.json`을 만들지 마라. 이유: step 1이 실제 백엔드로 번역·풀이해서 만든다. 이 step의 테스트는 픽스처만 쓴다.
- `lib/store.ts`·`components/`·`backend/`를 고치지 마라. 이유: step 2 이후가 한다.
- 가능 시간(`avail-`) 규칙을 signature에 넣지 마라. 이유: 날짜마다 id와 내용이 달라 저장된 설명이 영영 맞지 않는다.
- 기존 테스트를 깨뜨리지 마라.
