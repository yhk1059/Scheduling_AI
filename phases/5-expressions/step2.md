# Step 2: evaluate-expr

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§2.2 범위, §2.3 세는 칸·모르는 날, §2.4 Balance, §3 위반 계산)
- `/docs/ADR.md` (ADR-019)
- `/backend/domain/models.py` (step 1의 `Rule` 등), `/backend/domain/convert.py` (`block_to_rules`)
- `/backend/solver/select.py`, `/backend/solver/stats.py` (`violations`), `/backend/solver/model.py`
- `/backend/tests/golden/blocks-cases.json`, `/backend/tests/golden/expr-convert-cases.json`

## 배경

식 규칙의 **의미를 근무표 위에서 평가하는 순수 함수**를 만든다. 이 함수가 식 의미의 단일 기준이다. 결과 통계(soft 위반 목록), eval 판정기, 예시 판정(step 6)이 모두 이것을 쓰고, step 3의 CP-SAT 컴파일은 이 함수와 같은 답을 내는지로 검증한다. 이 step에서는 솔버 풀이 경로를 바꾸지 않는다.

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_evaluate.py`

### 1. 평가 함수 (`backend/solver/evaluate.py`, 순수 함수, CP-SAT 미사용)
```python
@dataclass(frozen=True)
class Instance:
    nurse_id: str | None          # 사람이 묶인 범위면 그 사람
    days: tuple[int, ...]         # 인스턴스가 대표하는 날(day·person_day는 d, week·window는 그 날들, person·period는 비움)

@dataclass(frozen=True)
class RuleViolation:
    instance: Instance
    amount: int                   # soft 위반량(설계 §3: then이 Cmp 하나면 벗어난 양, All/Any면 1)

def instances(request: ScheduleRequest, rule: Rule) -> list[Instance]: ...
def evaluate_rule(request: ScheduleRequest, assignments: Assignments, rule: Rule) -> list[RuleViolation]: ...
```
- **세는 칸**(설계 §2.3): 사람 집합(`who`, 없으면 묶인 사람 또는 모두) × 날 집합(범위가 묶은 날, day·person_day는 `offset` 구간, week·window는 그 주·창, person·period는 기간 전체)을 `Count.days`로 거른 칸 중 `shifts`에 맞는 칸의 수 또는 시간 합. 셀렉터 판정은 `select.py`를 재사용한다.
- **모르는 날은 세지 않는다**: 기간 뒤, 또는 이월(`carry_over`)로도 모르는 기간 앞의 날은 0. 이월로 아는 날은 이월 코드로 센다.
- week·window 경계는 지금 세기 블록과 같다(첫 주는 이월 포함, 잘린 끝 주는 기간 안만, 창은 꽉 찬 것만).
- `when`이 거짓인 인스턴스는 위반이 아니다. `ValueRef`는 `rule.values`로 푼다.
- 시간 위반량은 기본 근무 분량(`BASE_SHIFT_HOURS`)으로 올림(블록과 같은 상수).
- `Balance`: 지금 고르게 블록과 같은 값(with_history면 `history` 원본을 같은 셀렉터로 센 값 포함). hard면 (최대 − 최소) > max_gap일 때 위반 1개, soft면 위반량 = 최대 − 최소(허용치 표시는 지금 `FAIRNESS_TOLERANCE` 규칙과 같게).

### 2. 블록과의 동등성 테스트
- `expr-convert-cases.json`의 모든 (블록, 식) 쌍에 대해, 고정 시드 무작위 근무표 30개 + 블록 대상 칸을 뒤집은 근무표에서 `stats.violations`(블록)와 `evaluate_rule`(식)의 위반 (사람, 날) 집합이 같은지 확인한다. 위반량이 다른 모양(설계 §10: soft min_len)은 집합만 비교하고 테스트 이름에 이유를 적는다.
- 설계 §2.6 예시 6개를 손으로 만든 근무표에서 평가해 기대 위반이 나오는지 확인한다(조건부, 짝, 세기끼리 비교, 요일 조건부 순서).

### 3. stats 연결
- `stats.violations(request, assignments, c)`가 `type == "rule"`이면 `evaluate_rule` 결과를 지금 반환 형식(위반 목록)으로 바꿔 돌려준다. 블록 경로는 그대로.
- `SoftViolation.detail`에 쓸 일반 문구 함수(`describe_violation`): "{묶음} {값} (기준 {범위})" 꼴, 코드 이름은 config에서(블록 문구 규칙과 같게).

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `evaluate.py`가 CP-SAT과 `llm/`을 import하지 않는 순수 함수인가? 상수는 `constants.py`에 있는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(함수 시그니처, 동등성 결과, 다른 위반량 모양, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 솔버 풀이(`model.py`, `hard.py`, `soft.py`)를 바꾸지 마라. 이유: 컴파일은 step 3이다.
- 동등성 테스트를 통과시키려고 `block_to_rules` 변환표를 설계와 다르게 바꾸지 마라. 변환표가 틀렸다고 판단되면 설계 §2.5 기준으로 근거를 summary에 적고 고친다.
- 기존 테스트를 깨뜨리지 마라.
