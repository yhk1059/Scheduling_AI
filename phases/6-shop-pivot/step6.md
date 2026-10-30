# Step 6: client-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/lib/migrate.ts`
- `/lib/store.ts`
- `/lib/wording.ts`
- `/lib/csv.ts`
- `/lib/stats.ts`
- `/lib/continuity.ts`
- `/lib/store.test.ts`
- `/lib/wording.test.ts`
- `/docs/ARCHITECTURE.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

백엔드는 끝났다. `lib/`을 새 타입과 이름으로 옮긴다. 컴포넌트는 다음 step이므로 이 step에서는 `npm run build`가 깨져도 된다. 게스트 모드는 step 8까지 유지한다.

## 작업

`lib/`의 순수 함수는 테스트를 먼저 쓴다(TDD, vitest).

1. `npm run gen:types`.
2. `lib/migrate.ts`를 없앤다. 계속 쓰는 것(`DEFAULT_CONFIG`, `OFF_CODE`, `PRIORITY_WEIGHTS`, `normalizeRule`, `ruleShape`, `stableJson`, `COVERAGE_RULE_PREFIX` 등)은 `lib/rules.ts`로 옮기고, `migrate.test.ts`의 해당 테스트를 `rules.test.ts`로 옮긴다. 옛 변환(`legacyToBlock`, `blockToRules`, `migrateV4`, `migrateV5`, `upgradeDoc`)과 그 테스트를 지운다.
3. `store.ts`: `STORAGE_KEY = "shop-scheduler"`, `STORAGE_VERSION = 1`. 버전이 다르거나 손상되면 초기화한다. `ward`→`shop`, `nurses`→`employees`, 액션과 타입 이름도 바꾼다. 나이트 전담과 연차를 지운다. 새 매장 기본 규칙은 없다.
4. `DEFAULT_CONFIG`는 A/M/C/O와 시각을 갖는다. 기본 기간 단위는 1주다.
5. `wording.ts`: 프리셋 이름과 문장을 매장 말로 바꾼다(UI_GUIDE "규칙·요청 카드" 예시). `csv.ts`에서 연차 열을 지운다. `stats.ts`, `continuity.ts`의 누적 부담 이름을 코드에 묶이지 않게 고친다(누적 열의 기본은 마감·주말).
6. 나머지 `lib/` 테스트를 새 데이터로 고친다.

## Acceptance Criteria

```bash
npm run gen:types
npx vitest run
uv run pytest backend/tests scripts/test_hooks.py
git grep -nE '[Nn]urse|\bward|Ward|_ward|간호|병동|나이트|years' -- lib ':!lib/types.gen.ts' && exit 1 || true
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 컴포넌트를 고치지 마라. 이유: step 7이다.
- 옛 저장본 변환을 남기지 마라. 이유: ADR-020.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
