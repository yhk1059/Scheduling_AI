# Step 2: translator-at-least

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — "LLM 호출 방식", "LLM 출력 검증", "데이터 흐름 › 규칙 입력"
- `/docs/ADR.md` — ADR-004, ADR-019, ADR-020("시간대 필요 인원")
- `/docs/PRD.md` — "핵심 기능 1·8"(필요 인원은 범위를 받는다, eval)
- `/backend/llm/prompts.py` — `TRANSLATE_EXAMPLES`, `TIME_WINDOW_EXAMPLES`, `TRANSLATE_SYSTEM`의 "필요 인원은 범위를 받는다" 문장과 "시간대 필요 인원 › 인원 표현" 문장
- `/backend/llm/translator.py` — 검증 흐름(바꾸지 않는다)
- `/backend/tests/test_llm_translator.py` — 예시가 스키마를 통과하는지 보는 테스트(`ALL_EXAMPLES`), mock 클라이언트 방식
- `/eval/run.py` — 실행 방법(docstring), `write_results`, 합격 기준
- `/eval/dataset.jsonl`, `/eval/results.md`
- `/README.md` — "번역 정확도" 수치 한 줄(44행 부근)
- `/lib/wording.ts` — `coverageText`(요약표가 "2명 이상"을 어떻게 쓰는지. 바꾸지 않는다)

## 배경

지금 LLM은 "오픈 2명"처럼 숫자만 있으면 `eq`(정확히)로, "2명 이상"만 `ge`로 세운다. 매니저가 "오픈 2명"이라고 말할 때 뜻은 대개 "2명은 있어야 한다"이고, 정확히 2명이면 사람이 남는 날 근무표가 나오지 않는다. 이 step은 기본 해석을 **이상(≥)**으로 바꾼다. "정확히", "딱"처럼 분명한 말이 있을 때만 `eq`다. 범위("3~4명")는 그대로다. 식 언어·검증·솔버는 바꾸지 않는다. 저장된 규칙도 바꾸지 않는다(기존 "정확히" 카드와의 충돌은 step 0·1이 적용 시점에 안내한다).

## 작업

1. `backend/llm/prompts.py`
   - `TRANSLATE_SYSTEM`의 "필요 인원은 범위를 받는다" 문장을 바꾼다: `"3~4명"은 all[ge min, le max], "3명", "3명 이상", "최소 3명"은 ge(값 이름 min, label "최소 인원"), "정확히 3명", "딱 3명"처럼 같음을 분명히 말할 때만 eq(label "인원")`. "시간대 필요 인원 › 인원 표현은 필요 인원과 같다" 문장도 같은 뜻으로 고친다.
   - `TRANSLATE_EXAMPLES`에서 숫자만 있는 필요 인원 예시(`"평일 오픈 2명, 주말은 3명"`, `"오픈 평일 2명 이상, 주말 3명, 피크 P …"`의 주말·피크 규칙)를 `ge` + `"최소 인원"`으로 고친다. `"금요일엔 미들 딱 2명"`은 `eq` 그대로 둔다(분명한 말의 예시). `TIME_WINDOW_EXAMPLES`의 `_window_rule`은 이미 `ge`다.
   - 중요도·hardness 규칙은 건드리지 않는다.
