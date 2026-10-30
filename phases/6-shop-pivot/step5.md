# Step 5: eval-shop

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/eval/run.py`
- `/eval/dataset.jsonl`
- `/backend/tests/test_eval_runner.py`
- `/docs/PRD.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

이 step은 백엔드만 다룬다. 프론트(`lib/`, `components/`, `app/`, `e2e/`)는 `6-shop-pivot`의 뒤 step에서 옮기므로 그 사이 `npm run build`와 vitest가 깨지는 것은 정상이다. 백엔드 pytest만 통과시켜라. eval 데이터셋을 매장 말투로 바꾼다. **실행은 사용자가 뒤에 노트북에서 한다.**

## 작업

1. `eval/dataset.jsonl`을 매장 말투 80~100개로 다시 만든다. 기존 케이스 모양을 옮겨 쓰되(D→A, E→M, N→C처럼 말과 식을 함께) 뜻이 안 맞는 케이스는 지운다.
2. 새 묶음을 넣는다: `set: "time-window"` 시간대 필요 인원 10개 이상(근무조가 덮는 구간, 복합 구간, 덮는 근무조가 없어 clarify), `set: "hours"` 주 근무 시간 5개 이상, 태그 배치, 조건부, 짝.
3. 근무조 시각을 쓰는 케이스의 `expected`는 기본 근무조 시각에 맞춘다. `eval/run.py`의 판정과 `validate_dataset`을 새 모델에 맞춘다.
4. `run.py` 결과에 묶음별 정확도를 넣고, 합격 기준(전체 90%, `time-window` 90%)과 합격 여부를 출력한다. `eval/results.md`는 지난 결과라는 한 줄을 맨 위에 더한다.
5. `validate_dataset`을 통과하는지 테스트로 고정한다(LLM 호출 없음).

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
wc -l eval/dataset.jsonl
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- eval을 실제로 실행하지 마라. 이유: 이 환경에는 API 키가 없다. summary에 실행 명령을 적어라.
- `ANTHROPIC_API_KEY`를 요구하거나 넣지 마라.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
