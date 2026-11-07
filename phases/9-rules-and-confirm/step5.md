# Step 5: default-fairness

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` — "핵심 기능 1"(기본값: 규칙은 반드시, 고르게는 가능하면·낮음), "기본 규칙"
- `/docs/ARCHITECTURE.md` — "제약 단일 표현"(모든 제약은 `enabled`), "상태 관리 › 저장"
- `/docs/UI_GUIDE.md` — "매장 설정 › 탭 [매장 조건]"(기본 규칙 카드는 `기본` 배지, [삭제] 대신 [끄기]), "규칙·요청 카드"
- `/lib/rules.ts` — `normalizeRule`, `ruleShape`(`max_run`: `per: "person_window"`, `window = max_len + 1`, 값 이름 `max_len`; `balance`), `PRIORITY_WEIGHTS`
- `/lib/test-rules.ts` — `maxRun`, `balance`, `WORK` 빌더(기본 규칙의 식 모양을 이것과 같게 만든다)
- `/lib/store.ts` — `emptyShop`, `loaded`, `persisted`, `isData`, `createAppStore` 안에서 서버 문서를 읽어 `replace(ok ? loaded(state) : …)`하는 곳, persist 설정(`merge`/`onRehydrateStorage`가 있으면 그 경로), `findReplaced`, `replaceKey`, `upsert`, `removeRule`, `COVERAGE_SOURCE_TEXT`, `COVERAGE_RULE_PREFIX`
- `/lib/store.test.ts` — "초기 상태", "매장 규칙 카드", "persist" describe
- `/lib/wording.ts` — `shopRuleCount`(필요 인원만 빼고 센다 → 새 기본 규칙 2개는 "매장 조건 N개"에 들어간다), `presetName`(`최대 연속 근무`, `고르게 규칙`), `describeRule`
- `/components/ConstraintCard.tsx` — `isDefault`(`기본` 배지, [매장 조건에서 끄기]), `fieldsOf`(값 수정)
- `/e2e/fixtures/shop-oct.json`, `/lib/samples/shop-12.json` — 저장 매장 예. `shop-oct.json`에는 이미 `rule-max-run`·`rule-close-fair`가 있다

## 배경

매니저가 규칙을 하나도 적지 않으면 근무가 한 사람에게 몰릴 수 있다. 공정성 기본 규칙 두 개를 `기본` 배지 카드로 둔다: **최대 연속 근무 5일**(가능하면·보통)과 **근무 수 고르게**(가능하면·낮음). 새 매장뿐 아니라 저장된 매장을 불러올 때도 없으면 더한다. 매장 설정에서 끄거나(영구, `enabled: false`) 값을 바꿀 수 있다. 기본 규칙은 지우지 않고 끈다(필요 인원과 같다).

## 작업

TDD: `lib/store.test.ts`에 테스트를 먼저 쓴다.

1. `lib/store.ts`:
   ```ts
   export const FAIRNESS_RULE_IDS = { maxRun: "fair-max-run", balance: "fair-balance" } as const;
   /** 공정성 기본 규칙 두 개(가능하면): 최대 연속 근무 5일(보통), 근무 수 고르게(낮음). normalizeRule을 거친 모양. */
   export function defaultFairnessRules(): ConstraintSpec[];
   /** 공정성 기본 규칙이 없으면 더한다(id가 같거나 findReplaced로 같은 모양이 있으면 더하지 않는다). 있으면 그대로. */
   export function withDefaultRules(shop: Shop): Shop;
   ```
   - 최대 연속 근무: `lib/test-rules.ts`의 `maxRun(WORK, 5)`와 같은 식 — `for_each: { per: "person_window", window: 6 }`, `then: { left: { shifts: { not_in: ["O"] } }, op: "le", right: { value: "max_len" } }`, `values: { max_len: { value: 5, label: "최대 연속 근무" } }`, `hardness: "soft"`, `priority: "normal"`, `default: true`, `scope: "shop"`, `source_text: "연속 근무는 5일까지"`. `ruleShape`가 `{ kind: "max_run" }`을 돌려주고 `presetName`이 "최대 연속 근무"인지 테스트한다.
   - 근무 수 고르게: `balance` — `people: {}`, `days: { kind: "all" }`, `shifts: { not_in: ["O"] }`, `measure: "count"`, `with_history: true`, `max_gap: 1`, `hardness: "soft"`, `priority: "low"`, `default: true`, `source_text: "근무 수는 고르게"`. `presetName`이 "고르게 규칙", `describeRule(...).text`가 "근무 수를 고르게(최근 4주 포함)"로 시작하는지 테스트한다(정확한 문장은 `lib/wording.ts`가 만든다. 테스트는 그 결과를 적는다).
   - `withDefaultRules`는 (1) 같은 id가 있거나 (2) `findReplaced(shop.rules, 기본 규칙)`이 있으면(사용자가 말로 만든 "연속 근무 6일까지"처럼 같은 모양) 더하지 않는다. 더할 때는 `rules` 뒤에 붙이고 `cardOrder`는 건드리지 않는다(기본 규칙은 RulesStep이 맨 위로 올린다).
   - 적용 위치: `emptyShop()`(새 매장), `loaded()`(서버 문서를 읽을 때), 그리고 localStorage 캐시에서 되살릴 때 쓰는 경로(persist의 `merge`나 rehydrate 뒤 처리가 따로 있으면 거기도). `shop === null`이면 그대로. 어느 경로가 있는지 코드를 읽고 summary에 적는다.
   - 테스트: 새 매장(`startShop`)에 두 규칙이 있고 `shopRuleCount`가 2; 기본 규칙 없는 문서를 remote mock으로 불러오면 더해진다; `enabled: false`로 끈 문서를 불러오면 꺼진 채 유지되고 다시 더하지 않는다; `rule-max-run`(같은 모양, 다른 id)이 있는 문서(`e2e/fixtures/shop-oct.json`을 읽어도 된다)는 `fair-max-run`을 더하지 않고 `fair-balance`만 더한다; `removeRule("fair-max-run")`은 지우지 않고 끈다; `setRuleValue("fair-max-run", "max_len", 6)`이 `window`를 7로 바꾼다(`withRuleValue`가 이미 그렇게 하는지 확인하고 아니면 summary에 적는다 — 고치지 않는다).
2. 화면은 기존 컴포넌트로 충분해야 한다: 매장 설정 [매장 조건]에 `기본` 배지로 보이고 [수정]에서 `max_len`을 바꾸고 [매장 조건에서 끄기]로 끈다. 고르게 규칙은 값이 없어 [수정]이 없고 중요도·끄기만 된다. 컴포넌트에 손댈 일이 없는지 확인하고, 있으면 최소로 고친 뒤 summary에 적는다.
3. `scripts/seed.ts`가 `lib/samples/shop-12.json`을 그대로 올린다면 바꾸지 않는다(불러올 때 더해진다).

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 기본 규칙이 `normalizeRule`을 거친 모양이라 `/solve` 요청에 그대로 들어가는가(`toScheduleRequest` 결과에 두 규칙이 `enabled: true`로 있는지 테스트로 확인)?
   - 저장 문서 `version`(`STORAGE_VERSION`)을 올리지 않았는가(옛 형식 변환을 두지 않는다는 ARCHITECTURE 규칙. 더하기는 변환이 아니라 정규화다)?
   - `backend/`를 손대지 않았는가?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`): 매장 설정 [매장 조건] 맨 위에 `기본` 카드 3종(필요 인원 폼 모양은 요약표에 숨고, 최대 연속 근무·고르게 규칙 카드가 보임). 홈 요약 "매장 조건 N개"가 2 늘었다. ③ 근무표 만들기가 해를 낸다.
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(함수 시그니처, 규칙 id·원문·식 모양, 적용한 불러오기 경로, 카드 제목·문장)"`. **바뀐 화면 문구·접근성 이름을 적어라**(카드 제목, 원문, 해석 문장, 매장 조건 수 변화). 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 기본 규칙을 반드시(hard)로 두지 마라. 이유: PRD "기본값: 고르게는 가능하면". 반드시면 작은 매장에서 해가 없어진다.
- 사용자가 끈 기본 규칙(`enabled: false`)을 불러올 때 다시 켜거나 다시 더하지 마라. 이유: 매니저의 결정이다.
- 같은 모양의 사용자 규칙이 있을 때 기본 규칙을 더하지 마라. 이유: 같은 규칙이 둘이면 `기존 규칙 대체` 로직과 충돌 설명이 꼬인다.
- `lib/samples/shop-12.json`·`e2e/fixtures/shop-oct.json`에 규칙을 손으로 넣지 마라. 이유: 불러오기 정규화가 더하는 것을 테스트해야 한다.
- 기본 규칙에 `cov-` 접두사를 쓰지 마라. 이유: `cov-`는 필요 인원 폼 규칙 id다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다. 이 step이 soft 규칙 2개를 더해 e2e의 근무표 결과가 달라질 수 있다는 것을 summary에 적어라.
- 기존 테스트를 깨뜨리지 마라.
