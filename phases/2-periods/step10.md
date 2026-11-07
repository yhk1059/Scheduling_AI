# Step 10: e2e-journey

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (사용자 저니 J0~J5, **데모 저니(최종 수용 기준)** 1~9)
- `/docs/ADR.md` (ADR-012, ADR-013, ADR-014의 "e2e는 게스트 모드까지만")
- `/docs/UI_GUIDE.md` ("화면 구조", "문구", "접근성")
- `/docs/BROWSER_TEST_SCENARIOS.md` (지금 시나리오: 옛 4단계 구조 기준)
- `/e2e/entry.spec.ts`, `/e2e/journey.spec.ts`, `/playwright.config.ts`
- `components/` 전체 (step 4, 5, 9에서 바뀐 화면과 접근성 이름)

## 배경

화면이 "시작 → 병동 홈 / 병동 설정 / 기간 작업(①②③)"으로 바뀌어 기존 시나리오 문서와 Playwright spec이 맞지 않는다. 이 step은 **게스트 모드** 기준으로 시나리오 문서와 spec을 새 구조에 맞춰 다시 쓴다. 로그인과 Supabase는 ADR-014에 따라 e2e 범위 밖이다.

## 작업

### 1. `docs/BROWSER_TEST_SCENARIOS.md` 개정
- 기존 문서 형식(대상의 접근성 역할과 이름, 값, 검증)을 유지한다.
- 시나리오를 새 화면에 맞춘다:
  - S1 랜딩 → 앱, S2 시작 화면(샘플 / 내 병동 / 이어서 하기, 입력 삭제 확인)
  - 병동 설정(기본·명단 붙여넣기·필요 인원·비활성), 병동 규칙 3개
  - 첫 기간: ① 공휴일 → ② 요청 2개 → ③ 생성 → 해 없음과 제안 수락 → 칸 고정 → 확정
  - 운영 중 변경(병가) → 최소 변경 재스케줄 → [다시 확정]
  - **다음 기간 만들기**: 날짜 범위와 이월 근무 표가 자동으로 채워지고, 생성 결과에 누적 부담 열과 근거가 보인다(데모 저니 9)
  - 저장과 이어서 하기(새로고침 후 [이어서 하기])
- **시간 고정**: 날짜가 실행일에 따라 바뀌지 않도록 브라우저 시계를 고정한다(`page.clock.setFixedTime(new Date("2026-10-28T09:00:00+09:00"))`). 대상 기간과 근무표 칸 이름(`button "{이름} {M}월 {D}일 {코드}"`)을 이 날짜 기준으로 적는다. translate 요청의 `today`도 클라이언트가 보내므로 함께 고정된다.
- 운영 중 변경과 지난 날짜 잠금을 보려면 시계를 기간 중간 날짜로 옮기는 단계를 둔다(`page.clock.setFixedTime`을 다시 호출하고 새로고침).
- 문구 표기는 UI_GUIDE "문구" 표를 따른다(이달 → 이번 기간 등).

### 2. `e2e/*.spec.ts` 개정
- 문서의 시나리오와 1:1로 대응하게 고친다. 파일 분리는 재량(예: `entry.spec.ts`, `journey.spec.ts`, `next-period.spec.ts`).
- LLM 결과는 흔들릴 수 있으므로 기존처럼 카드 제목과 핵심 파라미터 값만 검증한다.
- 로그인 버튼이 생기더라도(step 13) 게스트 흐름만 검증한다.

## Acceptance Criteria

```bash
npx playwright test --list        # spec이 컴파일되고 시나리오가 나열됨
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `npm run test:e2e`를 한 번 실행한다(실제 Anthropic API 사용, ADR-013). 처음이면 `npx playwright install chromium`이 필요하다.
   - 앱 버그로 실패하면 앱을 고친다(이 step에서 컴포넌트 수정 허용, 범위는 버그 수정까지).
   - LLM 응답 변동으로 실패한 시나리오는 재실행으로 확인하고, 결과(통과/실패 시나리오와 이유)를 summary에 적는다.
3. 아키텍처 체크리스트를 확인한다:
   - e2e가 `npm run test`에 들어가지 않았는가(ADR-013)?
   - LLM을 mock하지 않았는가(ADR-013)?
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 + e2e 실행 결과"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `ANTHROPIC_API_KEY`가 없거나 브라우저 설치가 막혀 e2e를 실행할 수 없으면 AC만 통과시키고 completed로 두되, summary에 "e2e 미실행: 사유"를 적는다.

## 금지사항

- e2e를 `npm run test`나 Stop 훅에 넣지 마라. 이유: ADR-013 — 비용과 시간이 들어 수동 실행만 한다.
- 로그인·Supabase 흐름을 e2e로 자동화하지 마라. 이유: ADR-014 — 게스트 모드까지만 자동화한다.
- 컴포넌트 테스트 프레임워크를 추가하지 마라. 이유: ARCHITECTURE 테스트 스택.
- 테스트를 통과시키려고 접근성 이름을 테스트 전용 값(`data-testid` 등)으로 바꾸지 마라. 이유: 시나리오는 접근성 역할과 이름으로 대상을 찾는다.
- 기존 테스트를 깨뜨리지 마라.
