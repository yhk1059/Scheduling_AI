# Step 0: tests-to-rules

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/backend/tests/rules.py`
- `/backend/tests/block_oracle.py`
- `/backend/tests/test_golden.py`
- `/backend/gen_golden.py`
- `/backend/domain/convert.py`
- `/backend/domain/legacy.py`
- `/backend/bench.py`
- `/eval/convert_dataset.py`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

옛 형식 코드(`legacy.py`, `convert.py`)를 지우기 전에, 그것에 기대는 테스트와 도구를 식 규칙만 쓰도록 옮긴다. 이 step은 동작을 바꾸지 않는다.

## 작업

1. 지금 코드로 솔버 회귀 기준을 기록한다. `blocks-cases.json`·`cases.json`의 요청을 식 규칙으로 바꾼 `ScheduleRequest` JSON과 기대값(status, 목적값 또는 판정)을 `backend/tests/golden/solver-cases.json`에 저장한다. 변환한 결과를 저장하므로 이 파일은 convert를 쓰지 않고 읽을 수 있어야 한다.
2. `backend/tests/test_golden.py`를 `solver-cases.json`만 읽어 솔버를 돌려 기대값과 비교하도록 다시 쓴다. `gen_golden.py`의 생성 기능은 옛 형식이 없어도 `solver-cases.json`을 다시 쓸 수 있는 모양으로 줄인다. 처음 한 번 변환은 임시 스크립트로 하고 커밋하지 않는다.
3. `backend/tests/rules.py`, `block_oracle.py`, `test_compile.py`, `test_domain.py`, `test_evaluate.py`, `test_demo_schedule.py`, `test_eval_runner.py`, `backend/bench.py`, `backend/gen_demo.py`에서 `backend.domain.convert`·`backend.domain.legacy` import를 없앤다. 필요한 규칙 dict는 `rules.py`에 식 형태로 직접 둔다.
4. 옛 형식 자체를 검증하는 `test_convert.py`, `test_convert_expr.py`, `test_domain_blocks.py`는 이 step에서 그대로 둔다(다음 step에서 코드와 함께 지운다).

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
git grep -lE 'domain\.(convert|legacy)|domain import (convert|legacy)' -- backend eval | grep -vE 'backend/domain/(convert|legacy)\.py|test_convert|test_domain_blocks|eval/convert_dataset\.py' && exit 1 || true
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 솔버(`backend/solver/`) 코드를 바꾸지 마라. 이유: 이 step의 기록이 뒤 step의 회귀 기준이다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
