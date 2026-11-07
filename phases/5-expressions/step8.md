# Step 8: backend-cleanup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§1 ★2, §2.1, §2.5, §8)
- `/docs/ADR.md` (ADR-019), `/docs/ARCHITECTURE.md` (API 계약 `constraints`, 디렉토리 구조)
- `/backend/domain/models.py`, `/backend/domain/legacy.py`, `/backend/domain/convert.py`
- `/backend/solver/` 전체 (특히 `hard.py`, `soft.py`, `stats.py`, `compile.py`, `evaluate.py`)
- `/backend/llm/explainer.py`, `/backend/routes.py`, `/backend/gen_golden.py`, `/backend/gen_demo.py`, `/backend/gen_types.py`, `/backend/bench.py`
- `/backend/tests/` 전체 (특히 `blocks.py`, `test_golden.py`, `test_solver_*.py`, `test_routes.py`)
- `/eval/run.py`

## 배경

백엔드의 마지막 정리 step이다. 블록 3종(count·sequence·balance)을 요청 형식에서 빼고 `legacy.py`로 옮겨, `ScheduleRequest.constraints`는 `rule | fixed_assignment`만 받게 한다(ADR-019 ★2). 솔버의 블록 경로를 지우고, 테스트를 식 규칙으로 옮긴다. 옛 형식은 변환(골든·데모·eval 기대값 재작성)에만 남는다.

## 작업

### 1. 도메인
- `CountRule`·`SequenceRule`·`BalanceRule`과 블록 params(`CountParams`·`SequenceParams`·`BalanceParams`)를 `backend/domain/legacy.py`로 옮긴다(템플릿과 같은 곳). 셀렉터(`People`·`Days`·`Shifts`)는 식이 쓰므로 `models.py`에 남긴다.
- `ConstraintSpec = Rule | FixedAssignment`. 블록 type이 오면 422(extra/discriminator 오류).
- `ConstraintChange`에서 블록용 `update`(params 교체)를 지운다. 남는 것: `disable | set_value | set_hardness`.
- `convert.py`: `legacy_to_block`(템플릿 → 블록)과 `block_to_rules`(블록 → 식)는 남기고, `convert_request(legacy)`가 템플릿 요청을 **식 규칙 요청**으로 바꾸게 한다(블록을 거쳐도 됨). 기본 규칙 함수(나이트전담)는 식 규칙(`default=True`)을 돌려준다.

### 2. 솔버
- `hard.py`/`soft.py`의 블록 함수와 `ADDERS`의 블록 항목을 지운다. 남는 것: `rule`(compile) + `fixed_assignment`.
- `stats.violations`의 블록 분기를 지운다. `select.py`의 블록 전용 함수(`count_groups` 등)는 compile·evaluate가 쓰지 않으면 지운다.

### 3. 생성 스크립트·eval
- `gen_golden.py`: `blocks-cases.json`은 기록으로 남기고, `--check`는 블록 요청을 `legacy.py` 모델로 읽어 `block_to_rules`로 바꿔 푼 결과가 기록과 같은지 본다(옛 블록 솔버로 다시 만들지 않는다. 4-blocks에서 `cases.json`을 다룬 방식과 같다). `expr-convert-cases.json`은 계속 생성·비교.
- `gen_demo.py`, `bench.py`, `eval/run.py`의 블록 경로를 식으로 바꾼다(`--dry-run` 통과).
- `gen_types.py`: union 2종(`rule | fixed_assignment`). `lib/types.gen.ts`는 **이 step에서는 다시 생성하지 않는다**(step 9).

### 4. 테스트
- `backend/tests/blocks.py`를 식 규칙 빌더(`backend/tests/rules.py`, 프리셋 이름의 dict 빌더: coverage, leave, preference, forbid, max_run, min_run, off_after, weekly_hours, window_off, balance, conditional, pair_forbid…)로 바꾸고, solver·domain·routes·conflicts·reschedule 테스트를 식 규칙으로 옮긴다. 옮기면서 기대값(목적값, 위반 수)은 바꾸지 않는다. 바뀌어야 하면 설계 §10의 soft 모양 변화로 설명되는 경우만, 테스트 주석과 summary에 적는다.
- 옛 형식 422 테스트를 더한다: 블록 type(`count`·`sequence`·`balance`), `ConstraintChange.update`.
- AC grep: `backend/solver/`, `backend/llm/`, `backend/routes.py`에 `CountRule|SequenceRule|BalanceRule|"count"|"sequence"` 블록 참조가 남지 않는다(문자열 리터럴 중 셀렉터 키 `count`가 겹치면 grep 패턴을 조정하고 summary에 적는다).

## Acceptance Criteria

```bash
npm run gen:golden -- --check
npm run test
npm run bench
uv run python eval/run.py --dry-run
npm run build && npm run lint
! grep -rnE "CountRule|SequenceRule|BalanceRule" backend/solver backend/llm backend/routes.py
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `legacy.py`를 import하는 곳이 `convert.py`·`gen_golden.py`·`gen_demo.py`·테스트뿐인가? `solver/`·`llm/`·`routes.py`는 블록을 모르는가? `solver/`와 `llm/`이 서로 import하지 않는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(지운 것, 옮긴 것, 테스트 수, 바뀐 기대값과 이유, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 summary에 `결정: …`으로 적는다.

## 금지사항

- 셀렉터(`People`·`Days`·`Shifts`)를 `legacy.py`로 옮기지 마라. 이유: 식 언어가 그대로 쓴다.
- 테스트를 옮기면서 기대 목적값·위반 수를 근거 없이 바꾸지 마라. 이유: 동작이 같다는 것을 보장하는 장치다.
- `lib/`와 `components/`를 고치지 마라. 이유: 클라이언트는 step 9~11이다.
- `blocks-cases.json`·`cases.json`·`convert-cases.json` 기록을 바꾸지 마라.
- 기존 테스트의 의도를 깨뜨리지 마라(형식만 식으로 옮긴다).
