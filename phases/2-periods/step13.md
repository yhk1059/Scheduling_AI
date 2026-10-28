# Step 13: ui-auth-privacy

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J0, J2의 확정과 로그인, J3, J6, J7, J8, 핵심 기능 7)
- `/docs/ADR.md` (ADR-009 가명화, ADR-014)
- **`/docs/UI_GUIDE.md`** ("반복 사용 컴포넌트"의 저장 상태·계정·대화상자·배너, "피드백과 오류", "문구", "접근성", "레이아웃")
- `/lib/store.ts` (step 12: `auth`, `sync`, `loginPrompt`, `requireLogin`, `signedIn`, `chooseSample`, `retrySave`, `signedOut`, `deleteWardData`)
- `/lib/supabase.ts` (step 11: `supabaseConfigured`, `onAuthChange`, `signInWithGoogle`, `signOut`)
- `/components/AppShell.tsx`, `/components/StartScreen.tsx`, `/components/Dialog.tsx`, `/components/WardHome.tsx`, `/components/ScheduleStep.tsx`, `/app/page.tsx`, `/app/layout.tsx`

## 배경

step 11~12에서 만든 로그인과 저장 상태를 화면에 연결하고, 개인정보처리방침 페이지(`/privacy`)를 만든다.
Google OAuth 동의 화면과 방문자를 위해 개인정보처리방침이 필요하다. 서버에 간호사 이름과 근무 이력을 보관하는 책임이 생겼기 때문이다(ADR-014 트레이드오프).

## 작업

### 1. 인증 연결 (`AppShell.tsx`)
- 마운트 시 `onAuthChange`를 구독한다. 사용자가 생기면 `signedIn(user)`, 없어지면(로그아웃) `signedOut()`.
- `supabaseConfigured`가 false면 로그인 관련 UI를 모두 숨기고 게스트로만 동작한다.
- 로그인 상태면 시작 화면을 건너뛰고 병동 홈으로 간다(PRD J0). 불러오는 동안(`sync.status === "loading"`)은 "불러오는 중…" 한 줄만 보인다.

### 2. 상단 바 오른쪽 (UI_GUIDE "저장 상태", "계정")
- 저장 상태(`text-xs text-[#66665E]`, 계정 왼쪽): 게스트 "이 브라우저에만 저장" / 저장 중 "저장 중…" / 저장됨 "저장됨 14:32"(시각 mono) / 실패 `text-[#B42318]` "저장 실패" + [다시 시도] Text(`retrySave`)
- 계정: 로그인 전 [Google로 로그인] Secondary. 로그인 후 이메일(`text-xs`) + 메뉴 버튼(아이콘만이면 `aria-label="계정 메뉴"`). 메뉴 항목 [로그아웃], [내 병동 데이터 삭제] Danger.
- 저장 실패 시 주의 배너 "저장하지 못했어요. 이 브라우저에 보관하고 있어요" + [다시 시도] 하나.
- 다른 기기 동시 수정은 별도 UI 없이 "저장됨 HH:MM"으로 마지막 저장 시각만 보여 준다(마지막 저장이 이김).

### 3. 시작 화면 (`StartScreen.tsx`)
- [Google로 로그인]을 추가한다(UI_GUIDE "시작 화면"). 아래에 "로그인하면 병동이 저장되고 다른 기기에서도 이어서 쓸 수 있어요" 한 줄과 [개인정보처리방침] Text 링크(`/privacy`).

### 4. 대화상자 (`Dialog.tsx` 재사용, 버튼 최대 2개, Primary 하나)
- **로그인 요구**: 게스트가 [확정] 또는 [다음 기간 만들기]를 누르면 `requireLogin(action)` 후 표시.
  - 제목 "로그인하고 저장하기", 본문 "이 근무표와 병동을 저장하려면 로그인하세요." + [개인정보처리방침] 링크
  - 버튼: [CSV만 받기] Secondary(확정이면 CSV를 내려받고 "데이터는 이 브라우저에만 남아요"를 그 자리에 표시) / [Google로 로그인] Primary
  - [다음 기간 만들기]에서 열린 경우 Secondary는 [닫기].
- **샘플 저장 선택**(`loginPrompt.kind === "sample-choice"`, PRD J7): "샘플 병동을 내 병동으로 저장할까요, 빈 병동으로 시작할까요?" → [빈 병동으로 시작] Secondary / [샘플 저장] Primary → `chooseSample`.
- **서버 우선 안내**(`server-replaced-guest`): "저장된 내 병동을 불러왔어요. 이 브라우저에서 입력한 내용은 지웠어요." → [닫기] 하나.
- **데이터 삭제 2단계**(PRD J6): 1단계 "내 병동 데이터를 모두 지울까요? 되돌릴 수 없어요. Google 계정 연결은 남아요." → [취소] / [계속]. 2단계 병동 이름 입력란(`<label>`)과 [삭제](Danger 스타일을 Primary 자리에, 이름이 일치할 때만 활성, 비활성 이유 한 줄) → `deleteWardData()`. 실패하면 대화상자 안에 "삭제하지 못했어요. 잠시 후 다시 시도해 주세요" (`role="alert"`).
- 모든 대화상자: `role="dialog"`, `aria-modal="true"`, Esc 닫기, 첫 버튼 포커스, 닫으면 연 버튼으로 포커스 복귀.

