# Step 3: demo-route-shell

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — UI는 TDD 대상이 아니다. build·lint로 검증한다
- `/docs/ARCHITECTURE.md` — "디렉토리 구조 › app/", "상태 관리"
- `/docs/UI_GUIDE.md` — "화면 목록", "상단 바", "로그인 화면", 버튼 크기, 배지, "강조 바탕 패널", 문구 규칙(개발 용어 금지)
- `/docs/ADR.md` — ADR-014(클라이언트에서만 인증), ADR-020(로그인 필요)
- `/app/app/page.tsx` — 앱 진입(클라이언트에서만 `AppShell`을 렌더하는 이유)
- `/components/AppShell.tsx` — 인증 확인(`authChecked`, `onAuthChange`), `loading`·`started`·`loginScreen` 분기, 상단 바와 탭 줄, 배너
- `/components/Account.tsx` — `AccountBar`, `useGoogleLogin`, `LoginButton`(로그인으로 보내는 방식)
- `/components/Dialog.tsx` — 공용 대화상자 props
- `/components/RulesStep.tsx` — `today()`(클라이언트 오늘 날짜)
- `/components/ui.ts` — 클래스 토큰(`badge`, `badgeTone`, `primarySm`, `textSm`, `banner`, `panel`)
- `/lib/store.ts` — step 2가 더한 `demo`, `enterDemo`, `exitDemo`, `signedIn` 가드
- `/lib/demo.ts`, `/lib/demo-doc.ts` — `demoData(DEMO_DOC, today)`
- `/lib/supabase.ts` — `supabaseConfigured`, `onAuthChange`, `signInWithGoogle`

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝)을 실제 앱 화면으로 눌러 본다. 체험은 **로그인 전 전용**이다. 로그인한 사용자는 자기 매장이 있으므로 `/demo`에 오면 `/app`으로 보낸다.

이 step은 진입 라우트와 셸(상단 바)만 만든다. ①·매장 홈의 링크 호출(step 4), ③의 설명·확정과 ②의 입력 바(step 5), 랜딩 버튼(step 6)은 뒤에 온다. 이 step이 끝나면 `/demo`에서 ② 매장 조건 화면이 한강 다이닝 데이터로 보이고, 카드 끄기·값 조정과 [매장 설정] 탭이 동작한다. 아직 ①에서 링크를 만들려다 실패 문구가 뜨고 ③에서 가능 시간을 읽다 실패할 수 있다(step 4·5가 고친다).

## 작업

1. **`app/demo/page.tsx`**(새 파일): `app/app/page.tsx`와 같은 방식으로 `AppShell`을 `ssr: false`로 동적 import하되 `<AppShell demo />`를 렌더한다. `metadata`는 두지 않는다(클라이언트 컴포넌트).

2. **`components/Demo.tsx`**(새 파일):

   ```tsx
   /** 체험을 끝내고 Google 로그인으로 간다. 실패하면 error. Account.tsx의 useGoogleLogin과 같은 모양이되 exitDemo를 먼저 부른다. */
   export function useStartOwnShop(): { busy: boolean; error: boolean; start: () => Promise<void>; label: string };

   /** 체험 상단 바 오른쪽: "체험 중" 배지 + 안내 + [내 매장으로 시작하기] Primary(작은 크기) + [나가기] Text. */
   export function DemoBar(): JSX.Element;

   /** 체험에서 막는 동작을 눌렀을 때의 대화상자(확정 등). Primary [내 매장으로 시작하기](useStartOwnShop), Secondary [닫기]. */
   export function DemoGateDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }): JSX.Element;
   ```

   - `DemoBar` 문구: 배지 "체험 중"(`ui.badge` + `ui.badgeTone.draft`), 옆에 `ui.help`로 "저장되지 않아요", [내 매장으로 시작하기](`ui.primarySm`, 누르면 `start()`; busy면 "이동 중…"), [나가기](`ui.textSm`, `exitDemo()` 뒤 `router.push("/")`). 로그인 실패 문구는 `Account.tsx`의 `LOGIN_ERROR`와 같은 문장을 쓴다.
   - `DemoGateDialog`는 `Dialog`를 감싼다. `primary`의 label은 `useStartOwnShop().label`, `disabled`는 busy.

