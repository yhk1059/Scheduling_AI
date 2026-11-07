# Step 1: demo-gen-script

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/`의 순수 함수는 TDD, 스크립트의 순수 부분도 테스트한다(`scripts/*.test.ts`)
- `/docs/ARCHITECTURE.md` — "디렉토리 구조 › scripts/, lib/samples/", "API 계약"(`/translate`, `/solve`, `/explain`의 요청·응답 모양), "환경"
- `/docs/DEMO_SCENARIO.md` — 한강 다이닝: 근무조 시각, 직원 20명과 가능 시간, 말로 적을 문장 10개, "이야기의 장치"(화요일 주방 마감 리더 불가능), 검증 결과
- `/lib/demo.ts` — step 0이 만든 `DemoDoc`, `demoData`, `requestSignature`(이 step이 만드는 JSON의 모양)
- `/scripts/record-dining.ts` — `ROSTER`, `Hours`, `SHOP_NAME`, `SHIFT_EDITS`, `LIVE_SENTENCES`, `PRESET_SENTENCES`, `slotsFor`, 문장을 미리 번역해 적용하는 방식(`/api/py/translate` 호출과 `context`)
- `/scripts/record-dining.test.ts` — 데이터 테스트(옮긴 뒤에도 통과해야 한다)
- `/scripts/record-kit.ts` — `env`
- `/lib/store.ts` — `createAppStore(getStorage, now?, remote?)`, `startShop`, `setShopName`, `setUnit`, `addEmployees`, `setShift`, `addPendingRules`, `applyRule`, `refEmployees`, `toScheduleRequest`, `newPeriod`
- `/lib/store.test.ts` — 메모리 `Storage`로 store를 만드는 방식(`MemoryStorage`)
- `/backend/gen_demo.py` — 기존 생성 스크립트의 출력 방식(compact JSON + 줄바꿈)
- `/package.json` — `scripts`(`gen:*`, `vite-node`)

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝, 직원 20명)을 실제 앱 화면으로 눌러 본다. 자유 입력은 없고 버튼만 누른다. LLM 엔드포인트는 부르지 않고 솔버만 실제로 부른다.

이 step은 체험 데이터 `lib/samples/demo-shop.json`을 **한 번 만들어 저장소에 두는 스크립트**를 만들고 실제로 돌린다. 문장 10개의 번역(규칙 카드)과 해 없음 설명(제안 포함)을 지금 미리 받아 두면, 체험할 때는 LLM이 필요 없다. 앱이 만드는 것과 같은 카드가 나오도록 **실제 store 액션**(`addPendingRules`, `applyRule`)으로 매장을 만든다. 스크립트가 카드 모양을 흉내 내지 않는다.

## 작업

1. **데이터 모듈 분리**: `scripts/record-dining.ts`의 시나리오 데이터(`Hours`, `F`·`AM`·`PM`·`E20`·`N`, `wk`, `all`, `ROSTER`, `TYPED_STAFF`, `SCREEN_EMPLOYEE`, `SHOP_NAME`, `SHIFT_EDITS`, `LIVE_SENTENCES`, `PRESET_SENTENCES`, `slotsFor`)를 새 파일 `scripts/dining-data.ts`로 옮긴다. `record-dining.ts`는 거기서 import하고, 지금 내보내던 이름은 그대로 re-export해서 `record-dining.test.ts`가 바뀌지 않게 한다. `dining-data.ts`는 Playwright·Supabase를 import하지 않는다(가벼운 모듈이어야 vitest에서 바로 쓴다).

2. **`scripts/gen-demo-shop.ts`**(새 파일). `npm run gen:demo-shop`(`package.json`에 `"gen:demo-shop": "vite-node scripts/gen-demo-shop.ts"` 추가).

   ```ts
   /** 순수: ROSTER와 기준 주로 직원 id별 가능 시간. 직원 id는 명단 순서대로 e01, e02, …(store의 addEmployees가 매기는 것과 같다). */
   export function demoAvailability(base: PeriodRange): Record<string, AvailabilitySlots>;

   /** 순수: 빈 store에 한강 다이닝 매장을 만든다(이름, 1주 단위, 직원 20명과 태그, SHIFT_EDITS의 근무조 시각·실근무 시간). 번역은 하지 않는다. */
   export function seedDiningShop(store: ReturnType<typeof createAppStore>): void;

   async function main(): Promise<void>;
   ```

   `main`의 절차:
   1. `process.loadEnvFile(".env.local")`. `GET http://127.0.0.1:8000/api/py/health`가 200이 아니면 "먼저 npm run fastapi-dev를 띄워 주세요"로 throw. (백엔드가 `.env.local`의 `ANTHROPIC_API_KEY`를 읽는다. 이 스크립트는 키를 읽지 않는다.)
   2. `createAppStore(() => memoryStorage)`로 store를 만든다(`lib/store.test.ts`의 `MemoryStorage`처럼 `Storage`를 흉내 낸 객체. remote는 넘기지 않는다). `seedDiningShop(store)`.
   3. 기준 주 `base = periodFrom("1w", "2026-11-09")`. `store.setState`로 `periods: [{ ...newPeriod(base), holidays: [], availability: demoAvailability(base) }]`를 넣는다.
   4. `PRESET_SENTENCES`를 **차례로**(동시에 보내지 않는다) `POST /api/py/translate`에 보낸다. 요청 본문은 `record-dining.ts`가 쓰던 것과 같다: `{ text, scope: "shop", context: { config, employees, period, holidays, today }, input_version: 0 }`. `context`의 `config`·`employees`·`period`·`holidays`는 `toScheduleRequest(shop, period, periods, today)`에서, `today`는 `base.start_date`. 응답이 `status: "ok"`가 아니면 그 문장과 응답으로 throw. ok면 `store.getState().addPendingRules(constraints, config_changes ?? [], examples ?? {})`를 부르고, 새로 생긴 대기 카드 id마다 `applyRule(id)`한다.
      - 검사: 번역된 규칙 중 `refEmployees(규칙)`이 비어 있지 않은 것(태그 대신 직원 id로 묶인 것)이 있으면 그 문장을 다시 번역한다(최대 3회, 그래도 그러면 throw). 이유: 체험에서 "신입" 규칙이 직원 4명 id로 묶이면 카드 문장이 길고 뜻이 흐려진다(DEMO_SCENARIO "남은 위험").
   5. `LIVE_SENTENCES`도 같은 방식으로 번역해 `addPendingRules`까지만 한다(적용하지 않는다). 여기서 `shopDoc = structuredClone(store.getState().shop)`을 떠 둔다. 이것이 JSON의 `shop`이다(대기 카드 2장이 남은 상태).
   6. 대기 카드를 모두 `applyRule`한 뒤 `req = toScheduleRequest(shop, period, periods, base.start_date)`를 만들고 `POST /api/py/solve`(`{ ...req, input_version: 0 }`). 응답 `status`가 `"infeasible"`이 아니면 "시나리오가 깨졌어요: 해 없음이 아니에요"로 throw(DEMO_SCENARIO의 P1은 해가 없어야 한다).
   7. `POST /api/py/explain`(`{ request: { ...req, input_version: 0 }, conflicts }`). `proposals` 중 `verified_summary`가 있는 것이 하나도 없으면 다시 부른다(최대 3회, 그래도 없으면 throw). 이유: 검증된 제안이 없으면 체험의 클라이맥스(대안 수락)가 없다.
   8. `DemoDoc` 모양으로 쓴다: `{ version: STORAGE_VERSION, shop: shopDoc, base, availability, explanation: { signature: requestSignature(req), response: { text, proposals, fallback } } }`. `lib/samples/demo-shop.json`에 compact JSON(들여쓰기 없음, `JSON.stringify(doc)` + `"\n"`)으로 저장한다. 끝에 직원 수, 적용된 규칙 수, 대기 카드 수, 검증된 제안 수를 출력한다.

