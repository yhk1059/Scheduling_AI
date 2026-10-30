# Step 1: remove-legacy-backend

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/backend/domain/models.py`
- `/backend/domain/constants.py`
- `/backend/solver/select.py`
- `/backend/solver/stats.py`
- `/backend/llm/translator.py`
- `/backend/llm/explainer.py`
- `/backend/llm/prompts.py`
- `/backend/gen_demo.py`
- `/lib/samples/ward-15.json`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

이 step은 백엔드만 다룬다. 프론트(`lib/`, `components/`, `app/`, `e2e/`)는 `6-shop-pivot`의 뒤 step에서 옮기므로 그 사이 `npm run build`와 vitest가 깨지는 것은 정상이다. 백엔드 pytest만 통과시켜라. 옛 형식 코드와 간호 전용 개념을 백엔드에서 지운다.

## 작업

1. 삭제: `backend/domain/legacy.py`, `backend/domain/convert.py`, `eval/convert_dataset.py`, `backend/tests/test_convert.py`, `test_convert_expr.py`, `test_domain_blocks.py`, `backend/tests/golden/convert-cases.json`, `expr-convert-cases.json`, `blocks-cases.json`, `cases.json`, `block_oracle.py`와 그것만 쓰는 테스트. 기본 규칙 id 접두사 등 아직 쓰는 상수는 `constants.py`로 옮긴다.
2. 나이트 전담 제거: `NIGHT_ONLY_TAG`, `_is_night_dedicated_rule`과 그 거부 분기, 프롬프트·translator의 처리.
3. 연차 제거: `Nurse.years`, 셀렉터 `min_years`·`max_years`, `select.py`·`stats.py`·프롬프트·참조 검사의 연차 처리, 해당 테스트와 eval 케이스.
4. `lib/samples/ward-15.json`의 `years`, `나이트전담` 태그, 나이트 전담 규칙을 지워 새 모델로 검증되게 하고 `npm run gen:demo`로 `demo-schedule.json`을 다시 만든다. 샘플의 매장 내용은 step 3에서 바꾼다.
5. `eval/dataset.jsonl`의 묶음 이름 `legacy`를 `basic`으로 바꾸고 `eval/run.py`도 맞춘다.
6. `solver-cases.json`에 든 연차·나이트 전담 규칙을 뺀 뒤 `gen:golden`으로 기대값을 다시 기록한다. 지우지 않은 케이스의 기대값이 바뀌면 이유를 찾아라.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npm run gen:types
git grep -nE 'NIGHT_ONLY|night_only|min_years|max_years|legacy|convert_request' -- backend eval/run.py && exit 1 || true
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 식 언어의 구조를 바꾸지 마라. 이유: 전환 범위가 아니다(ADR-020).
- 프론트를 고치지 마라. `lib/types.gen.ts` 재생성과 `lib/samples/`만 예외다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
