# Step 2: login-required

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/lib/supabase.ts`
- `/lib/store.ts`
- `/components/Account.tsx`
- `/components/AppShell.tsx`
- `/components/StartScreen.tsx`
- `/components/SetupFlow.tsx`
- `/app/app/page.tsx`
- `/docs/UI_GUIDE.md`
- `/docs/PRD.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

게스트 모드를 없앤다. 앱은 Google 로그인이 필요하다. Supabase 값이 없어도 빌드되어야 한다.

## 작업

`lib/`의 순수 함수는 테스트를 먼저 쓴다.

1. `store.ts`에서 게스트 분기, 게스트 데이터 이전, 서버 우선 안내, 게스트 저장 문구를 지운다. localStorage는 저장 실패 때의 캐시로만 남긴다.
2. `StartScreen`을 지우고 로그인 화면을 만든다(UI_GUIDE "로그인 화면"). Supabase 값이 없으면 "로그인 설정이 필요해요" 한 줄과 샘플 링크를 보인다.
3. `SetupFlow`를 지우고 `ShopSetup`(UI_GUIDE "매장 준비")을 만든다. [첫 근무표 시작하기]는 첫 근무표를 만들어 근무표 작성을 연다. 규칙 입력은 `매장 설정`에 남는다.
4. 랜딩 [내 매장으로 시작하기]는 `/app`으로 가고, 로그아웃 상태면 로그인 화면이 보인다. 탭 줄의 [시작 화면], 게스트 배너와 대화상자를 지운다.
5. e2e 전용 로그인 경로는 step 5에서 만든다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
! git grep -nE '게스트|guest|StartScreen|SetupFlow' -- components app lib
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/7-availability/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- service role 키나 `@supabase/ssr`, 미들웨어 인증을 쓰지 마라. 이유: ADR-014.
- Supabase 값을 코드에 넣지 마라.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
