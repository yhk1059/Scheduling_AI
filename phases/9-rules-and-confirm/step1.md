# Step 1: coverage-conflict-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/UI_GUIDE.md` — "규칙·요청 카드 — 답장처럼", "배지", "버튼", "피드백과 오류", "문구" 표
- `/docs/ARCHITECTURE.md` — "제약 단일 표현"
- `/lib/coverage-conflict.ts`, `/lib/coverage-conflict.test.ts` — step 0이 만든 `findCoverageConflict(rules, card, period, holidays)`
- `/components/ConstraintCard.tsx` — 카드 구조. 특히 `replaces` prop과 `기존 규칙 대체` 표시, `orphan` 경고(`WarningIcon`), 버튼 줄
- `/components/RulesStep.tsx` — `renderCard`가 `findReplaced`로 `replaces`를 넘기는 곳, `stepPeriod`·`previewRange`
- `/lib/store.ts` — `findReplaced`, `liveShopRules`, `removeRule`(기본 규칙은 지우지 않고 `enabled: false`로 끈다), `enableRule`
- `/components/ShopSettings.tsx` — [매장 조건] 탭이 `RulesStep scope="shop"`을 쓰는 곳

## 배경

step 0이 "새 필요 인원 카드가 기존 필요 인원 규칙과 함께 지킬 수 없는지"를 판정하는 순수 함수를 만들었다. 이 step은 그 결과를 **적용 대기 카드**에 보여 준다. 매니저는 카드를 적용하기 전에 충돌을 알고, 기존 규칙을 그 자리에서 끌 수 있다. 끄는 것은 매장 조건에서 끄는 것(`enabled: false`)이고, [다시 켜기]로 되돌릴 수 있으므로 확인 대화상자는 두지 않는다(UI_GUIDE 원칙 7).

## 작업

1. `components/ConstraintCard.tsx`에 선택 prop을 더한다.
   ```ts
   /** 적용하면 함께 지킬 수 없게 되는 기존 필요 인원 규칙(step 0 findCoverageConflict). 대기 카드에만 */
   conflict?: ConstraintSpec;
   ```
   - `pending && conflict`일 때, 기존 `orphan` 경고와 같은 자리(해석 아래, 버튼 줄 위)에 주의 색(`text-[#A15C07]`)으로 한 줄을 둔다:
     `기존 규칙 “{conflict.source_text}”과 함께 지킬 수 없어요` — 원문이 `COVERAGE_SOURCE_TEXT`("필요 인원 설정")이면 원문 대신 `describeRule(conflict, …).text`를 쓴다(폼으로 만든 규칙은 원문이 없다). 조사(과/와)는 `lib/wording.ts`의 `josa`로 맞춘다.
   - 그 줄 끝에 Text 버튼 **[기존 규칙 끄기]**(`ui.textSm`)를 둔다. 누르면 `store.removeRule(conflict.id)`를 부른다. 필요 인원 규칙은 모두 `default: true`라 지워지지 않고 `enabled: false`가 된다(`removeRule` 구현을 확인하라). 버튼 옆에 보조 글자 `매장 조건에서 꺼져요`를 둔다.
   - `role="status"`는 쓰지 않는다(경고는 카드 안 정보다). `aria-live`도 두지 않는다.
   - 기존 규칙을 끄면 `conflict`가 다시 계산되어 경고가 사라진다(RulesStep이 매 렌더마다 계산하므로 카드가 상태를 들고 있을 필요가 없다).
2. `components/RulesStep.tsx`의 `renderCard`에서 `scope === "shop"`인 대기 카드에 `conflict`를 넘긴다.
   - 비교 대상 규칙: `stepPeriod`가 있으면(근무표 작성 ②) `liveShopRules(shop, stepPeriod)`(이번 근무표에서 끈 것과 수정본을 반영), 없으면(매장 설정) `shop.rules.filter((r) => r.enabled !== false)`.
   - 그 목록에서 `findReplaced(shop.rules, c)`가 돌려주는 규칙은 뺀다(같은 모양·같은 날짜 종류의 카드는 `기존 규칙 대체`로 이미 안내한다).
   - `period`는 `stepPeriod ?? previewRange(shop.unit)`, `holidays`는 `stepPeriod?.holidays ?? []`.
   - 설정 변경 카드에 딸린 규칙 카드(`withConfig`)에도 같은 `conflict`를 넘긴다.
3. `기존 규칙 대체`와 충돌 경고가 동시에 보이는 경우는 없어야 한다(2에서 대체 규칙을 뺐으므로). 둘 다 보이면 2를 다시 확인하라.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 판정 로직이 `lib/coverage-conflict.ts`에만 있고 컴포넌트에는 호출만 있는가?
   - UI_GUIDE "문구" 표의 말만 썼는가(hard/soft, 제약, 초안 같은 개발 용어 없음)?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 수동 체크(`npm run dev`, 테스트 계정 또는 `npm run seed`): 매장 설정 [매장 조건]에서 "주말 오픈 2명 이상"을 만들면(기본 필요 인원이 "정확히"일 때) 대기 카드에 경고와 [기존 규칙 끄기]가 보이고, 누르면 경고가 사라지며 기존 카드가 `꺼짐`이 된다. LLM 키가 없으면 이 체크는 건너뛰고 summary에 적는다.
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구·접근성 이름·버튼 위치를 적어라**(경고 문장 전문, 버튼 이름 "기존 규칙 끄기", 어느 카드·어느 자리). 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 확인 대화상자를 두지 마라. 이유: 끄기는 [다시 켜기]로 되돌릴 수 있다(UI_GUIDE 원칙 7).
- 기존 규칙을 자동으로 끄거나 값을 바꾸지 마라. 이유: 결정은 사람이 한다(UI_GUIDE 원칙 6).
- 적용된 카드나 요청(`scope: "period"`) 카드에 경고를 두지 마라. 이유: 이 경고는 "적용하는 순간"의 안내다. 적용 뒤의 충돌은 ③의 해 없음 패널이 맡는다.
- `lib/coverage-conflict.ts`의 판정 조건을 바꾸지 마라. 이유: step 0의 테스트가 기준이다. 조건이 모자라면 summary에 적어라.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
