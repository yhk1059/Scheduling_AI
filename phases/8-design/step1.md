# Step 1: app-shell

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md`
- `/docs/UI_GUIDE.md` — "화면 구조 › 이동 · 로그인 화면", "컴포넌트 › 워드마크 · 스테퍼 · 반복 사용 컴포넌트 › 저장 상태 · 계정", "레이아웃 › 앱 상단 바 · 탭 줄", "타이포그래피"
- `/components/ui.ts`, `/components/Wordmark.tsx` — step 0이 만든 토큰과 워드마크
- `/components/AppShell.tsx`, `/components/Account.tsx`, `/components/LoginScreen.tsx`, `/components/Stepper.tsx`
- `/lib/wording.ts` — `unitShort`, `PRODUCT_NAME`

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. UI_GUIDE가 기준이고 기능은 바꾸지 않는다. 이 step은 모든 앱 화면이 공유하는 껍데기(상단 바, 탭 줄, 계정, 스테퍼)와 로그인 화면을 바꾼다.

## 작업

1. `AppShell.tsx` 상단 바: 높이 60(`h-[60px]`), `max-w-[1360px] px-10`. 왼쪽은 `<Wordmark size="bar" />`(매장이 있으면 홈으로 가는 버튼처럼 동작: `go({ screen: "home" })`) + 세로 구분선(`w-px h-5 bg-[#E2E2DC]`) + 매장 이름(`text-sm font-medium`) + 근무표 주기(`text-[13px] text-[#66665E]`, `unitShort`). "매장 직원 근무표" 글자는 없앤다. 오른쪽은 저장 상태 + 계정(그대로).
2. 탭 줄: 같은 흰 띠 안, 높이 44. 탭은 `<button>` 그대로 두되 클래스는 `h-11 px-1 mr-5 text-sm font-medium text-[#3D3D38] border-b-2 border-transparent`, 현재 탭은 `font-semibold text-[#1B1B18] border-[#155E75]`와 `aria-current="page"`.
3. `Account.tsx`의 메뉴 버튼: 아바타(24px 원, `bg-[#E3F0F3] text-[#155E75] text-xs font-semibold`, 이메일 첫 글자 대문자) + 이메일(`text-xs`) + 아래 화살표 SVG. 메뉴 패널에는 `ui.shadow`를 쓴다. 메뉴 항목과 동작은 그대로.
4. `LoginScreen.tsx`: 두 열(`grid-cols-[1fr_440px] gap-24 max-w-[1100px]`, 세로 가운데). 왼쪽은 `<Wordmark size="hero" />`, "말로 짜는 근무표"(`text-[36px] font-semibold tracking-[-0.02em]`), 설명 한 줄 "직원 명단만 넣으면 첫 근무표를 시작할 수 있어요. 매장 하나, 계정 하나로 쓰고, 근무표는 서버에 저장돼요.", 구분선 아래 번호 3줄(mono 번호 `#155E75`: "명단을 적고 직원에게 링크 하나를 보내요" / "매장 조건을 말로 적어요" / "근무표를 만들고 확정해요" + A·M·C·O 작은 셀). 오른쪽은 `ui.cardXl` 카드(`px-9 pt-9 pb-7`): "로그인"(18px) + "Google 계정으로만 로그인할 수 있어요" + [Google로 로그인](`ui.primaryXl` + `w-full`, 흰 G 아이콘 SVG) + "또는" 구분선 + [로그인 없이 샘플 보기](`ui.secondaryXl w-full`, `/demo` 링크) + 저장·삭제 안내 한 줄과 [개인정보처리방침] 링크. Supabase 설정이 없을 때의 "로그인 설정이 필요해요" 분기는 카드 안에 그대로 둔다.
5. 로그인 화면일 때 상단 바에는 워드마크와 [샘플로 체험하기] Text(`/demo`)만 두고 탭 줄을 숨긴다(매장 준비에서도 탭 줄 숨김은 그대로).
6. `Stepper.tsx`: 원을 26px(`size-[26px]`), 레이블을 `text-sm`, 연결선을 `w-7`로. 완료·현재·미래 색은 그대로.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 로그인·세션·저장 로직(`onAuthChange`, `signedIn`, `retrySave`)을 건드리지 않았는가? 탭의 `aria-current`와 스테퍼의 `aria-current="step"`이 남아 있는가?
3. 수동 저니 체크리스트(`npm run dev`, 1440px):
   - `/app` 로그인 전: 두 열 로그인 화면, 탭 줄 없음, 상단 바에 워드마크와 [샘플로 체험하기]만.
   - 로그인 후 홈: 상단 바 60px, 워드마크 · 구분선 · 매장 이름 · 주기, 현재 탭에 청록 밑줄.
   - 계정 메뉴: 아바타 글자, 메뉴에 그림자, [로그아웃]·[내 매장 데이터 삭제] 동작.
   - 근무표 작성 화면 스테퍼: 26px 원, 지난 단계 클릭 가능.
   - 키보드: Tab으로 탭·스테퍼·메뉴에 포커스 링이 보인다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `ShopHome`, `PeriodWork`, `ConfirmedPeriod`, `ShopSettings` 본문을 고치지 마라. 이유: 각각 다음 step의 범위다.
- 로그인 방식·게스트 모드·저장 흐름을 바꾸지 마라. 이유: 디자인 phase다(PRD 핵심 기능 7).
- step 0이 만든 `ui` 키 이름을 바꾸지 마라. 이유: 다른 step이 같은 이름을 쓴다.
- 기존 테스트를 깨뜨리지 마라.
