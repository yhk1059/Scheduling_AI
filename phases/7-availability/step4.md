# Step 4: samples-e2e

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/docs/BROWSER_TEST_SCENARIOS.md`
- `/e2e/test-helpers.ts`
- `/playwright.config.ts`
- `/docs/PRD.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

전체 흐름을 실제로 검증한다. 실제 Anthropic API와 테스트 Supabase 프로젝트를 쓴다. 마이그레이션 `20261030000000_shops.sql`, `20261030000100_availability.sql`은 사용자가 이미 적용했다. DB를 바꾸는 명령을 실행하지 마라.

## 작업

1. `.env.local`에 `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`가 없으면 즉시 blocked로 멈춘다. 값을 출력하지 마라.
2. 테스트 전용 로그인 경로(`NEXT_PUBLIC_E2E_LOGIN`이 켜졌을 때만)와 도우미 `loginAsTestUser`를 만든다. 프로덕션 빌드에서 이 값이 없으면 경로가 없어야 한다.
3. `docs/BROWSER_TEST_SCENARIOS.md`대로 `e2e/`를 다시 쓴다. `e2e/fixtures/shop-oct.json`을 맞추고 `playwright.config.ts`에 `workers: 1`을 둔다.
4. 랜딩과 샘플 데모를 점검한다.
5. `npm run test:e2e`가 통과할 때까지 고친다. 문서와 다르게 구현해야 하면 이유를 summary에 적는다.

## Acceptance Criteria

```bash
npm run build
npm run lint
npm run test
npm run bench
npm run test:e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/7-availability/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- e2e 전용 로그인을 프로덕션에서 켜지 마라.
- `.env.local` 값을 커밋하거나 출력하지 마라.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
