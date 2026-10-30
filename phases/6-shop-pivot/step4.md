# Step 4: llm-shop

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/backend/llm/prompts.py`
- `/backend/llm/translator.py`
- `/backend/llm/explainer.py`
- `/backend/tests/test_llm_translator.py`
- `/backend/tests/test_llm_explainer.py`
- `/docs/PRD.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

이 step은 백엔드만 다룬다. 프론트(`lib/`, `components/`, `app/`, `e2e/`)는 `6-shop-pivot`의 뒤 step에서 옮기므로 그 사이 `npm run build`와 vitest가 깨지는 것은 정상이다. 백엔드 pytest만 통과시켜라. LLM이 매장 말투와 근무조 시각을 이해하게 한다. 테스트의 LLM은 mock이고 API 키는 없다.

## 작업

테스트를 먼저 쓴다(TDD).

1. translate·explain 문맥의 근무조에 `start`, `end`를 넣는다. 설정 변경 tool 입력도 시각을 받는다.
2. 프롬프트를 매장 기준으로 다시 쓴다: 역할은 스케줄 매니저의 말을 식으로 세우는 모델러, 예시는 오픈·미들·마감, 태그는 리더·신입.
3. 시간대 필요 인원 규칙을 프롬프트에 분명히 넣는다: "12시부터 15시까지 최소 3명"은 그 구간을 덮는 근무조 코드 집합을 세는 날마다 규칙이다. 구간을 덮는 근무조가 없으면 `clarify`다. 예시를 2개 이상 넣는다.
4. 노동법 조건은 사용자가 말한 숫자만 규칙으로 세우고 법을 추정하지 않는다고 적는다. 직원 가능 시간은 시스템이 따로 받으므로 매장 조건에서는 만들지 않는다고 적는다.
5. `constants.py`에 `AVAILABILITY_RULE_PREFIX = "avail-"`를 두고, explainer가 이 접두사의 규칙 변경 제안을 거부하게 한다. 충돌 설명에 나올 수는 있다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 실제 Anthropic API를 호출하지 마라. 이유: 이 환경에는 키가 없다. 호출은 mock으로 검증한다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
