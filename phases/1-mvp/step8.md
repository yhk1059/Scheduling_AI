# Step 8: eval-harness

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/PRD.md` (핵심 기능 6, 데모 저니), `/docs/ADR.md` (ADR-002, 010)
- `/backend/domain/models.py`, `/backend/llm/translator.py`, `/backend/llm/client.py`, `/backend/env.py`
- `/lib/samples/ward-15.json`

## 작업

LLM 번역 정확도를 측정하는 eval 데이터셋과 실행기를 만든다. 실제 API 호출은 이 step에서 하지 않는다(step 9에서 실행).

### 1. `eval/dataset.jsonl` (40개 내외)
한 줄에 한 케이스다.
```json
{"id": "r01", "today": "2026-10-20", "scope": "ward", "text": "...",
 "expected": {"status": "ok", "constraints": [{"type": "...", "hardness": "...", "params": {...}}]}}
```
- 병동 context는 모두 `lib/samples/ward-15.json`(2026년 11월)을 쓴다. 케이스에 따라 `holidays`를 덮어쓸 수 있다.
- **구성**(수간호사가 실제로 말할 법한 한국어 말투)
  - 병동 규칙(scope "ward") 약 15개: 템플릿 1~7, 11, 12를 골고루. 한 문장에 규칙 2~3개가 섞인 경우 포함
  - 이달 요청(scope "month") 약 15개: 휴가, 고정, 희망/기피. 날짜 표현 포함("15~17일", "다음 주 수요일", "3주차", "주말마다")
  - hard/soft 판정 대비 약 4개("무조건" vs "가능하면")
  - 모호하거나 명단에 없는 이름 → `expected.status: "clarify"` 약 3개
  - 템플릿으로 표현할 수 없는 규칙("김철수랑 박민수는 같은 조 금지") → `"unsupported"` 약 3개
  - 오타나 구어체가 섞인 문장 일부
- `expected`의 nurse_id는 샘플 JSON의 id를 쓰고, 날짜는 `today`와 대상 월 기준으로 정확히 계산한다.

### 2. `eval/run.py`
```
uv run python eval/run.py [--dry-run] [--limit N] [--ids r01,r02]
```
- **`--dry-run`**: API를 호출하지 않는다.
  - 모든 케이스의 `expected.constraints`를 `ConstraintSpec`(id·scope·source_text·weight는 임의 채움)과 `ScheduleRequest` 참조 무결성으로 검증한다.
  - id 중복, status 값을 확인한다.
  - 문제가 있으면 exit 1이다.
- **실행 모드**
  - `backend.env.load_local_env()` 후 `AnthropicClient`로 `translate()`를 호출한다.
  - 키가 없으면 "ANTHROPIC_API_KEY가 없습니다" 메시지와 함께 exit 2다. 키 값은 절대 출력하지 않는다.
- **채점**: 제약 비교는 순서와 무관한 다중집합 매칭이다. 비교 대상은 `type`, `hardness`, `params`이고 `id`·`source_text`·`weight`·`scope`는 무시한다. params 안의 리스트(days)는 정렬 후 비교한다.
- **지표**
  - 스키마 유효율(예외 없이 응답한 비율)
  - status 정확도
  - 제약 단위 precision/recall/F1
  - 케이스 완전 일치율
  - clarify/unsupported 정확도
  - 평균 재시도 횟수
  - 평균과 p95 지연 시간
  - 총 토큰
- 결과를 `eval/results.md`에 쓴다(지표 표, 실패 케이스 목록과 기대값 vs 실제값, 실행 시각, 모델명). 실행 모드에서만 쓴다.
- translator의 재시도 횟수와 토큰을 얻을 수 있도록 필요하면 translator에 선택적 통계 반환 경로를 추가한다. 기존 시그니처와 테스트는 유지한다.

### 3. 테스트 (`backend/tests/test_eval_runner.py`)
- 채점 함수 단위 테스트: 순서 무관, days 정렬, 무시 필드
- mock 클라이언트로 2개 케이스를 실행해 결과 집계가 맞는지 확인한다.

## Acceptance Criteria

```bash
uv run python eval/run.py --dry-run
uv run pytest backend/tests -q
```

## 검증 절차

1. AC를 실행한다.
2. 데이터셋을 직접 다시 읽고 날짜 계산(요일, 주차)이 맞는지 표본 10개를 스스로 검산한다.
3. `phases/1-mvp/index.json`의 step 8을 업데이트한다. summary에 케이스 수와 구성을 담는다.

## 금지사항

- 이 step에서 실제 API를 호출하지 마라. 이유: 실행은 step 9의 범위다.
- `.env.local`을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라.
