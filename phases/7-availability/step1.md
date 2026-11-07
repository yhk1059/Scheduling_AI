# Step 1: flow-steps

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/components/PeriodWork.tsx`
- `/components/RulesStep.tsx`
- `/components/CoverageForm.tsx`
- `/components/ScheduleStep.tsx`
- `/components/ShopSettings.tsx`
- `/docs/UI_GUIDE.md`
- `/docs/PRD.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

근무표 작성을 ① 가능 시간 → ② 매장 조건 → ③ 근무표로 바꾼다. 링크 표와 직원 화면은 뒤 step이다.

## 작업

UI_GUIDE "근무표 작성"을 그대로 따른다.

1. 스테퍼 세 단계. ①에는 준비 요약과 링크 표 자리를 둔다.
2. ②: `RulesStep`의 `intro` 모드를 없애고 한 입력창으로 합친다. 맨 위 근무조·필요 인원 요약표, 예시 3개, 접힌 숫자 입력, 규칙 카드.
3. ③: 요청 단계를 없애고 접힌 "이번 근무표 예외 입력"으로 옮긴다. 근무표, 해 없음, 통계는 그대로다. 해 없음에서 `avail-` 규칙은 "{이름} 가능 시간"으로 보이고 끄기 버튼이 없다.
4. 매장 홈의 지금 할 일 카드, `매장 설정` [매장 조건] 탭의 문구를 맞춘다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/7-availability/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 두 번째 입력창을 만들지 마라. 이유: 매장 소개와 규칙이 나뉘어 생긴 혼란을 없애는 것이 목적이다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