2. `backend/tests/test_llm_translator.py`: 바뀐 예시가 스키마를 통과하는 기존 테스트가 그대로 통과해야 한다. 프롬프트 문장을 확인하는 테스트가 있으면 새 문장에 맞춘다. `TRANSLATE_SYSTEM`에 `"정확히"`와 `"딱"`이 들어 있고 숫자만 있는 예시가 `ge`인지 확인하는 테스트 하나를 더한다(LLM을 부르지 않는 순수 검사).
3. `eval/dataset.jsonl`: 기대값이 "숫자만 있는 필요 인원 = eq"인 케이스를 `ge` + `"최소 인원"`으로 고친다. 지금 확인된 케이스: `w04`(평일엔 오픈 2명, 미들 2명, 마감 3명), `b20`(공휴일엔 오픈 2명), `b01`(평일에는 피크 1명), `x13`(주말 3명, 피크는 매일 1명), `t05`(17시부터 18시까지는 4명), `t09`(오후 3시부터 5시까지 2명). 이 밖에도 `"op": "eq"`인 필요 인원 모양을 전부 훑어(`python3 -c`로 `offset` 없는 `per: day` + `eq` 케이스를 나열) "정확히·딱"이 원문에 없는 것은 모두 고친다. 짝 규칙(`q02`, 세기끼리 `eq`)과 순서 규칙의 `eq 0`은 그대로다.
   - 분명한 말의 케이스가 없으면 `"금요일엔 미들 딱 2명"`과 `"주말 마감은 정확히 3명"` 두 개를 `basic` 묶음에 더한다(id는 기존 규칙대로 `b` 뒤 번호, `today`·`scope` 형식은 이웃 케이스와 같게).
   - `uv run python eval/run.py --dry-run`으로 데이터셋이 검증을 통과하는지 본다.
4. eval을 실제로 돌려 결과를 갱신한다: `uv run python eval/run.py --gate`. `.env.local`의 `ANTHROPIC_API_KEY`가 필요하다(`backend/env.py`가 읽는다). 키가 없거나 401이면 `blocked`로 두고 사유를 적는다. 100개 호출이라 몇 분 걸린다. 결과는 `eval/results.md`에 자동으로 쓰이고 "실행 이력" 표에 행이 쌓인다.
   - 불합격(전체 < 90% 또는 time-window < 90%)이면 실패 케이스를 보고 프롬프트 문장·예시를 고쳐 다시 돌린다(3회까지). 데이터셋 기대값을 LLM 출력에 맞춰 고치지 않는다.
5. `README.md`의 번역 정확도 한 줄 수치를 새 `results.md`의 전체 완전 일치율로 고친다. 랜딩(`app/page.tsx`)에 같은 수치가 하드코딩돼 있으면 함께 고친다(`grep -n "99%" app/page.tsx README.md`).

## Acceptance Criteria

```bash
uv run pytest backend/tests
uv run python eval/run.py --dry-run
uv run python eval/run.py --gate      # ANTHROPIC_API_KEY 필요. 없으면 blocked
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `backend/llm/`이 `backend/solver/`를 import하지 않는가(기존 import 목록이 그대로인가)?
   - `backend/domain/models.py`·`lib/types.gen.ts`를 손대지 않았는가(스키마 변경 없음)?
   - `eval/results.md`의 실행 이력에 새 행이 있고 모델이 `ANTHROPIC_MODEL`(기본 `claude-sonnet-5-5`)인가?
3. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(고친 프롬프트 문장, 고친 케이스 id, 새 정확도 수치, README 수치)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다. 바뀐 화면 문구가 있으면 적는다(랜딩 수치).
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(API 키 없음·한도 초과) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `backend/domain/models.py`의 스키마나 `backend/solver/`를 고치지 마라. 이유: 해석 규칙만 바뀐다. `eq`·`ge` 둘 다 이미 식 언어에 있다.
- `lib/store.ts`의 `setCoverage`(숫자 폼)를 고치지 마라. 이유: 폼은 "최소·최대가 같으면 정확히"가 명시된 입력이다(UI_GUIDE "필요 인원 폼").
- 저장 문서나 샘플(`lib/samples/shop-12.json`, `e2e/fixtures/shop-oct.json`)의 `eq` 규칙을 바꾸지 마라. 이유: 저장된 값은 자동 변환하지 않는다.
- eval 합격을 위해 데이터셋 기대값을 LLM 출력에 맞추거나 합격 기준을 낮추지 마라. 이유: eval은 번역 정확도의 증거다.
- `eval/results.md`를 손으로 고치지 마라. 이유: `run.py`가 쓴다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
