# Step 3: perf-limits

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§2.7 입력 상한, §10 6단계 성능 확인, §11 위험의 솔버 성능)
- `/docs/ADR.md` (ADR-008 시간 예산)
- `/docs/ARCHITECTURE.md` (API 계약의 413 표, 시간 예산)
- `/backend/domain/constants.py`, `/backend/routes.py` (`_check_limits`), `/backend/tests/test_routes.py`
- `/backend/solver/` 전체 (step 2)

## 배경

블록은 코드 수 × 창(window) × 시간 합 × 연속 구간 길이가 곱으로 늘 수 있다. LLM과 화면을 붙이기 전에, 최악의 병동이 시간 예산(10초) 안에 해를 내는지 확인하고 입력 상한을 정한다. 설계의 6단계 성능 확인을 여기로 당겼다. 상한이 먼저 정해져야 LLM 검증과 화면이 같은 숫자를 쓴다.

## 작업

**테스트를 먼저 쓴다(TDD).** 상한 검사는 `backend/tests/test_routes.py`에.

### 1. 입력 상한 (`constants.py`, `routes.py`, `models.py`)
- 설계 §2.7 상한을 상수로 둔다: `MAX_SHIFT_CODES=8`, `MAX_TAGS_PER_NURSE=5`, `MAX_PATTERN_LEN=4`, `MAX_PATTERNS=4`, `MAX_WINDOW_DAYS=14`.
- 크기 상한(코드 수, 태그 수)은 `_check_limits`에서 413 `PAYLOAD_TOO_LARGE`, 형식 상한(패턴 길이, window)은 Pydantic에서 422. 지금 경계와 같은 방식으로 테스트한다.

### 2. 벤치 스크립트 (`backend/bench.py`, `python -m backend.bench`)
- 최악 병동을 코드로 만든다: 간호사 40명, 31일, 활성 코드 8개(D/E/N/M/DE 등 복합 포함), 태그 3종, 공휴일 2일, 이월 7일, history 28일, 블록 60개(필요 인원 per day 코드×평일/주말, 태그 배치, 연차 배치, 최소 휴무, 주 52시간 hours, 7일 window, forbid 4개, run max/min, after, balance 3개 with_history, soft 희망·기피 20개 정도).
- `solve()`로 풀어 상태와 시간을 출력한다. 해(ok)가 `SOLVE_TIME_LIMIT_S` 안에 나와야 하고(optimal은 아니어도 된다), 아니면 exit 1.
- 같은 병동으로 `find_conflicts`가 `CONFLICT_TIME_LIMIT_S` 안에 끝나는지도 infeasible 변형(휴가 충돌 하나 추가)으로 확인한다. 끝나지 않으면 exit 1.
- 통과하지 못하면 상한(코드 수, window, 블록 수, 패턴 수)을 낮추고 벤치 병동도 그 상한에 맞춘다. 낮춘 값과 이유를 summary와 `docs/ARCHITECTURE.md` 413 표에 반영한다.
- 벤치는 `npm run test`에 넣지 않는다(시간이 걸린다). `package.json`에 `"bench": "uv run python -m backend.bench"`.

## Acceptance Criteria

```bash
uv run python -m backend.bench
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 벤치는 결과(해 상태, 풀이 시간, 충돌 분석 시간)를 출력한다.
2. 아키텍처 체크: 상한 숫자가 `constants.py` 한 곳에만 있는가? 시간 예산 상수를 바꾸지 않았는가?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(벤치 풀이 시간, 최종 상한)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- `SOLVE_TIME_LIMIT_S`, `CONFLICT_TIME_LIMIT_S`, Vercel `maxDuration`을 늘리지 마라. 이유: ADR-008. 상한을 낮추는 쪽으로 맞춘다.
- 벤치를 통과시키려고 솔버 식의 의미를 바꾸지 마라(골든 동등성이 깨진다). 식을 더 효율적으로 쓰는 것은 허용한다.
- 벤치를 `npm run test`나 Stop 훅에 넣지 마라.
- 기존 테스트를 깨뜨리지 마라.
