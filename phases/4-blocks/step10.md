# Step 10: samples-e2e

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J7 샘플 데모, 데모 저니), `/docs/ADR.md` (ADR-013 e2e, ADR-016 샘플)
- **`/docs/BROWSER_TEST_SCENARIOS.md`**, `/e2e/*.spec.ts`, `/e2e/test-helpers.ts`, `/e2e/fixtures/`
- `/lib/samples/ward-15.json`, `/lib/samples/demo-schedule.json`, `/backend/gen_demo.py`, `/backend/domain/convert.py`, `/backend/domain/legacy.py`
- `/components/SampleDemo.tsx`, `/components/LandingPreview.tsx`
- `/notes/structure-blocks-design-2026-10-29.md` (§9 마지막 줄, §10 5단계 완료 기준)

## 배경

마지막 step이다. 샘플 데이터를 새 형식으로 바꾸고, 브라우저 시나리오와 e2e를 새 기능까지 갱신해 **실제 API로 전체 저니가 통과**하는 것을 확인한다. 이 step이 끝나면 phase가 끝나고 기능 브랜치를 main에 합칠 수 있는 상태가 된다.

## 작업

### 1. 샘플 (`lib/samples/`)
- `ward-15.json`을 새 형식으로 바꾼다(`legacy.py` + `convert`로 기계 변환, 나이트 전담 2명은 태그 + 기본 규칙, `config` 기본값). 손으로 다시 쓰지 않는다.
- `npm run gen:demo`로 `demo-schedule.json`을 다시 만든다. `/demo`와 랜딩 조각이 새 형식으로 같은 내용을 보여 주게 고친다(규칙 카드 문장은 `describeBlock`).
- `gen_demo.py`, `test_demo_schedule.py`의 옛 형식 변환 경로(step 6)를 지운다.

### 2. 시나리오 (`docs/BROWSER_TEST_SCENARIOS.md`)
- 기존 시나리오의 기대 문구를 새 카드 제목·문장으로 갱신한다.
- 시나리오를 더한다: 근무 형태에 M 추가 → 필요 인원 → 근무표에 M, 말로 "D+E 더블 허용, 한 달 2번까지" → 설정 카드 + 딸린 카드 적용, 태그(책임) 배치 규칙, 첫 근무표 시작일 15일, 다음 근무표 시작일 미루기, v4 저장본(`e2e/fixtures/ward-oct.json`) 열기 → 변환 후 규칙 수 같음·재생성 가능.

### 3. e2e (`e2e/`)
- 위 시나리오를 Playwright로 자동화한다. LLM을 mock하지 않는다(ADR-013). 접근성 역할·이름으로 찾는다.
- LLM 응답 변동에 견디도록, 카드 문장은 핵심 낱말(예: "미드", "1명") 포함 여부로 확인한다.

## Acceptance Criteria

```bash
npx playwright test --list
npm run test
npm run build && npm run lint
npm run test:e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:e2e`는 실제 Anthropic API와 dev 서버(3000, 8000)를 쓴다.
   - 실행 전에 3000/8000 포트를 다른 프로세스가 쓰고 있는지 확인한다(`lsof -i :3000 -i :8000`). Playwright 설정이 `reuseExistingServer: true`라서 다른 작업 트리의 서버에 붙으면 엉뚱한 앱을 시험하게 된다. 이 작업 트리에서 띄운 서버가 아니면 `blocked`로 멈춘다(남의 프로세스를 끄지 않는다).
   - 앱 버그로 실패하면 앱을 고친다(버그 수정 범위까지). LLM 응답 변동으로 실패한 시나리오는 다시 실행해 확인하고 summary에 적는다.
2. 아키텍처 체크: e2e가 `npm run test`나 Stop 훅에 들어가지 않았는가? LLM을 mock하지 않았는가? 로그인 흐름을 자동화하지 않았는가(ADR-014)?
3. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 + e2e 결과(통과 시나리오 수)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용(실패 시나리오)"`
   - `ANTHROPIC_API_KEY`가 없거나, 포트를 다른 프로세스가 쓰고 있거나, Playwright 브라우저 설치가 막히면 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단. 그 밖에는 `blocked`를 쓰지 않는다.

## 금지사항

- e2e를 `npm run test`나 Stop 훅에 넣지 마라(ADR-013).
- 테스트를 통과시키려고 접근성 이름을 테스트 전용 값(`data-testid` 등)으로 바꾸지 마라.
- 새 기능을 넣지 마라. 이유: 이 step은 샘플·시나리오 정비와 버그 수정까지다.
- 기존 테스트를 깨뜨리지 마라.