3. **`components/AppShell.tsx`**에 `demo?: boolean` prop(기본 false):
   - 인증 구독(`onAuthChange`)은 그대로 걸되, 콜백에서 `demo`면 `signedOut()`을 부르지 않는다. 사용자가 있으면 `signedIn`도 부르지 않고 `hasUser` 상태만 올린다.
   - `demo`일 때 `authChecked`가 되면: 사용자가 있으면 `router.replace("/app")`, 없으면 `enterDemo(demoData(DEMO_DOC, today()))`. `supabaseConfigured`가 false면 바로 `enterDemo`. 이 effect는 한 번만 돈다(React StrictMode의 이중 실행에 대비해 `enterDemo`는 이미 체험 중이면 다시 `replace`하지 않게 가드하거나, `useRef`로 한 번만 부른다).
   - 언마운트 시 `exitDemo()`(랜딩으로 돌아가면 메모리 상태를 비운다).
   - `loading`: `demo`면 `!authChecked || shop === null`("불러오는 중…"). `started`: `demo`면 `shop !== null && !loading`. `loginScreen`: `demo`면 false.
   - 상단 바 오른쪽: `demo`면 `<DemoBar />`, 아니면 지금처럼 `AccountBar`. 워드마크는 `demo`에서 `href="/"`(랜딩으로). 탭 줄 [매장 설정] [근무표]는 체험에서도 보인다.
   - `main` 맨 위(저장소 배너 자리)에 `demo`면 `role="status"` 안내 한 줄: `rounded-lg border border-[#CFE4EA] bg-[#F0F6F8] px-4 py-2.5 text-sm text-[#1B1B18]`로 "샘플 매장 한강 다이닝을 눌러 보고 있어요. 바꾼 내용은 저장되지 않고, 새로고침하면 처음으로 돌아가요." (경고색 `ui.banner`는 쓰지 않는다. 오류가 아니다.)
   - `demo`에서는 `syncStatus === "error"` 배너와 저장소 없음 배너를 보여 주지 않는다.
   - `useRouter`는 `next/navigation`.

4. 수동 확인(가능하면): `npm run dev`를 띄우고 `http://localhost:3000/demo`를 열어 ② 매장 조건이 한강 다이닝(직원 20명, 대기 카드 2장)으로 보이는지, 상단 바에 "체험 중"과 두 버튼이 있는지, [나가기]가 랜딩으로 가는지 본다. 확인했으면 summary에 적고, 못 했으면 "수동 체크: 확인 못 함"이라고 적는다.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `/demo`가 Supabase에 쓰는 경로가 없는가(인증 구독은 읽기만)?
   - 로그인한 사용자가 `/demo`에서 `/app`으로 가는가? `enterDemo`가 로그인 상태에서 불리지 않는가?
   - 체험 화면 문구에 개발 용어(`demo`, `샘플 데이터`, `mock`)가 없는가(UI_GUIDE "문구")? 화면에는 "체험"이라고 쓴다.
   - `lib/`·`backend/`가 바뀌지 않았는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 내보낸 컴포넌트·훅 시그니처, AppShell 분기, 화면 문구)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `/demo`를 서버 컴포넌트나 미들웨어로 보호하지 마라. 이유: 인증은 클라이언트에서만 한다(ADR-014).
- `app/app/page.tsx`의 비체험 흐름을 바꾸지 마라. 이유: 로그인 사용자의 동작은 그대로여야 한다.
- 체험에서 `AccountBar`(저장 상태, 로그아웃, 내 매장 데이터 삭제)를 보여 주지 마라. 이유: 저장도 계정도 없다.
- ①·③·②의 내용(링크, 설명, 입력 바)을 이 step에서 고치지 마라. 이유: step 4·5가 한다.
- 기존 테스트를 깨뜨리지 마라.
