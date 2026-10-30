# Step 2: availability-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/lib/supabase.ts`
- `/lib/availability.ts`
- `/lib/store.ts`
- `/docs/UI_GUIDE.md`
- `/supabase/migrations/20261030000000_shops_availability.sql`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

직원 드래그 캘린더와 매니저 링크 표를 만든다. 데스크톱 웹 기준이고 터치는 지원하지 않는다.

## 작업

순수 함수(드래그 범위 계산, slots ↔ 칸 변환)는 테스트를 먼저 쓴다.

1. `lib/supabase.ts`: 링크 행 만들기·읽기, `get_availability`, `submit_availability` rpc, 확정 때 `locked_at` 기록, 다시 확정 시 유지. 시작일이 바뀌면 행을 다시 만든다.
2. `app/a/[token]/page.tsx`: UI_GUIDE "직원 가능 시간 입력"대로. 로그인을 요구하지 않고 store를 쓰지 않는다. 드래그는 빈 칸이면 칠하고 칠한 칸이면 지운다.
3. ①의 링크 표: 행마다 [링크 복사].
4. ③ 진입과 [근무표 만들기] 때 가능 시간을 다시 읽어 store에 넣고, 달라졌으면 배너를 보인다.
5. 공통 개발 용어 검사에 걸리지 않는 문구를 쓴다(화면에 `토큰`, `availability` 금지).

## Acceptance Criteria

```bash
npm run build
npm run lint
npx tsc --noEmit
npx vitest run
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/7-availability/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 직원 화면에 다른 직원의 이름이나 매장 조건을 보여 주지 마라.
- 미제출 경고나 대리 입력을 만들지 마라. 이유: 사용자가 모두 제출한다고 가정했다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
