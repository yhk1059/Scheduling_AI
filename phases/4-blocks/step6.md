# Step 6: backend-cleanup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§2 데이터 형식, §2.7 요청·결과 형식 변경, §3 솔버)
- `/docs/ADR.md` (ADR-018), `/docs/ARCHITECTURE.md` (API 계약)
- `/backend/domain/models.py`, `convert.py`, `constants.py`
- `/backend/solver/` 전체, `/backend/llm/` 전체, `/backend/routes.py`, `/backend/gen_demo.py`, `/backend/gen_golden.py`, `/eval/run.py`
- `/backend/tests/` 전체

## 배경

솔버·LLM·eval이 모두 블록으로 동작한다. 이제 덧붙여 두었던 옛 경로를 지워 백엔드를 설계 형식으로 정리한다. 이 step이 끝나면 백엔드 API는 설계 문서·ARCHITECTURE의 계약과 같아진다. 클라이언트는 step 7에서 맞춘다.

## 작업

**테스트를 먼저 고친다(TDD).** 옛 형식을 기대하던 테스트를 새 형식으로 바꾸고, 옛 형식 입력이 422가 되는 테스트를 더한다.

### 1. 템플릿 제거
- 템플릿 12종 모델을 `backend/domain/legacy.py`로 옮긴다. `legacy.py`는 변환(`convert.py`), 골든 생성, eval 데이터셋 변환, 샘플 변환에서만 쓴다. `ConstraintSpec` union은 `count | sequence | balance | fixed_assignment`만 남긴다.
- 솔버의 템플릿 함수(`hard.py`, `soft.py`, `stats.py`의 템플릿 분기, `TOGGLEABLE`, `CLAUSE_TEMPLATES` 중 템플릿 전용)를 지운다. 블록 함수가 쓰는 공통 도우미는 남긴다.
- 템플릿에 쓰던 상수(`DEFAULT_SOFT_WEIGHTS` 등)는 쓰는 곳이 없으면 지운다. `DEFAULT_WEIGHT`는 priority normal 값과 같으면 하나로 합친다.

### 2. 나이트 전담
- `Nurse.night_only`를 지운다. 솔버의 나이트 전담 기본 제약(`model.py`)을 지운다. 나이트 전담은 `나이트전담` 태그 + `night_only_rule` 블록이다.
- 옛 `night_only` 필드가 든 요청은 422다(`extra="forbid"`).

### 3. 이력과 결과
- `history_load`를 지우고 `history`(원본)만 남긴다. 고르게 블록의 이력 계산은 step 2의 `history_count`만 쓴다.
- `NurseStats`에서 `D, E, N, O` 필드를 지우고 `counts`, `hours`를 쓴다. 나머지 필드(주말·공휴일 근무, 최대 연속 근무, 희망 반영률, 편차)는 그대로.
- 결과에 최근 4주 나이트·주말 근거를 클라이언트가 보여 줄 수 있도록, 필요한 값은 클라이언트가 `history` 원본에서 계산한다(백엔드 결과에 새 필드를 만들지 않는다).

### 4. 주변 정리
- `gen_golden.py`, `test_golden.py`: 케이스의 `request`는 `legacy.py` 형식으로 그대로 둔다(골든은 옛 솔버의 기록이라 다시 풀지 않는다. `--check`는 옛 요청을 지금 솔버로 다시 풀 수 없으므로 `cases.json`은 손대지 않고 `convert-cases.json`만 다시 만들어 비교하게 바꾼다). 동등성 테스트는 `convert_request`(`night_only` → 태그 + 규칙, `history_load`는 버리고 케이스의 `history_raw`를 `history`로)로 바꿔 계속 골든 목적값과 비교한다. 옛 솔버로 다시 푸는 step 0의 테스트는 지운다.
- `gen_demo.py`, `backend/tests/test_demo_schedule.py`: 샘플 병동(`lib/samples/ward-15.json`, 아직 옛 형식)을 읽을 때 `legacy.py` + `convert`로 바꿔 푼다. 샘플 파일 자체와 `demo-schedule.json`은 step 10에서 새 형식으로 바꾼다.
- `eval/run.py`: 옛 형식 참조가 남아 있으면 정리한다(동작은 그대로. `--dry-run` 통과).
- `test_gen_types.py`: union 개수 기대값 갱신.
- `docs/ARCHITECTURE.md`의 API 계약과 실제 코드가 다르면 코드를 계약에 맞춘다.

## Acceptance Criteria

```bash
uv run python -m backend.gen_golden --check
uv run python eval/run.py --dry-run
uv run python -m backend.bench
npm run test
npm run build && npm run lint
! grep -rnE 'night_only|history_load|daily_coverage|max_consecutive_nights|TOGGLEABLE' backend --include=*.py | grep -vE 'backend/domain/(legacy|convert)\.py|backend/gen_golden\.py|backend/tests/'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(마지막 줄: 옛 이름이 변환·골든·테스트 밖의 백엔드 코드에 남지 않았는지).
2. 아키텍처 체크: `solver/`와 `llm/`이 서로 import하지 않는가? `legacy.py`를 솔버·LLM·routes가 import하지 않는가?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- `lib/types.gen.ts`를 다시 생성하지 마라. 이유: step 7에서 클라이언트와 함께 바꾼다(생성하면 `npm run build`가 깨진다).
- `lib/samples/*.json`을 바꾸지 마라. 이유: step 10의 범위다.
- 골든 `objective` 기대값을 고치지 마라.
- 기존 테스트를 깨뜨리지 마라(옛 형식을 기대하던 테스트는 새 형식으로 바꾼다).
