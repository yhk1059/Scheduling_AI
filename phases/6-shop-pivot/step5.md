# Step 5: shift-times

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/backend/domain/models.py`
- `/backend/domain/constants.py`
- `/lib/rules.ts`
- `/components/ShiftTable.tsx`
- `/docs/PRD.md`
- `/docs/BROWSER_TEST_SCENARIOS.md`
- `/lib/samples/shop-12.json`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

근무조에 끝 시각을 더하고 기본값을 매장 근무조로 바꾼다. 기본 코드가 양쪽에서 같이 바뀌므로 백엔드와 프론트를 함께 옮긴다.

## 작업

테스트를 먼저 쓴다(TDD).

1. `ShiftDef`에 `end: str | None`을 더한다. `start`와 함께 `"HH:MM"`(30분 단위, `24:00` 허용). 휴무와 복합 코드는 둘 다 없다. 그 밖의 코드는 둘 다 필수이고 `start < end`다(자정을 넘기면 거부). `hours`는 실근무 시간으로 그대로 둔다.
2. `DEFAULT_SHIFTS`: A 오픈 09:00~15:00 6시간, M 미들 12:00~18:00 6시간, C 마감 17:00~23:00 6시간, O 휴무. `OFF_CODE`는 `"O"` 유지. 프론트 `DEFAULT_CONFIG`도 같게 하고 기본 기간 단위는 1주로 한다.
3. 기본값에 기대는 테스트를 고친다. 솔버 테스트에서 코드 이름이 의미 없는 곳은 테스트 도우미가 D/E/N 설정을 시각과 함께 명시해도 된다. `solver-cases.json`의 요청에 시각을 채운다. 목적값이 바뀌면 안 된다.
4. 근무 형태 표(`ShiftTable`)에 끝 시각과 실근무 시간 입력을 더한다. `stats.ts`, `continuity.ts`의 누적 부담 이름을 코드에 묶이지 않게 고친다(누적 열의 기본은 마감·주말).
5. `lib/samples/shop-12.json`을 `docs/BROWSER_TEST_SCENARIOS.md`의 D1(직원 12명, `리더` 3명, `신입` 2명)·D2(필요 인원)와 PRD J7의 규칙 6개로 다시 쓴다. 매장 이름은 "샘플 매장". 규칙은 식 형태이고 원문을 말투로 적는다.
6. `npm run gen:types`, `npm run gen:demo`.

## Acceptance Criteria

```bash
npm run gen:types
npm run gen:demo
npm run bench
uv run pytest backend/tests scripts/test_hooks.py
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 시각을 솔버 변수로 쓰지 마라. 이유: 시각은 판정·문맥·화면에만 쓴다(ARCHITECTURE).
- 입력 상한을 올리지 마라. 벤치가 시간 예산을 넘으면 error로 보고한다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
