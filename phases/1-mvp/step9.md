# Step 9: eval-run

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ADR.md` (ADR-002, 004)
- `/eval/run.py`, `/eval/dataset.jsonl` (step 8)
- `/backend/llm/prompts.py`, `/backend/llm/translator.py`

## 작업

실제 Claude API로 eval을 실행하고, 결과에 따라 프롬프트를 개선한다. 사용자가 비용을 승인한 step이다.

1. 키를 확인한다: `uv run python -c "from backend.env import load_local_env; import os; load_local_env(); print('KEY_SET' if os.environ.get('ANTHROPIC_API_KEY') else 'KEY_MISSING')"`
   - `KEY_MISSING`이면 status를 `"blocked"`, blocked_reason을 `".env.local에 ANTHROPIC_API_KEY가 없음"`으로 기록하고 즉시 중단한다.
2. `uv run python eval/run.py`를 실행한다(1회차). `eval/results.md`가 생성된다.
3. 실패 케이스를 분석한다. 원인이 프롬프트(템플릿 설명, hard/soft 규칙, 날짜 해석 지시, few-shot 예시)라면 **`backend/llm/prompts.py`만** 고친다.
4. 다시 실행한다. **전체 실행은 최대 3회**로 제한한다(비용 상한).
5. 최종 `eval/results.md` 상단에 "실행 이력" 표를 남긴다: 회차, 바꾼 점 한 줄, 주요 지표(제약 F1, 완전 일치율, status 정확도).
6. 프롬프트를 바꿨으므로 `uv run pytest backend/tests -q`를 다시 실행해 통과를 확인한다.

## Acceptance Criteria

```bash
test -s eval/results.md
uv run pytest backend/tests -q
uv run python eval/run.py --dry-run
```

## 검증 절차

1. AC를 실행한다.
2. `eval/results.md`에 지표 표, 실패 케이스, 실행 이력이 있는지 확인한다.
3. `phases/1-mvp/index.json`의 step 9를 업데이트한다. summary에 최종 제약 F1, 완전 일치율, 실행 횟수를 담는다.

## 금지사항

- **`eval/dataset.jsonl`의 expected를 모델 출력에 맞춰 고치지 마라.** 이유: 정답을 결과에 맞추면 eval이 무의미해진다. 정답 자체가 명백히 틀린 경우(날짜 계산 오류 등)만 고칠 수 있다. 고쳤다면 results.md에 케이스 id와 사유를 기록한다.
- 전체 eval을 3회 넘게 실행하지 마라. 이유: 비용 상한이다. 특정 케이스만 확인할 때는 `--ids`를 써라.
- `.env.local` 내용이나 API 키를 출력하지 마라(cat, echo, print, 로그 모두 금지).
- 모델을 바꾸지 마라(`DEFAULT_MODEL` 유지). 이유: 모델 비교 eval은 범위 밖이다.
- 기존 테스트를 깨뜨리지 마라.
