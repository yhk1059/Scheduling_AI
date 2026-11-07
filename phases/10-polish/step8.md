# Step 8: notices

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/` 순수 함수는 TDD
- `/docs/UI_GUIDE.md` — "근무표 작성 › ③"(해 없음 패널 순서), "확정 근무표", "문구" 표, "빈 상태", "피드백과 오류"
- `/docs/PRD.md` — J2 ③, J8, "직원은 모두 제출한다고 가정한다. 미제출 경고, 독촉, 대리 입력을 두지 않는다"(이 step은 근무표를 만들 수 없을 때만 안내한다)
- `/lib/wording.ts`, `/lib/wording.test.ts` — `describeRule`, `josa`(step 4)
- `/lib/coverage-conflict.ts` — `findCoverageConflict`
- `/lib/availability.ts` — `isAvailabilityRule`, `AVAILABILITY_RULE_PREFIX`(가능 시간 규칙 id `avail-{직원 id}-{코드}`)
- `/lib/store.ts` — `WorkPeriod.availability`(제출한 직원 id → 칸), `liveShopRules`
- `/components/ConstraintCard.tsx` — `conflictName`(폼 규칙이면 해석 문장, 아니면 원문), 충돌 경고 줄 "기존 규칙 “…”과 함께 지킬 수 없어요 [기존 규칙 끄기]"
- `/components/RulesStep.tsx` — `conflictOf`
- `/components/ScheduleStep.tsx` — `useSolve`(해 없음이면 `explain`을 부른다), `OutcomePanel`("함께 지킬 수 없는 규칙", "가능 시간도 함께 걸려 있어요 … 더 일할 수 있는지 물어보면 해결될 수도 있어요", `unknownCause`), `ScheduleBody`(패널에 넘기는 props)
- `/components/ConfirmedPeriod.tsx` — "마지막 확정 {시각} · 직원 링크는 잠겼어요"
- `/components/AvailabilityForm.tsx` — 잠긴 뒤 이름 고르기 문구 "확정된 근무표예요. 내 이름을 고르면 근무표를 볼 수 있어요"(phase 9)

## 배경

저니 확인에서 걸린 안내 세 가지를 고친다.
1. **충돌 경고의 인용**: 새 필요 인원 카드의 "기존 규칙 “{원문}”과 함께 지킬 수 없어요"가 원문을 인용한다. 원문 "매일 오픈, 미들, 마감 각각 1명씩"은 카드 세 장을 만들었으므로 어느 카드가 꺼지는지 알 수 없다.
2. **제출 0명일 때의 근무표 없음**: 가능 시간을 아무도 제출하지 않으면 모든 직원의 모든 근무가 금지돼 필요 인원과 부딪힌다. 지금은 "함께 지킬 수 없는 규칙: 매일 미들 1명 [이번 근무표에서만 끄기] / 가능 시간도 함께 걸려 있어요 … 물어보면 해결될 수도 있어요"가 나와 규칙을 끄게 만든다. 실제 원인은 제출 0명이다.
3. **확정 화면의 링크 안내**: "직원 링크는 잠겼어요"만 있고, phase 9 이후 같은 링크가 직원의 근무표 보기라는 설명이 없다.

## 작업

TDD: 1·2의 순수 함수는 `lib/wording.test.ts`·`lib/availability.test.ts`에 테스트를 먼저 쓴다.

1. 충돌 경고 인용(`lib/wording.ts` + `ConstraintCard`):
   ```ts
   /** 충돌 경고에서 기존 규칙을 가리키는 말. 폼 규칙(원문 없음)은 해석 문장, 같은 원문의 규칙이 둘 이상이면 "원문 (해석 문장)", 아니면 원문. */
   export function ruleQuote(rule: ConstraintSpec, siblings: ConstraintSpec[], config: ShopConfig, employees: Employee[], period: PeriodRange): string;
   ```
   - `siblings`는 같은 범위의 규칙 전부(`shop.rules`). 같은 `source_text`가 둘 이상이면 `“{원문}” ({해석 문장})` 꼴.
   - `ConstraintCard`의 `conflictName` 계산을 `ruleQuote(conflict, shop.rules, config, employees, range)`로 바꾼다. 경고 문장은 `기존 규칙 {quote}{josa(quote, "과", "와")} 함께 지킬 수 없어요`(따옴표는 `ruleQuote`가 붙이므로 JSX의 `“ ”`는 뺀다. 해석 문장만일 때는 따옴표 없이).
   - 테스트: 폼 규칙 → 해석 문장만, 유일 원문 → `“원문”`, 같은 원문 셋 → `“원문” (매일 미들 1명)`.
2. 제출 0명 안내(`lib/availability.ts` + `ScheduleStep`):
   ```ts
   /** 근무표 없음의 원인이 미제출인지: 활성 직원 중 제출한 사람이 없거나, 충돌에 걸린 가능 시간 규칙의 직원이 모두 미제출이면 true. */
   export function unsubmittedCause(conflictIds: string[], submittedIds: string[], activeIds: string[]): boolean;
   ```
   - 충돌 id 중 `avail-` 접두사의 직원 id를 뽑는다(`avail-{직원 id}-{코드}`. 직원 id에 `-`가 없다고 가정하지 말고 마지막 `-` 뒤를 코드로 본다). 그 직원이 하나도 제출하지 않았으면(그리고 그런 직원이 하나 이상이면) true. 제출자가 0명이면 충돌과 무관하게 true. 활성 직원이 0명이면 false(이미 [근무표 만들기]가 비활성이다).
   - `OutcomePanel`에 prop `unsubmitted: boolean`을 더한다. true면: 제목은 그대로("이 조건으로는 근무표를 만들 수 없어요"), 본문은 `"아직 가능 시간을 제출한 직원이 없어요. ①에서 링크를 보내고 제출을 기다려 주세요"`(제출자가 0명) 또는 `"{이름, 이름}의 가능 시간이 아직 없어요. 제출을 기다리거나 ①에서 확인해 주세요"`(걸린 직원만 미제출)와 [① 가능 시간으로] Text(`go({ screen: "period", periodId, step: 1 })`). **제안·"함께 지킬 수 없는 규칙"·"가능 시간도 함께 걸려 있어요"·"왜 만들 수 없나요?"는 숨긴다.** 규칙 끄기 버튼이 없다.
   - `useSolve`: 해 없음이고 `unsubmittedCause`가 true면 `explain`을 부르지 않는다(LLM 호출 절약. `explaining`도 false).
   - `ScheduleBody`가 `period.availability`의 id와 활성 직원 id로 계산해 넘긴다. 확정 근무표 화면(`ConfirmedPeriod`)에서는 링크가 잠겨 제출이 끝났으므로 `unsubmitted`를 넘기지 않는다(false).
   - 테스트: 제출 0명 → true; 충돌 직원 e01·e02 모두 미제출 → true; 하나라도 제출 → false; 충돌에 가능 시간 규칙이 없고 제출자가 있으면 false; 활성 0명 → false.
3. 확정 화면(`ConfirmedPeriod.tsx`): `"마지막 확정 {시각} · 직원 링크는 잠겼어요"` → `"마지막 확정 {시각} · 직원 링크는 잠겼어요. 직원은 같은 링크에서 근무표를 봐요"`.
4. 문구 훑기(작게): UI_GUIDE "문구" 표의 "쓰지 않는 말" 열에 있는 말이 `components/`의 화면 문자열에 남아 있는지 grep으로 찾아 고친다(예: "기간", "초대", "해석"). 찾은 것과 고친 것을 summary에 적는다. 구조·버튼 이름은 바꾸지 않는다. 없으면 "없음".

## Acceptance Criteria

```bash
npx vitest run lib/wording.test.ts lib/availability.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 미제출 판정이 클라이언트(`period.availability`)에서만 되고 `backend/`가 바뀌지 않았는가?
   - 미제출 안내가 근무표 없음 패널 안에만 있고, ①·②·③ 다른 곳에 경고가 없는가(PRD)?
   - 해 없음 패널의 나머지 순서(제안 → 함께 지킬 수 없는 규칙 → 가능 시간 → 왜)가 미제출이 아닐 때 그대로인가?
   - UI_GUIDE "문구" 표의 말만 썼는가?
