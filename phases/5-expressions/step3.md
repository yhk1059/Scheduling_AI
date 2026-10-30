# Step 3: compile-expr

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§3 솔버, §2.3 모르는 날, §8 골든, §10 위험)
- `/docs/ADR.md` (ADR-008 시간 제한, ADR-019), `/docs/ARCHITECTURE.md` (시간 예산)
- `/backend/solver/model.py`, `/backend/solver/hard.py`, `/backend/solver/soft.py`, `/backend/solver/stats.py`, `/backend/solver/conflicts.py`, `/backend/solver/select.py`
- `/backend/solver/evaluate.py` (step 2), `/backend/domain/convert.py` (`rules_request`, step 1)
- `/backend/tests/golden/blocks-cases.json` (step 0), `/backend/gen_golden.py`, `/backend/tests/test_golden.py`

## 배경

식 규칙을 **CP-SAT 제약으로 컴파일**해 솔버가 `rule` 타입을 풀게 한다. 의미 기준은 step 2의 `evaluate.py`다: 컴파일한 모델의 해는 `evaluate_rule`로 평가해 hard 위반 0이어야 하고, soft 목적값은 평가한 위반량 × 가중치의 합과 같아야 한다. 블록 경로는 step 8까지 그대로 둔다.

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_compile.py`

### 1. 컴파일 (`backend/solver/compile.py`)
```python
def add_rule_hard(ctx: ModelContext, rule: Rule, lit) -> None: ...
def add_rule_soft(ctx: ModelContext, rule: Rule) -> None: ...
```
- 인스턴스는 `evaluate.instances`와 같은 목록을 쓴다(의미를 두 벌로 만들지 않는다).
- Count → 선형식(이월 칸은 상수, 모르는 날은 0, 시간은 분 단위 — 기존 `ctx.value` 재사용). Cmp → 선형 제약. 상수끼리만이면 미리 판정.
- hard: `when`이 없으면 `then`을 `OnlyEnforceIf(lit)`. 있으면 when의 Cmp들을 리터럴로 reify(참·거짓 양방향)하고 `lit ∧ when → then`. All/Any도 reify한 리터럴의 and/or.
- soft: then이 Cmp 하나면 벗어난 양(시간은 기본 근무 분량 올림, 기존 `soft._units` 재사용), All/Any면 위반 bool 1. when이 있으면 when이 참일 때만 센다. `weight = PRIORITY_WEIGHTS[priority]`.
- Balance: 기존 `hard.balance_exprs`·`spread_vars` 로직을 같은 의미로 쓴다.
- 보조 변수는 필요한 곳(when, All/Any)에만 만든다. 같은 (사람, 날, 셀렉터) 리터럴은 기존 `ctx.literal` 캐시를 쓴다.

### 2. 연결
- `hard.ADDERS` / `soft.ADDERS`(또는 `model.py` 분기)에 `"rule"`을 더한다. unsat core는 지금처럼 규칙 id 리터럴 단위(`conflicts.py`).
- `stats.py`의 결과 통계(`soft_violations`, `summary`의 희망 반영)는 규칙도 센다: "한 사람(`who.ids` 또는 `for_each.people.ids` 1명)·scope period·soft·person 범위" 규칙을 희망·기피로 센다(블록 규칙과 같은 기준).

### 3. 동등성 테스트
- **골든**: `blocks-cases.json`의 각 요청을 `rules_request`로 바꿔 풀었을 때 status가 같고, feasible이면 목적값이 같고, 기록된 블록 배정이 식 규칙 hard 위반 0(`evaluate_rule`). infeasible이면 conflict_ids가 변환 id 기준으로 같다. soft min_len처럼 위반량 모양이 바뀌는 케이스는 목적값 대신 hard 위반 0만 보고, 차이를 테스트 주석과 summary에 기록한다.
- **컴파일 = 평가**: 작은 병동(5명 × 7일)에서 설계 §2.6 예시와 변환표 모양마다, 풀이 결과를 `evaluate_rule`로 평가해 hard 위반 0, soft 목적값 = Σ 위반량 × 가중치.
- 새 기능: 조건부(신규 → 책임), 짝 금지(같은 날 나이트 ≤ 1), 짝 같이(세기끼리 eq), 세기끼리 비교, 요일 조건부 순서가 hard로 지켜지고, 일부러 불가능하게 만들면 infeasible + core에 그 규칙 id.

### 4. 골든 기록 갱신
- `gen_golden.py`에 식 동등성 결과 기록이 필요하면 더한다. `--check`는 계속 통과해야 한다.

## Acceptance Criteria

```bash
npm run gen:golden -- --check
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 솔버에 항상 `max_time_in_seconds`가 걸려 있는가? `solver/`가 `llm/`을 import하지 않는가? 컴파일과 평가가 인스턴스 목록을 공유하는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(골든 동등성 결과, 바뀐 soft 모양, 테스트 수, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용(동등성 실패 케이스)"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 블록 경로(`hard.py`/`soft.py`의 count·sequence·balance)를 지우지 마라. 이유: step 8에서 지운다.
- 골든 동등성 테스트를 통과시키려고 기대 목적값이나 `blocks-cases.json`을 고치지 마라. 이유: 기존 병동이 같은 근무표를 내야 한다는 phase의 기준이다.
- `evaluate.py`와 다른 의미로 컴파일하지 마라(인스턴스·모르는 날·위반량 규칙). 이유: 의미의 단일 기준은 `evaluate.py`다.
- 시간 예산(`SOLVE_TIME_LIMIT_S` 등)을 늘리지 마라.
- 기존 테스트를 깨뜨리지 마라.