3. **`lib/demo-doc.ts`**(새 파일): JSON을 타입으로 묶어 내보낸다. 화면과 테스트가 이것만 import한다.

   ```ts
   import demoShop from "./samples/demo-shop.json";
   import type { DemoDoc } from "./demo";

   export const DEMO_DOC = demoShop as unknown as DemoDoc;
   ```

4. **테스트**
   - `scripts/gen-demo-shop.test.ts`: `demoAvailability(base)`가 20명 중 가능 시간이 있는 직원을 모두 담고 서민호(`e02`)는 화요일(11/10) 키가 없다 / `seedDiningShop`으로 만든 store의 매장이 이름 "한강 다이닝", 직원 20명(태그 포함), 근무조 A 09:00~14:00(5시간)·M 12:00~16:00(4시간)·C 17:00~21:00(4시간)이다. 네트워크는 쓰지 않는다.
   - `lib/demo-doc.test.ts`(생성된 JSON을 검사한다): `version === STORAGE_VERSION` / 직원 20명 / `pendingRules` 2장, 그 `source_text`가 `LIVE_SENTENCES`(scripts에서 import하지 말고 문장을 테스트에 적는다) / `rules`에 `PRESET_SENTENCES` 8문장의 `source_text`가 모두 있다 / `availability`에 20명 모두 있고 서민호(`e02`)는 11/10 키가 없다 / `explanation`이 null이 아니고 검증된 제안이 1개 이상 / **일관성**: `demoData(DEMO_DOC, "2026-11-09")`로 store 상태를 만들고(`createAppStore` + `setState`) 대기 카드를 모두 `applyRule`한 뒤 `toScheduleRequest`로 만든 요청의 `requestSignature`가 `explanation.signature`와 같다 / 규칙 중 `refEmployees`가 비어 있지 않은 것이 없다.

