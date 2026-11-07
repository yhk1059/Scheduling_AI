# Step 2: store-demo-mode

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/`는 TDD, 백엔드는 무상태, DB는 클라이언트 + RLS
- `/docs/ARCHITECTURE.md` — "상태 관리 › 저장"(localStorage는 캐시, 로그아웃하면 비움)
- `/docs/ADR.md` — ADR-014(저장과 인증), ADR-016(샘플이 내 매장과 같은 저장소를 쓰면서 생긴 문제 — 이번에는 저장소를 분리한다), ADR-020(게스트 모드 없음)
- `/lib/store.ts` — `createAppStore` 전체: `safeStorage`, `persist` 옵션, `replace`, `signedIn`(서버 문서가 없으면 캐시를 올리는 분기), `signedOut`, `retrySave`, 저장 구독(`store.subscribe`)
- `/lib/store.test.ts` — `MemoryStorage`, 가짜 `ShopRemote`, 로그인·로그아웃 테스트 작성 방식
- `/lib/demo.ts` — `demoData`(체험 시작 `Data`)
- `/node_modules/zustand/esm/middleware.mjs`의 `setOptions`(약 446행) — persist 저장소를 실행 중에 바꾸는 API

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝)을 실제 앱 화면으로 눌러 본다. 상태는 메모리에만 두고 저장하지 않는다.

앱의 모든 컴포넌트가 `useAppStore` 싱글턴을 쓰므로(130여 곳) 스토어 인스턴스를 나누지 않고, **싱글턴에 체험 모드를 둔다**. 핵심 안전장치 두 가지:

1. 체험 데이터가 **localStorage에 남지 않는다**. 체험 중에는 persist 저장소를 메모리로 바꾼다.
2. 체험 중 [내 매장으로 시작하기]로 로그인해도 **체험 데이터가 그 사람의 매장으로 올라가지 않는다**. `signedIn`은 서버 문서가 없으면 "캐시(`hasInput()`)"를 올리는데, 체험 데이터가 그 캐시로 오인되면 안 된다. `signedIn`이 체험을 먼저 끝낸다.

이전 샘플(ADR-016)은 내 매장과 같은 저장소를 써서 갈림길마다 확인 장치가 붙었다. 이번에는 저장소를 분리해 확인 장치 없이 간다.

## 작업

TDD: `lib/store.test.ts`에 `describe("체험")`을 먼저 쓰고, 통과하는 구현을 `lib/store.ts`에 더한다.

1. `AppState`에 추가(persist 대상 아님 — `partialize`는 `Data`만 저장하므로 자동으로 빠진다):

   ```ts
   /** 체험 중(/demo). persist 저장소는 메모리이고 서버 저장은 없다 */
   demo: boolean;
   /** 체험 시작. 로그인 상태(auth !== null)면 아무것도 하지 않는다. persist 저장소를 메모리로 바꾼 뒤 data를 올린다(replace). */
   enterDemo: (data: Data) => void;
   /** 체험 끝. 체험 중이 아니면 아무것도 하지 않는다. 초기 상태로 되돌리고 persist 저장소를 원래(localStorage)로 되돌린다. 메모리 저장소는 비운다. */
   exitDemo: () => void;
   ```

2. 구현 규칙:
   - `createAppStore` 안에 메모리 `PersistStorage<Data>`를 하나 더 만든다(`Map` 기반이면 된다. `safeStorage`를 메모리 `Storage`로 한 번 더 부르거나 직접 구현한다).
   - `enterDemo`: `store.persist.setOptions({ storage: memory })` → `set({ demo: true })` → `replace(data)`. 순서를 지켜라(바꾸기 전에 `replace`하면 체험 데이터가 localStorage에 한 번 쓰인다).
   - `exitDemo`: `replace(initialData(), { demo: false })` → 메모리 저장소 비우기 → `store.persist.setOptions({ storage: 원래 })`. 이 순서면 초기 상태가 메모리에 쓰이고 localStorage는 건드리지 않는다. 그 뒤 localStorage의 옛 키는 그대로다(로그인 전이라 비어 있다).
   - `signedIn(user)`: 맨 앞에서 `if (get().demo) get().exitDemo();`. 그래야 `hasInput()`이 false가 되어 빈 매장을 올린다.
   - `signedOut()`: 체험 중이면 아무것도 하지 않는다(AppShell의 인증 구독이 "로그인 없음"으로 체험을 지우지 않게).
   - `retrySave`, 저장 구독: 체험 중에는 `auth`가 null이라 이미 저장하지 않는다. `demo`를 한 번 더 확인하는 가드를 더해도 된다.
   - 액션 안에서 `store.persist`를 쓸 때 `store`는 `create()` 결과 변수다. 액션은 나중에 불리므로 클로저로 참조해도 된다.

3. 테스트(`lib/store.test.ts` `describe("체험")`). 기존 테스트의 store 생성 방식(`MemoryStorage`, 가짜 remote)을 따른다. `demoData` 대신 테스트 안에서 작은 `Data`(매장 이름 "샘플", 직원 1명, 기간 1개)를 만든다.
   - `enterDemo(data)` 뒤 `demo === true`, `shop.name === "샘플"`, 그리고 **`setShopName("바꿈")` 뒤에도 주어진 `MemoryStorage`(localStorage 역할)에 "바꿈"이 없다**(`getItem(STORAGE_KEY)`가 null이거나 "바꿈"을 포함하지 않는다)
   - `exitDemo()` 뒤 `demo === false`, `shop === null`, `periods` 빈 배열. 그 뒤 `startShop(); setShopName("내 매장")`을 하면 localStorage에 "내 매장"이 쓰인다(저장소가 되돌아왔다)
   - `auth`가 있는 상태(가짜 remote로 `signedIn` 완료)에서 `enterDemo`는 아무것도 하지 않는다(`demo === false`, 매장 그대로)
   - 체험 중 `signedIn(user)`(remote.load가 null) → `demo === false`, `remote.save`가 받은 문서의 `state.shop.name`이 `""`(빈 매장)이고 "샘플"이 아니다
   - 체험 중 `signedOut()` → 여전히 `demo === true`, `shop.name === "샘플"`
   - `enterDemo` 전에 localStorage에 있던 다른 값(예: 로그인 실패 캐시)은 체험이 끝난 뒤에도 그대로다

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 체험 중 localStorage에 쓰는 코드 경로가 없는가(`persist` 저장소 교체 순서)?
   - `signedIn`이 체험을 먼저 끝내는가?
   - 저장 문서 모양(`Data`, `STORAGE_VERSION`)과 `backend/`가 바뀌지 않았는가?
   - `demo`·`enterDemo`·`exitDemo` 외에 기존 액션의 동작이 바뀌지 않았는가(기존 테스트 전부 통과)?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(추가된 상태·액션 시그니처, 저장소 교체 방식, 가드 위치)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 스토어 인스턴스를 둘로 나누거나 Context로 바꾸지 마라. 이유: 호출처가 130여 곳이라 변경 범위가 너무 크다. 싱글턴에 플래그로 한다.
- `demo`를 persist에 넣지 마라. 이유: 새로고침하면 체험은 처음부터다(URL이 `/demo`면 다시 들어간다).
- 체험 상태를 Supabase에 저장하는 경로를 만들지 마라. 이유: 체험은 로그인 전 전용이다.
- `components/`·`app/`을 고치지 마라. 이유: step 3이 한다.
- 기존 테스트를 깨뜨리지 마라.
