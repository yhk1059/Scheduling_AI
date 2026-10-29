# Step 5: eval-blocks

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§7 eval, §2.5 변환표, §5 LLM 출력)
- `/eval/run.py`, `/eval/dataset.jsonl`, `/eval/results.md`
- `/backend/tests/test_eval_runner.py`
- `/backend/domain/convert.py`, `/backend/solver/stats.py`(`violations`), `/backend/solver/select.py`
- `/backend/llm/prompts.py`, `/backend/llm/translator.py` (step 4)

## 배경

LLM 출력이 블록이 되어 같은 규칙도 여러 모양으로 나올 수 있다. 그래서 eval 비교를 **의미 기준**으로 바꾸고, 기존 44건을 블록 기대값으로 기계 변환하고, 새 기능 케이스를 더한 뒤 **실제 API로 eval을 돌려 목표를 통과**해야 이 step이 끝난다.
목표(사용자 결정 ★9): 기존 케이스 완전 일치 ≥ 95%, 새 케이스 완전 일치 ≥ 85%, 스키마 유효율 100%. 못 미치면 이 step 안에서 프롬프트를 보강해 다시 돌린다.

## 작업

**테스트를 먼저 쓴다(TDD).** 판정기는 `backend/tests/test_eval_runner.py`.

### 1. 의미 기준 판정기 (`eval/run.py`)
- eval 병동(지금 `_ward()`)과 케이스의 기간에서, 고정 시드로 무작위 근무표 K=50개를 만든다(config 코드 안에서 무작위, 이월 포함).
- 기대 블록과 실제 블록이 "같다" = K개 모두에서 `stats.violations`(hard·soft 공통 위반 판정)의 위반 집합(사람·날·묶음)이 같고, `hardness`가 같고, soft면 `priority`가 같다.
  - 무작위 근무표만으로는 위반이 거의 안 나는 규칙(예: 특정일 휴가)도 구분되도록, 기대 블록마다 그 블록을 위반하게 만든 근무표 몇 개를 더한다(기대 블록의 대상 칸을 뒤집어 만든다).
- 케이스 안의 제약 목록은 일대일 매칭(같은 것끼리 짝, 남는 것은 FP/FN)으로 precision/recall을 낸다. `config_changes`는 코드·hours·parts가 같으면 일치.
- 테스트: 같은 규칙의 다른 모양 쌍(휴가 per=person max 0 ↔ 칸마다 per=day 모양, `in [D,E]` ↔ `not_in [N,O]`(기본 config에서), 순서만 다른 셀렉터 목록)이 일치로, 숫자가 하나 다른 쌍은 불일치로 판정된다.

### 2. 데이터셋 (`eval/dataset.jsonl`)
- 기존 44건의 expected를 `convert.py`로 **기계 변환**한다(변환 스크립트를 `eval/convert_dataset.py`로 두고 한 번 실행. 손으로 고치지 않는다). 케이스에 `"set": "legacy"`.
- 새 케이스 25건 이상(`"set": "new"`): M 추가 설정 카드(+ M 필요 인원 블록), 더블 DE + 사람마다 월 2회, 주 52시간, 태그(책임·신규) 배치, 토요일만 다른 인원, 7일 중 휴무 1일, 나이트 블록 최소 2일, 나이트 끝나면 2일 휴무, 중요도 표현(높음·낮음), 공휴일만, 특정 요일 기피, 빈 대상 clarify(없는 태그), 명단에 없는 태그 clarify, 인원 모순 clarify, 하루 세 근무 unsupported, 짝 규칙 unsupported, 인젝션 문장. eval 병동에 태그(책임 2명, 신규 3명)를 더한다.
- `validate_dataset`: 새 형식 검증(블록·config_changes, set 필드).

### 3. 게이트 (`--gate`)
- `uv run python eval/run.py --gate`: 전체를 실제 API로 돌리고 `results.md`를 쓴 뒤, set별 완전 일치율과 스키마 유효율이 목표 미만이면 exit 1. 목표 숫자는 `eval/run.py` 상단 상수.
- `results.md`에 set별 지표 표를 더한다.

### 4. 실행과 보강
- `--gate`를 실행한다. 목표 미만이면 실패 케이스를 보고 `backend/llm/prompts.py`(예시·설명)를 보강해 다시 실행한다. 범위를 좁혀 확인할 때는 `--ids`를 쓴다.
- 보강은 프롬프트에서만 한다. 판정기를 느슨하게 하거나 기대값을 실패한 출력에 맞춰 고치지 않는다. 단 기대값 자체가 설계와 다르게 틀린 경우(변환 버그 등)는 고치고 summary에 근거를 적는다.

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
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(set별 완전 일치율, 스키마 유효율, 케이스 수, 보강한 프롬프트 요지)"`
   - 수정 3회 시도 후에도 목표 미달 → `"status": "error"`, `"error_message": "set별 지표와 남은 실패 케이스 id"`
   - `ANTHROPIC_API_KEY`가 없거나 API가 계속 503이면 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단. 그 밖에는 `blocked`를 쓰지 않는다.

## 금지사항

- 목표 숫자를 낮추지 마라. 이유: 사용자 결정(★9)이다.
- 실패한 LLM 출력에 맞춰 기대값을 고치지 마라. 이유: eval이 무의미해진다.
- 모델(`ANTHROPIC_MODEL`)을 바꾸지 마라.
- eval 실행을 `npm run test`나 Stop 훅에 넣지 마라. 이유: 비용과 시간.
- 기존 테스트를 깨뜨리지 마라.