5. **스크립트 실행**: 백엔드를 백그라운드로 띄우고(`uv run uvicorn api.index:app --port 8000 &`, health가 200일 때까지 기다린다) `npm run gen:demo-shop`을 돌린 뒤 백엔드를 끈다. 번역 10회와 설명 1~3회로 2~5분 걸린다. 끝나면 `lib/samples/demo-shop.json`을 저장소에 둔다(커밋 대상). 실행 결과(제안 수, 재시도 횟수)를 summary에 적는다.
   - `ANTHROPIC_API_KEY`가 없거나 LLM이 계속 실패하면 `blocked`로 두고 멈춘다(사용자가 돌린다).

## Acceptance Criteria

```bash
npx vitest run scripts/gen-demo-shop.test.ts scripts/record-dining.test.ts
npm run gen:demo-shop   # 백엔드(:8000)가 떠 있어야 한다. lib/samples/demo-shop.json 생성
npx vitest run lib/demo-doc.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `scripts/dining-data.ts`와 `gen-demo-shop.ts`가 앱 코드(`components/`)를 import하지 않는가? `lib/`는 써도 된다.
   - 스크립트가 Supabase를 쓰지 않는가(체험 데이터는 DB와 무관하다)?
   - JSON에 직원 이름 외의 개인정보가 없는가(가명·시나리오 이름뿐)?
   - `backend/`가 바뀌지 않았는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 함수 시그니처, JSON 크기, 규칙·제안 수, 재시도 횟수)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(API 키, 백엔드가 뜨지 않음) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 카드(규칙 JSON)를 손으로 쓰거나 스크립트에서 조립하지 마라. 이유: 앱이 만드는 카드(normalizeRule, default 플래그, cardOrder, examples)와 달라진다. 반드시 `/translate` 응답을 store 액션으로 넣어라.
- 번역 요청을 `Promise.all`로 한꺼번에 보내지 마라. 이유: 재번역 검사와 cardOrder가 문장 순서를 따라야 한다.
- `lib/store.ts`·`components/`·`app/`을 고치지 마라. 이유: step 2 이후가 한다.
- `.env.local`의 키 값을 출력하거나 JSON에 넣지 마라.
- `lib/demo-doc.ts`를 `lib/demo.ts`에 합치지 마라. 이유: step 0의 순수 함수 테스트가 JSON에 묶이지 않게 한다.
- 기존 테스트를 깨뜨리지 마라(특히 `scripts/record-dining.test.ts`).
