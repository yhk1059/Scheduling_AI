# Step 6: examples-route

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§1 ★6, §4.2 예시 판정, §6 카드)
- `/docs/ARCHITECTURE.md` (데이터 흐름 "규칙 입력", API 계약 `/translate`), `/docs/UI_GUIDE.md` ("규칙·요청 카드"의 예시 판정)
- `/backend/routes.py`, `/backend/domain/models.py` (`TranslateOk`)
- `/backend/solver/evaluate.py` (step 2), `/backend/llm/translator.py` (step 5)
- `/eval/run.py` (무작위 근무표 생성 방식 참고), `/backend/tests/test_routes.py`

## 배경

식은 문법이 맞아도 사용자의 뜻과 다를 수 있다. 그래서 카드에 **예시 판정**("이런 근무면 이 규칙에 어긋나요")을 보여 준다(결정 ★6). 예시는 LLM이 아니라 **서버가 결정적으로** 만든다: 검증된 규칙을 고정 시드 샘플 근무표 위에서 `evaluate`로 평가해 위반 사례를 고른다. solver와 llm의 조합은 `routes.py`에서만 한다.

## 작업

**테스트를 먼저 쓴다(TDD).**

### 1. 모델 (`models.py`)
```python
class RuleExample(_Strict):
    nurse_ids: list[str]              # 띠에 보일 간호사(1~3명)
    days: list[int]                   # 띠에 보일 날짜(연속 3~7일, 기간 안)
    cells: dict[str, list[ShiftCode]] # nurse_id → days 길이만큼의 코드
    marks: list[tuple[str, int]]      # 어긋난 칸 (nurse_id, day)
    detail: str                       # 한 줄 설명. 코드 이름은 config에서, 이름은 넣지 않는다(화면이 그린다)

class TranslateOk(...):
    examples: dict[str, list[RuleExample]] = {}   # 규칙 id → ≤ EXAMPLES_PER_RULE(3)
```

### 2. 샘플 근무표와 예시 고르기 (`backend/solver/evaluate.py`에 순수 함수)
```python
def sample_schedules(request: ScheduleRequest, seed: int, count: int) -> list[Assignments]: ...
def pick_examples(request: ScheduleRequest, rule: Rule, schedules: list[Assignments], limit: int) -> list[RuleExample]: ...
```
- 샘플: 고정 시드, 활성 코드 안에서 무작위(휴무 비율은 현실적으로, 예: O 약 30%), 이월 포함. 무작위만으로 위반이 잘 안 나는 규칙(특정 사람·특정 날)도 예시가 나오도록, 규칙이 고르는 칸을 뒤집은 변형을 더한다(eval 판정기와 같은 아이디어).
- 고르기: 서로 다른 인스턴스(사람·날이 겹치지 않게) 우선, 최대 `limit`개. 띠는 인스턴스의 날을 포함하는 3~7일, when이 있으면 when을 만족한 칸도 보이게. 위반이 없으면 빈 목록.
- 결정적: 같은 요청 → 같은 예시(테스트로 고정).

### 3. route (`routes.py`)
- `/translate`가 ok이면 각 규칙에 대해 `pick_examples`를 부르고 `TranslateOk.examples`를 채운다. 칸 고정·설정 변경 카드는 예시가 없다.
- 요청에 `period`·`nurses`·`config`가 있으므로 그것으로 임시 `ScheduleRequest`를 만든다(제약은 그 규칙 하나, config는 `config_changes`를 적용한 것).
- 시간: 예시 계산 전체 ≤ `EXAMPLES_TIME_BUDGET_S`(☆ 1초). 넘으면 남은 규칙은 빈 목록.
- 상수(`EXAMPLES_PER_RULE`, `EXAMPLES_SAMPLES`, `EXAMPLES_SEED`, `EXAMPLES_TIME_BUDGET_S`)는 `constants.py`.

### 4. 테스트
- 나이트 다음 날 데이 금지, 휴가, 조건부(신규 → 책임), 짝 금지 규칙에서 예시가 1개 이상, `marks`가 실제로 위반 칸, 결정적.
- 항상 지켜지는 규칙(예: 대상이 없는 날)은 빈 목록.
- `/translate` route 테스트(mock LLM)에서 `examples` 키가 규칙 id와 맞는지.
- `npm run gen:types` 산출물 비교 테스트가 있다면 기대값을 갱신하되, `lib/types.gen.ts`는 다시 생성하지 않는다.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: solver와 llm의 조합이 `routes.py`에만 있는가? `evaluate.py`가 순수 함수(CP-SAT 미사용)인가? 예시 계산에 LLM을 쓰지 않는가? 상수는 `constants.py`인가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(RuleExample 형식, 샘플 방식, 시간, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다.

## 금지사항

- 예시를 LLM으로 만들지 마라. 이유: 결정 ★6, 의미 확인은 결정적이어야 한다.
- `llm/`에서 `solver/`를, `solver/`에서 `llm/`을 import하지 마라(CLAUDE.md CRITICAL).
- `RuleExample.detail`에 간호사 이름을 넣지 마라. 이유: 이름 표시는 화면 책임이고, 응답에 불필요한 개인정보를 늘리지 않는다.
- `lib/types.gen.ts`를 다시 생성하지 마라(step 9).
- 기존 테스트를 깨뜨리지 마라.