3. 수동 체크: 시드 매장의 다음 근무표에서 아무도 제출하지 않은 채 ③ [근무표 만들기] → 미제출 안내와 [① 가능 시간으로]만 보이고 끄기 버튼이 없다. 제출한 뒤에는 기존 패널. ②에서 "매일 오픈, 미들, 마감 각각 1명씩"을 적용한 뒤 "주말 미들 정확히 2명" 카드의 경고가 `“매일 오픈, 미들, 마감 각각 1명씩” (매일 미들 1명)`을 인용한다. 환경이 없으면 "확인 못 함".
4. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구·버튼 이름·숨긴 영역을 적어라**(미제출 안내 두 문장, [① 가능 시간으로], 경고 인용 꼴, 확정 화면 문장, 문구 훑기 결과). e2e S10(근무표 없음 패널)·S18에 영향이 있는지 적는다. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- ①이나 ③ 첫 화면에 미제출 경고·독촉을 두지 마라. 이유: PRD "미제출 경고, 독촉을 두지 않는다". 근무표를 만들 수 없을 때만 원인으로 보여 준다.
- 미제출일 때 가능 시간을 대신 채우거나(대리 입력) 가능 시간 규칙을 끄는 버튼을 두지 마라. 이유: PRD·ADR-020(가능 시간은 직원이 정한다).
- 백엔드 응답(`conflicts`)의 모양을 바꾸지 마라. 이유: 판정은 클라이언트가 id 접두사로 한다.
- `findCoverageConflict`의 판정을 바꾸지 마라. 이유: 이 step은 인용 문장만 고친다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
