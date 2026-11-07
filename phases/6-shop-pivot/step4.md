# Step 4: rename-code

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/backend/domain/models.py`
- `/backend/domain/constants.py`
- `/backend/routes.py`
- `/backend/llm/pseudonym.py`
- `/lib/store.ts`
- `/lib/supabase.ts`
- `/components/WardHome.tsx`
- `/components/WardSettings.tsx`
- `/supabase/migrations/20261028000000_wards.sql`
- `/docs/ARCHITECTURE.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

코드 이름을 백엔드, 프론트, DB까지 한 번에 바꾼다. 동작은 바꾸지 않는다. 일이 기계적이므로 파일을 하나씩 고치지 말고 치환 스크립트를 임시로 만들어 쓴 뒤 남은 것만 손으로 고쳐라. 스크립트는 커밋하지 않는다.

## 작업

1. 이름: `Nurse`→`Employee`, `nurses`→`employees`, `nurse_id(s)`→`employee_id(s)`, `NurseStats`→`EmployeeStats`, `WardConfig`→`ShopConfig`, `ward`→`shop`(translate `scope` 값 `"ward"`→`"shop"`, 규칙 `scope` 포함), `MAX_NURSES`→`MAX_EMPLOYEES`, `MAX_TAGS_PER_NURSE`→`MAX_TAGS_PER_EMPLOYEE`. 함수, 변수, 액션, 타입, 테스트 이름도 같다. `forward`처럼 `ward`가 들어간 다른 단어를 바꾸지 않게 주의한다.
2. 가명 `N01`→`E01`.
3. 파일: `WardHome`→`ShopHome`, `WardSettings`→`ShopSettings`, `lib/samples/ward-15.json`→`lib/samples/shop-12.json`(내용은 step 5), `e2e/fixtures/ward-oct.json`→`shop-oct.json`. 데이터 파일(`eval/dataset.jsonl`, 샘플, golden, e2e 픽스처)의 키도 함께 바꾼다.
4. `store.ts`: `STORAGE_KEY = "shop-scheduler"`, `STORAGE_VERSION = 1`.
5. DB: 새 마이그레이션 `supabase/migrations/20261030000000_shops.sql`로 `wards`를 `shops`로 바꾸고 정책, 트리거, 함수 이름도 바꾼다. `lib/supabase.ts`는 `shops`를 쓴다. 기존 마이그레이션 파일은 고치지 않는다. 적용은 사용자가 한다.
6. 문구의 간호사→직원, 병동→매장, 수간호사→매니저는 **백엔드 오류 문구와 코드 주석만** 바꾼다. 화면 문구는 step 6이다. 단, 프론트 테스트가 백엔드 오류 문구를 기대하면 맞춘다.
7. `npm run gen:types`, `npm run gen:demo`.

## Acceptance Criteria

```bash
npm run gen:types
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
test -f supabase/migrations/20261030000000_shops.sql
! git grep -nE '[Nn]urse|NURSE|\bward|Ward|WARD|_ward' -- backend eval/run.py lib components app e2e ':!e2e/fixtures'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- DB에 접속하거나 마이그레이션을 적용하지 마라. 이유: 적용은 사용자가 확인하고 한다.
- 코드에 `store`라는 이름으로 매장을 부르지 마라. 이유: `lib/store.ts`와 헷갈린다(ADR-020).
- 화면 구조나 프롬프트 예시를 바꾸지 마라. 이유: 뒤 step이다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
