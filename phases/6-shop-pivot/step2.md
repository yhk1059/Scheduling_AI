# Step 2: remove-legacy-backend

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/backend/domain/models.py`
- `/backend/domain/constants.py`
- `/backend/gen_golden.py`
- `/eval/run.py`
- `/eval/dataset.jsonl`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

백엔드의 옛 형식 코드를 지운다. API 모양은 바뀌지 않으므로 프론트는 그대로 통과해야 한다.

## 작업

1. 삭제: `backend/domain/legacy.py`, `backend/domain/convert.py`, `eval/convert_dataset.py`, `backend/tests/test_convert.py`, `test_convert_expr.py`, `test_domain_blocks.py`, `backend/tests/golden/convert-cases.json`, `expr-convert-cases.json`, `blocks-cases.json`, `cases.json`, `block_oracle.py`와 그것만 쓰는 테스트.
2. 아직 쓰는 상수(기본 규칙 id 접두사 등)는 `constants.py`로 옮긴다. `backend/bench.py`, `gen_golden.py`가 쓰는 함수가 convert에 있으면 필요한 곳으로 옮긴다.
3. `gen_golden.py`에서 옛 변환 기능을 지운다.
4. `eval/dataset.jsonl`의 묶음 이름 `legacy`를 `basic`으로 바꾸고 `eval/run.py`도 맞춘다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
npm run gen:types
git diff --quiet -- lib/types.gen.ts
! git grep -nE 'legacy|convert_request' -- backend eval/run.py
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 나이트 전담이나 연차를 지우지 마라. 이유: 다음 step에서 프론트와 함께 지운다.
- API 스키마를 바꾸지 마라. 이유: 이 step에서는 `lib/types.gen.ts`가 그대로여야 한다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
