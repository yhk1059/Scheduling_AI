# Step 1: remove-legacy-client

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/lib/migrate.ts`
- `/lib/migrate.test.ts`
- `/lib/store.ts`
- `/lib/store.test.ts`
- `/lib/wording.ts`
- `/lib/wording.test.ts`
- `/e2e/test-helpers.ts`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

프론트의 옛 저장본 변환을 지운다. 프론트 테스트가 백엔드의 변환 골든 파일을 읽을 수 있으므로 백엔드보다 먼저 한다. 나이트 전담과 연차는 step 3에서 지우므로 이 step에서는 남겨 둔다.

## 작업

`lib/`의 순수 함수는 테스트를 먼저 쓴다(TDD, vitest).

1. `lib/migrate.ts`를 없앤다. 계속 쓰는 것(`DEFAULT_CONFIG`, `OFF_CODE`, `PRIORITY_WEIGHTS`, `normalizeRule`, `ruleShape`, `stableJson`, `COVERAGE_RULE_PREFIX`, 나이트 전담 상수 등)은 `lib/rules.ts`로 옮기고, `migrate.test.ts`의 해당 테스트를 `rules.test.ts`로 옮긴다.
2. 옛 변환(`legacyToBlock`, `blockToRules`, `migrateV4`, `migrateV5`, `upgradeDoc`)과 그 테스트를 지운다. `store.test.ts`, `wording.test.ts`가 테스트 데이터를 만드는 데 이들을 쓰면 식 규칙을 직접 적는 방식으로 바꾼다.
3. `store.ts`: 저장 버전이 지금 버전과 다르거나 손상된 문서는 변환하지 않고 초기화한다.
4. 모든 import를 `lib/rules`로 고친다(`components/`, `e2e/` 포함). `e2e/fixtures/ward-oct-v5.json`과 그것만 쓰는 e2e 코드를 지운다.
5. 프론트 테스트가 백엔드 골든(`convert-cases.json`, `expr-convert-cases.json`)을 더 읽지 않게 한다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
! git grep -nE 'legacyToBlock|blockToRules|migrateV4|migrateV5|upgradeDoc|lib/migrate|/migrate"|convert-cases' -- lib components app e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 규칙 카드 문장이나 화면 동작을 바꾸지 마라. 이유: 삭제만 하는 step이다.
- e2e를 실행하지 마라. 이유: 시나리오 재작성은 phase `7-availability`다. 컴파일만 되면 된다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