### 5. 개인정보처리방침 페이지 (`app/privacy/page.tsx`)
- 정적 페이지, API 호출 없음. 랜딩과 같은 레이아웃 규칙(`max-w-[1360px] mx-auto px-8`, 좌측 정렬, 본문 타이포그래피). 페이지 제목 "개인정보처리방침", 시행일(작성일).
- 담을 내용(해요체 아닌 안내문 문체도 괜찮지만 짧게):
  1. **수집 항목**: Google 로그인 시 계정 이메일과 고유 식별자. 병동 데이터(병동 이름, 간호사 이름·연차·나이트 전담 여부, 필요 인원, 규칙, 요청, 근무표, 확정 기록). 이름은 이니셜로 입력해도 된다.
  2. **이용 목적**: 근무표 작성과 병동 데이터 저장·불러오기에만 쓴다.
  3. **보관 위치와 기간**: Supabase(서울 리전)에 저장하고, 사용자가 [내 병동 데이터 삭제]를 할 때까지 보관한다. 로그인하지 않으면 이 브라우저에만 저장된다.
  4. **처리 위탁·국외 이전**: Supabase(데이터베이스·인증, 서울 리전), Vercel(호스팅), Anthropic(자연어 규칙·요청 해석). Anthropic에 보낼 때 간호사 이름은 `N01` 같은 가명으로 바꾸고, 응답을 받은 뒤 되돌린다(ADR-009).
  5. **삭제 방법**: 계정 메뉴의 [내 병동 데이터 삭제]로 서버의 병동 데이터를 즉시 지운다. 로그아웃하면 이 브라우저에 남은 데이터를 지운다. Google 계정 연결 정보(이메일)는 남는다.
  6. 이 서비스는 포트폴리오 프로토타입이라는 점.
- **문의처(이메일, 연락처) 항목은 넣지 않는다**(사용자 결정).
- 링크: 랜딩(`app/page.tsx`) 하단, 시작 화면, 로그인 요구 대화상자.

### 6. 문구와 상태
- UI_GUIDE "상호작용 상태": 로그인 버튼 진행 중 "이동 중…", 삭제 진행 중 "삭제 중…"과 버튼 비활성. 토스트를 쓰지 않는다.
- "문구" 표: 확정/초안, 병동 규칙 등 기존 용어를 유지한다.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
test -f app/privacy/page.tsx
! grep -nE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|연락처|문의" app/privacy/page.tsx   # 문의처·이메일 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 수동 확인(게스트·env 없음 경로): `npm run dev` → `/privacy` 표시 → `/app` 시작 화면의 [Google로 로그인]과 방침 링크 → 샘플 → 기간 확정 시 로그인 요구 대화상자 → [CSV만 받기]. 대화상자 키보드 동작(Tab, Esc, 포커스 복귀)을 확인한다. 실제 Google 로그인은 브라우저 계정이 필요하므로 이 step에서 시도하지 않는다. 확인 후 서버를 종료한다.
3. 아키텍처 체크리스트를 확인한다:
   - 인증이 클라이언트에서만 처리되고, SSR 인증·미들웨어가 없는가(ADR-014)?
   - `backend/`가 바뀌지 않았는가?
   - UI_GUIDE 금지 패턴(blur, 그림자, 그라데이션)이 대화상자에 없는가?
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (실제 Google 로그인과 원격 저장은 미검증, 마이그레이션 적용 후 수동 확인 필요)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `/privacy`에 이메일·전화·문의처를 넣지 마라. 이유: 사용자가 문의처는 일단 넣지 않기로 했다.
- `/privacy`에 사실과 다른 약속(암호화 방식, 보관 기간 수치, 인증 계정 삭제 기능 등)을 쓰지 마라. 이유: 실제 구현과 어긋나는 방침은 신뢰를 해친다. 인증 계정 자체 삭제는 범위 밖이다(ADR-014).
- Google 외 로그인(매직 링크 등)을 넣지 마라. 이유: PRD MVP 제외 사항.
- 실제 Google 계정으로 로그인을 자동 시도하지 마라. 이유: 사용자 계정 인증은 사람이 한다.
- 토스트나 전역 알림을 쓰지 마라. 이유: UI_GUIDE "결과는 그 자리에서" — 예외는 상단 바 저장 상태 하나다.
- 기존 테스트를 깨뜨리지 마라.
