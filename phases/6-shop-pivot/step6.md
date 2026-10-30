# Step 6: ui-copy

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/docs/UI_GUIDE.md`
- `/lib/wording.ts`
- `/lib/wording.test.ts`
- `/components/ShopHome.tsx`
- `/components/ShopSettings.tsx`
- `/components/SampleDemo.tsx`
- `/components/LandingPreview.tsx`
- `/app/page.tsx`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

화면 문구를 매장 말로 바꾼다. 화면 구조는 바꾸지 않는다. 이 step이 끝나면 게스트 모드 그대로 매장 서비스처럼 읽혀야 한다.

## 작업

1. 모든 화면 문구를 UI_GUIDE "문구" 표에 맞춘다: 매장, 직원, 매니저, 매장 조건, 근무 코드 색(A/M/C). 랜딩 문구도 매니저 기준으로 바꾼다.
2. `wording.ts`: 프리셋 이름과 문장을 매장 말로 바꾼다(UI_GUIDE "규칙·요청 카드" 예시). 테스트를 먼저 고친다.
3. 샘플 데모가 `shop-12.json`을 읽는지 확인한다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
! git grep -nE '간호|병동|나이트' -- components app lib ':!lib/types.gen.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 3단계 흐름이나 로그인 변경을 하지 마라. 이유: phase `7-availability`다.
- 게스트 관련 문구를 지우지 마라. 이유: 게스트 모드는 phase `7-availability`까지 유지한다. 말만 매장 기준으로 맞춘다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
