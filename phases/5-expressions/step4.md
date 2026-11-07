# Step 4: perf-expr

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§2.3 상한, §3 성능, §10 솔버 성능, §11 기본값)
- `/docs/ARCHITECTURE.md` (API 계약 413·422 행, 시간 예산), `/docs/ADR.md` (ADR-008, ADR-019)
- `/backend/bench.py`, `/backend/routes.py` (`_check_limits`), `/backend/domain/constants.py`
- `/backend/solver/compile.py` (step 3), `/backend/domain/convert.py` (`rules_request`)
- `/backend/tests/test_routes.py`

## 배경

식 규칙은 reify 보조 변수 때문에 블록보다 모델이 커질 수 있다. 입력 상한을 꽉 채운 최악 병동이 시간 예산(solve 10초) 안에 해를 내는지 확인하고, 넘으면 **예산을 늘리지 않고 상한을 낮춘다**(ARCHITECTURE "시간 예산").

## 작업

**경계 테스트를 먼저 쓴다(TDD).** `backend/tests/test_routes.py`

### 1. 입력 상한 경계
- 413/422 경계 테스트: 규칙의 values 5/6개, Cmp 6/7개, offset −7/−8·+14/+15·폭 14/15, window 14/15. 모델 검증(Pydantic)에서 걸리는 것은 422, `_check_limits`의 크기 상한은 413(ARCHITECTURE 표와 같게).
- 제약 수 상한(200, 고정 근무 제외)에 `rule`이 포함되는지 확인한다(금지 패턴 분리로 늘어난 규칙도 센다).

### 2. 벤치 (`backend/bench.py`, `npm run bench`)
- 지금 최악 병동(40명 × 31일, 코드 8개, 태그 3종, 공휴일 2, 이월 7일, history 28일, 블록 60개)을 `rules_request`로 바꾼 버전을 추가하고, 식 고유 규칙을 섞는다: 조건부 규칙 5개(when + All), 짝 규칙 3개, 세기끼리 비교 2개, offset 폭 14 규칙 2개.
- 측정: solve(ok·optimal 여부·시간), 휴가 충돌 변형 infeasible 시간, `find_conflicts` 시간과 개수. 블록 버전과 식 버전을 나란히 출력한다.
- 판정: solve가 해를 내고(optimal 아니어도 됨) 10초 + `OVERHEAD_S` 안이며, 충돌 분석이 +5초 안. 넘으면 `constants.py`의 상한(Cmp 수, offset 폭, 규칙 수)을 낮추고 다시 잰다. 낮춘 값은 ARCHITECTURE 422/413 행과 설계 노트 §11에 반영한다.

### 3. 기록
- 결과(시간, 상한 변경 여부)를 summary에 남긴다. 단일 워커에서의 결과도 함께 적는다(4-blocks step 3의 위험 기록과 같은 형식).

## Acceptance Criteria

```bash
npm run bench
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 벤치가 `npm run test`에 들어가지 않았는가? 상수는 `constants.py`에 있는가? 시간 예산 숫자를 늘리지 않았는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(블록 대비 식 벤치 시간, 상한 변경, 단일 워커 결과)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다.

## 금지사항

- `SOLVE_TIME_LIMIT_S`, 충돌 분석·제안 검증 시간 예산을 늘리지 마라. 이유: ARCHITECTURE 원칙("넘으면 예산을 늘리지 않고 상한을 낮춘다").
- 벤치를 `npm run test`에 넣지 마라. 이유: 시간.
- 솔버 의미(`evaluate.py`·`compile.py`)를 바꾸지 마라. 성능 개선은 같은 의미를 유지하는 범위(보조 변수 줄이기, 상수 미리 판정)에서만 한다.
- 기존 테스트를 깨뜨리지 마라.
