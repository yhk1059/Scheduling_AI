# Step 7: client-rename

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/lib/store.ts`
- `/lib/rules.ts`
- `/docs/UI_GUIDE.md`
- `/components/WardHome.tsx`
- `/components/WardSettings.tsx`
- `/components/ScheduleStep.tsx`
- `/components/RulesStep.tsx`
- `/components/SampleDemo.tsx`
- `/components/LandingPreview.tsx`
- `/app/page.tsx`
- `/e2e/test-helpers.ts`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

`lib/`이 끝났다. 컴포넌트와 페이지를 새 이름과 문구로 옮겨 빌드를 되살린다. 화면 구조는 바꾸지 않는다.

## 작업

1. 파일 이름: `WardHome`→`ShopHome`, `WardSettings`→`ShopSettings`.
2. 모든 화면 문구를 UI_GUIDE "문구" 표에 맞춘다: 매장, 직원, 매니저, 매장 조건, 근무 코드 색(A/M/C). 랜딩 문구도 매니저 기준으로 바꾼다.
3. 나이트 전담(추천 칩, 기본 카드, 문구)과 연차(명단 열, 근무표 44px 열, 입력 오류)를 지운다.
4. 근무 형태 표에 끝 시각과 실근무 시간 입력을 더한다.
5. 샘플 데모가 `shop-12.json`을 읽게 한다.
6. `e2e/`는 컴파일되게 이름과 import만 고친다(`ruleShape`는 `lib/rules`). `e2e/fixtures/ward-oct-v5.json`은 지운다. 실행과 시나리오 재작성은 phase `7-availability`다.

## Acceptance Criteria

```bash
npm run build
npm run lint
npx tsc --noEmit
npx vitest run
git grep -nE '[Nn]urse|\bward|Ward|_ward|간호|병동|나이트|years' -- components app lib ':!lib/types.gen.ts' && exit 1 || true
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 3단계 흐름이나 로그인 변경을 하지 마라. 이유: 뒤 step이다.
- e2e를 실행하지 마라. 이유: 이 환경에는 키가 없고 시나리오가 아직 맞지 않는다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
