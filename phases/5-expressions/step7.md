# Step 7: eval-expr

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§1 ★8·★9, §2.5·§2.6, §7 eval)
- `/docs/PRD.md` (핵심 기능 8 eval), `/docs/ADR.md` (ADR-019)
- `/eval/run.py`, `/eval/dataset.jsonl`, `/eval/results.md`, `/eval/convert_dataset.py`
- `/backend/tests/test_eval_runner.py`
- `/backend/domain/convert.py` (`block_to_rules`), `/backend/solver/evaluate.py`, `/backend/solver/stats.py`
- `/backend/llm/prompts.py`, `/backend/llm/translator.py` (step 5)

## 배경

LLM 출력이 식 규칙이 되었다. eval을 식 기준으로 옮기고, 지금까지 거절하던 규칙(조건부·짝·세기끼리 비교)을 새 케이스로 더한 뒤 **실제 API로 eval을 돌려 목표를 통과**해야 이 step이 끝난다.
목표(사용자 결정 ★8): 기존 79건 완전 일치 ≥ 95%, 새 케이스 완전 일치 ≥ 85%, 스키마 유효율 100%. 못 미치면 이 step 안에서 프롬프트를 보강해 다시 돌린다.

## 작업

**테스트를 먼저 쓴다(TDD).** 판정기는 `backend/tests/test_eval_runner.py`.

### 1. 판정기 (`eval/run.py`)
- 의미 판정 방식은 그대로(고정 시드 무작위 근무표 50개 + 기대 규칙 대상 칸을 뒤집은 근무표, 위반 집합 비교, hardness·priority 비교, 일대일 매칭). 위반 계산을 `evaluate.evaluate_rule`(식)로 바꾼다.
- 판정 근무 형태 = 기본 + 기대 config_changes + 실제 출력이 새로 더한 코드(지금과 같음).
- 테스트: 같은 규칙의 다른 식 모양 쌍이 일치로 판정된다 — 짝 금지 `Count{who ids[a,b], N} ≤ 1` ↔ `when Count{who a, N} ≥ 1 then Count{who b, N} eq 0`, 최대 연속 window ↔ 동일 의미 offset 모양, 휴가 person max 0 ↔ person_day 모양, `in`↔`not_in`, values 이름만 다른 쌍(값 이름·label은 판정에서 무시). 숫자·대상 하나 다른 쌍은 불일치.

### 2. 데이터셋 (`eval/dataset.jsonl`)
- 기존 79건(set legacy 49 + new 30)의 expected를 `block_to_rules`로 **기계 변환**한다(`eval/convert_dataset.py` 확장, 한 번 실행, 손으로 고치지 않는다). set 이름은 유지한다.
- 새 케이스 20건 이상(`"set": "expr"`): 조건부(태그·연차, 요일), 짝 금지·짝 같이, 세기끼리 비교(책임 ≥ 신규), 요일 조건부 순서(주말 나이트 다음 월요일 휴무), 범위 필요 인원("평일 데이 3~4명"), 병동 소개 한 문장(근무 형태 변경 + 필요 인원 여러 개), "되도록" soft 조건부, 값 이름이 필요한 문장, 여전히 unsupported(근무 시각 겹침, 하루 세 근무, 교육 2시간), 조건부 빈 대상 clarify(없는 태그), 인젝션.
- 기존 케이스 중 짝 규칙을 unsupported로 기대하던 케이스가 있으면, ADR-019 기준으로 기대값을 식으로 바꾸고 summary에 id와 근거를 적는다.
- `validate_dataset`가 식 형식(Rule 검증, set 필드)을 검사한다.

### 3. 게이트 (`--gate`)
- set별 목표 상수: `legacy`·`new` ≥ 0.95(기존 79건 합산 기준으로도 ≥ 0.95), `expr` ≥ 0.85, 스키마 유효율 1.0. 미달이면 exit 1. `results.md`에 set별 표와 실행 이력을 더한다.

### 4. 실행과 보강
- `--gate`를 실행한다. 목표 미만이면 실패 케이스를 보고 `backend/llm/prompts.py`(예시·설명)를 보강해 다시 실행한다. 범위를 좁혀 확인할 때는 `--ids`를 쓴다.
- 보강은 프롬프트에서만 한다. 판정기를 느슨하게 하거나 기대값을 실패한 출력에 맞춰 고치지 않는다. 기대값 자체가 설계와 다르게 틀린 경우(변환 버그 등)만 고치고 summary에 근거를 적는다.

## Acceptance Criteria

```bash
uv run python eval/run.py --dry-run
uv run python eval/run.py --gate
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(`--gate`는 실제 API를 부른다. `.env.local`의 `ANTHROPIC_API_KEY`를 쓴다).
2. 아키텍처 체크: eval이 `npm run test`에 들어가지 않았는가(dry-run과 판정기 단위 테스트만)? 판정에 LLM을 쓰지 않는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(set별 완전 일치율, 스키마 유효율, 케이스 수, 보강한 프롬프트 요지)"`
   - 수정 3회 시도 후에도 목표 미달 → `"status": "error"`, `"error_message": "set별 지표와 남은 실패 케이스 id"`
   - `ANTHROPIC_API_KEY`가 없거나 API가 계속 503이면 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단. 그 밖에는 `blocked`를 쓰지 않는다.

## 금지사항

- 목표 숫자를 낮추지 마라. 이유: 사용자 결정(★8)이다.
- 실패한 LLM 출력에 맞춰 기대값을 고치지 마라. 이유: eval이 무의미해진다.
- 모델(`ANTHROPIC_MODEL`)을 바꾸지 마라.
- eval 실행을 `npm run test`나 Stop 훅에 넣지 마라. 이유: 비용과 시간.
- 기존 테스트를 깨뜨리지 마라.
