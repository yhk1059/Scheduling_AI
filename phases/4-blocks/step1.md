# Step 1: domain-blocks

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§2 데이터 형식 전체, §2.5 변환표, §2.6 중요도)
- `/docs/ADR.md` (ADR-003 단일 기준, ADR-018)
- `/backend/domain/models.py`, `/backend/domain/constants.py`
- `/backend/tests/test_domain.py`, `/backend/tests/test_gen_types.py`
- `/backend/tests/golden/cases.json` (step 0)

## 배경

블록 전환을 **덧붙이는 방식**으로 한다. 이 step에서는 새 모델(병동 구조, 태그, 셀렉터, 블록 3종)을 기존 템플릿 옆에 더하고, 템플릿 → 블록 변환 함수를 만든다. 기존 템플릿과 `night_only`, `history_load`는 아직 그대로 두고 step 6에서 지운다. 그래서 이 step이 끝나도 솔버·LLM·클라이언트는 지금처럼 동작한다.

## 작업

**테스트를 먼저 쓴다(TDD).** `backend/tests/test_domain_blocks.py`, `backend/tests/test_convert.py`

### 1. 병동 구조와 명단 (`models.py`, 설계 §2.1·§2.2)
- `ShiftDef`, `WardConfig`를 더한다. `DEFAULT_CONFIG`(D 데이 8h, E 이브닝 8h, N 나이트 8h, O 휴무 0h)는 `constants.py`의 값으로 만든다.
- 검증: 코드 형식(1~3자 영문 대문자·숫자), 중복 금지, `O` 필수·hours 0, `parts`는 복합이 아닌 근무 코드만, 코드 수 ≤ `MAX_SHIFT_CODES`(8).
- `covers(config, code) -> set[str]` 순수 함수.
- `Nurse.tags: list[str] = []`(태그 1~10자, 한 사람 ≤ 5개). `night_only`는 그대로 둔다.
- `ScheduleRequest.config: WardConfig = DEFAULT_CONFIG`, `TranslateContext.config`도 같은 기본값.
- `ShiftCode`는 `str`로 넓히고, `carry_over`, `previous`, `fixed_assignment`, 템플릿 params의 코드 참조를 `config`의 코드로 검증한다(참조 무결성 오류 메시지에 필드 경로). 기본 config에서는 지금과 똑같이 D/E/N/O만 통과한다.
- `ScheduleRequest.history: History | None = None`을 더한다(설계 §2.7: `start_date`, `rows`, `holidays`). `history_load`는 그대로 둔다.

### 2. 셀렉터와 블록 (설계 §2.3·§2.4)
- `People`, `Days`, `Shifts`(`in`은 alias), `CountParams`, `SequenceParams`(forbid / run / after+then_off 중 하나), `BalanceParams`.
- 블록 제약 `CountRule`(type `count`), `SequenceRule`(`sequence`), `BalanceRule`(`balance`)을 `ConstraintSpec` union에 **더한다**. 칸 고정은 기존 `fixed_assignment`를 그대로 쓴다(설계의 `fixed`).
- 블록은 `priority: "high" | "normal" | "low"`를 가진다. 블록의 `weight`는 `PRIORITY_WEIGHTS[priority]`(constants: high 30, normal 10, low 5)로 채운다(입력의 weight는 무시하거나 일치 검사). 기본 hardness: count·sequence는 hard, balance는 soft, balance 기본 priority는 low.
- 검증: min ≤ max, min/max 중 하나 이상, `per=person_window`면 `window`(2~14) 필수, forbid 패턴 2~4칸·4개 이하, run이면 min_len/max_len 중 하나 이상, after면 then_off ≥ 1.
- 참조 무결성(`ScheduleRequest`): `people.ids`는 명단에, 코드는 config에, `days.days`는 기간 범위에. 태그는 명단에 없어도 통과한다(빈 대상 검사는 translate에서).
- `_constraint_refs`를 블록에도 맞게 넓힌다.

### 3. 템플릿 → 블록 변환 (`backend/domain/convert.py`)
- `legacy_to_block(spec) -> ConstraintSpec`: 설계 §2.5 표 그대로. `id`, `scope`, `source_text`, `enabled`, `hardness` 유지. weight → priority(10 → normal, 5 → low, 그 밖은 가장 가까운 단계). `fixed_assignment`는 그대로 돌려준다.
- `night_only_rule(id) -> CountRule`: "나이트 전담은 나이트와 휴무만"(hard, scope ward, `people.tags=["나이트전담"]`, `shifts.not_in=[N, O]`, per person, max 0).
- `convert_request(req) -> ScheduleRequest`: 템플릿 제약을 모두 블록으로, `night_only=True` 간호사에게 `나이트전담` 태그를 붙이고 `night_only_rule`을 더한다(`night_only` 값은 이 단계에서는 유지한다). `history_load`는 그대로 둔다.
- 10번 `shift_preference`의 희망은 `min = 대상 날짜 수`, 기피는 `max = 0`(설계 §2.5 주).
- 테스트: 12종 각각, hard/soft 토글, weekends_only/days 조합, golden `cases.json`의 모든 request가 변환 후 `ScheduleRequest`로 검증되는지.

### 4. 기존 테스트 정리
- `test_gen_types.py`의 `ConstraintSpec` union 개수 기대값을 새 개수로 바꾼다.
- `lib/types.gen.ts`는 **다시 생성하지 않는다**(클라이언트는 step 7에서 바꾼다).

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 상수는 `constants.py`에 모았는가? `solver/`와 `llm/`이 서로 import하지 않는가? `convert.py`는 `domain/` 안의 순수 함수인가?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 기존 템플릿 모델, `night_only`, `history_load`를 지우지 마라. 이유: step 6에서 지운다. 지금 지우면 솔버·LLM·클라이언트가 함께 깨진다.
- 솔버(`backend/solver/`)와 LLM(`backend/llm/`)의 동작을 바꾸지 마라. 컴파일을 위해 import·타입만 맞추는 것은 허용한다.
- `lib/types.gen.ts`를 다시 생성하지 마라.
- 기존 테스트를 깨뜨리지 마라.
