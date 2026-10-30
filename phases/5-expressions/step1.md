# Step 1: domain-expr

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§2 식 언어 전체, §2.5 변환표, §2.6 예, §11 기본값)
- `/docs/ADR.md` (ADR-003 단일 기준, ADR-018, ADR-019), `/docs/ARCHITECTURE.md` (패턴, API 계약, 422 행)
- `/backend/domain/models.py`, `/backend/domain/constants.py`, `/backend/domain/convert.py`
- `/backend/tests/test_domain_blocks.py`, `/backend/tests/test_convert.py`, `/backend/tests/test_gen_types.py`
- `/backend/tests/golden/blocks-cases.json` (step 0)

## 배경

식 전환을 **덧붙이는 방식**으로 한다. 이 step은 규칙 식 모델을 블록 **옆에** 더하고, 블록 → 식 변환 함수를 만든다. 블록은 step 8에서 지운다. 그래서 이 step이 끝나도 솔버·LLM·클라이언트는 지금처럼 동작한다(솔버는 아직 `rule` 타입을 풀지 못해도 된다. 다음 step들이 붙인다).

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_domain_expr.py`, `backend/tests/test_convert_expr.py`

### 1. 식 모델 (`models.py`, 설계 §2.1~§2.4)
- `Value{value: float ≥ 0, label: str(1자 이상)}`, `ValueRef{value: ValueName}`, `ValueName = ^[a-z][a-z0-9_]{0,23}$`.
- `ForEach{per, people: People, days: Days, window}` — `per`는 `period | day | person | person_day | person_week | person_window`. `window`는 `person_window`일 때만, 그리고 반드시(`MIN/MAX_WINDOW_DAYS`).
- `Count{who: People | None, days: Days, offset: tuple[int, int] | None, shifts: Shifts, measure}`.
- `Cmp{left: Count, op: ge | le | eq, right: float | ValueRef | Count}`, `All{all: list[Cmp]}`, `Any{any: list[Cmp]}`(각 2..4개), `Cond = Cmp | All | Any`. **재귀하지 않는다.**
- `Require{kind: "require", for_each, when: Cond | None, then: Cond}`, `Balance{kind: "balance", people, days, shifts, measure, with_history, max_gap: float | ValueRef}`.
- `Rule(_ConstraintBase)`: `type: "rule"`, `priority`(블록과 같은 `PRIORITY_WEIGHTS` 규칙), `default: bool = False`, `values: dict[ValueName, Value]`(≤ `MAX_RULE_VALUES`), `body: Require | Balance`(kind 판별). 기본 hardness: require는 hard, balance는 soft·low(블록과 같게).
- `ConstraintSpec` union에 `Rule`을 **더한다**(블록·칸 고정 그대로).
- 모델 수준 검증: `offset`은 `for_each.per`가 `day | person_day`일 때만, `offset` 범위 `MIN/MAX_OFFSET`(−7..+14)·폭 ≤ `MAX_OFFSET_SPAN`(14), a ≤ b, 규칙 안 Cmp 총수(when + then) ≤ `MAX_RULE_CMPS`(6), 모든 `ValueRef`가 `values`에 있음, `values`에 쓰이지 않는 이름이 없음.
- 상한 상수는 `constants.py`에 둔다(`MAX_RULE_VALUES=5`, `MAX_RULE_CMPS=6`, `MIN_OFFSET=-7`, `MAX_OFFSET=14`, `MAX_OFFSET_SPAN=14`).

### 2. 참조 무결성 (`ScheduleRequest`)
- `_constraint_refs` / `_constraint_codes`를 규칙에도 맞게 넓힌다: `for_each.people.ids`, 모든 `Count.who.ids`, `Days.days`, 모든 `Shifts` 코드. 오류 메시지에 규칙 id를 넣는다. 태그는 명단에 없어도 통과(빈 대상 검사는 translate에서).

### 3. 블록 → 식 변환 (`backend/domain/convert.py`)
- `block_to_rules(block) -> list[Rule]`: 설계 §2.5 표 그대로. `id`, `scope`, `source_text`, `enabled`, `hardness`, `priority` 유지. 숫자는 `values`로(이름 `min`, `max`, `max_len`, `min_len`, `off_days`, `max_gap`, label은 프리셋 이름 기준 한국어). 금지 패턴이 여러 개면 규칙을 나누고 둘째부터 id에 `-2`, `-3`… 접미. `fixed_assignment`는 그대로 한 개짜리 목록.
- `rules_request(req: ScheduleRequest) -> ScheduleRequest`: 요청의 블록을 모두 식 규칙으로 바꾼 요청. 필요 인원(`cov-` 접두 id)과 나이트전담 기본 규칙(`NIGHT_ONLY_RULE_ID`)은 `default=True`.
- 공유 픽스처 `backend/tests/golden/expr-convert-cases.json`: (블록 입력, 식 출력) 쌍. 변환표의 모든 모양 + 금지 패턴 2개 분리 + 기본 규칙 2종 + `blocks-cases.json` 요청의 모든 블록. `npm run gen:golden`이 쓰고 `--check`가 비교한다(step 9의 TS 변환이 같은 결과를 내야 하는 기준).
- 테스트: 모양마다 변환 결과, 변환된 요청이 `ScheduleRequest` 검증을 통과, 설계 §2.6 예시 6개가 모델 검증을 통과, 잘못된 식(offset을 person 범위에, 없는 ValueRef, Cmp 7개, 폭 15)이 422가 되는지.

### 4. 기존 테스트 정리
- `test_gen_types.py`의 union 개수 기대값을 새 개수로 바꾼다.
- `lib/types.gen.ts`는 **다시 생성하지 않는다**(클라이언트는 step 9).

## Acceptance Criteria

```bash
npm run gen:golden -- --check
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 상수는 `constants.py`에 모았는가? `convert.py`는 `domain/` 안의 순수 함수인가? `solver/`와 `llm/`이 서로 import하지 않는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(모델 이름, 상한, 변환 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 블록 모델(`CountRule`·`SequenceRule`·`BalanceRule`)을 지우지 마라. 이유: step 8에서 지운다. 지금 지우면 솔버·LLM·클라이언트가 함께 깨진다.
- `Cond`를 재귀 구조(조건 안에 조건)로 만들지 마라. 이유: ADR-019 결정. tool 스키마·카드 문장·검증을 단순하게 유지한다.
- 솔버(`backend/solver/`)와 LLM(`backend/llm/`)의 동작을 바꾸지 마라. import·타입 맞추기만 허용한다.
- `lib/types.gen.ts`를 다시 생성하지 마라.
- 기존 테스트를 깨뜨리지 마라.
