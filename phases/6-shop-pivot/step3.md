# Step 3: remove-nurse-concepts

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/backend/domain/models.py`
- `/backend/solver/select.py`
- `/backend/solver/stats.py`
- `/backend/llm/translator.py`
- `/backend/llm/explainer.py`
- `/backend/llm/prompts.py`
- `/backend/gen_demo.py`
- `/lib/rules.ts`
- `/lib/store.ts`
- `/lib/csv.ts`
- `/lib/wording.ts`
- `/lib/samples/ward-15.json`
- `/components/WardSettings.tsx`
- `/components/ScheduleStep.tsx`
- `/components/RulesStep.tsx`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

나이트 전담과 연차를 백엔드와 프론트에서 함께 지운다. 이름 변경은 다음 step이므로 `Nurse`, `Ward` 같은 이름은 유지한다.

## 작업

테스트를 먼저 고친다(TDD).

1. 나이트 전담: `NIGHT_ONLY_TAG`, `_is_night_dedicated_rule`과 거부 분기, 프롬프트·translator 처리, 프론트의 상수·추천 칩·기본 카드·문구를 지운다. 새 병동 기본 규칙은 없다.
2. 연차: `Nurse.years`, 셀렉터 `min_years`·`max_years`, `select.py`·`stats.py`·프롬프트·참조 검사의 처리, CSV 연차 열, 명단 열, 근무표 44px 열, 입력 오류, 해당 테스트와 eval 케이스를 지운다.
3. `lib/samples/ward-15.json`의 `years`, `나이트전담` 태그, 나이트 전담 규칙을 지우고 `npm run gen:demo`로 데모를 다시 만든다.
4. `solver-cases.json`에서 연차·나이트 전담 규칙을 뺀 뒤 `gen:golden`으로 기대값을 다시 기록한다. 지우지 않은 케이스의 기대값이 바뀌면 이유를 찾아라.
5. `npm run gen:types`. `e2e/`는 컴파일되게만 고친다.

## Acceptance Criteria

```bash
npm run gen:types
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
! git grep -nE 'NIGHT_ONLY|night_only|nightOnly|min_years|max_years|\byears\b|나이트전담|나이트 전담' -- backend lib components app e2e/test-helpers.ts eval/run.py
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 식 언어의 구조를 바꾸지 마라. 이유: 전환 범위가 아니다(ADR-020).
- 이름을 바꾸지 마라. 이유: 다음 step이다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
