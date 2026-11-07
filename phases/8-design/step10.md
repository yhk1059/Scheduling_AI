# Step 10: e2e-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md`
- `/docs/UI_GUIDE.md` — "문구", "화면 구조"
- `/docs/BROWSER_TEST_SCENARIOS.md` — 수동·e2e 시나리오 S1~S18
- `/phases/8-design/index.json` — 이전 step들의 summary. 특히 "e2e에 영향 줄 수 있는 것"으로 적힌 DOM·문구 변경
- `/e2e/test-helpers.ts`, `/e2e/*.spec.ts`
- `/playwright.config.ts`
- `/components/ui.ts` — 옛 키 정리 대상
- `/README.md`

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮겼다. step 0~9가 화면을 바꾸는 동안 e2e는 돌리지 않았다(실제 Anthropic·Supabase 키가 들어가고, 중간에 돌리면 실패 원인이 섞인다). 이 step은 e2e를 새 화면에 맞추고 문서를 갱신하며, 더는 쓰지 않는 토큰을 정리한다. 앱 코드는 e2e를 통과시키기 위한 최소 수정만 한다.

## 작업

1. `npm run test:e2e`를 돌려 실패를 모은다. 실패마다 원인을 셀렉터·문구·구조 중 어느 것인지 적는다.
2. `e2e/test-helpers.ts`와 spec의 셀렉터를 새 화면에 맞춘다. 역할·접근 가능한 이름(`getByRole`, `aria-label`)을 우선하고 클래스 문자열 의존(`primaryButtons`의 `bg-[#155E75]`)은 남겨도 된다. 시나리오가 검증하는 것(규칙 준수, 최소 변경, 잠금, 이월)은 바꾸지 않는다.
3. 앱 코드가 접근성 규칙(UI_GUIDE "접근성")을 어겨서 e2e가 못 찾는 경우에만 앱을 고친다. 그 밖의 앱 수정은 하지 않고 summary에 남긴다.
4. `docs/BROWSER_TEST_SCENARIOS.md`: 화면 이름·버튼 레이블·순서(③의 예외 패널이 맨 위, 홈 링크 카드, 확정 기록, 직원 입력 두 열)를 새 화면대로 고친다. 시나리오 번호는 유지한다.
5. `components/ui.ts`: 사용처가 0인 옛 키를 지운다(`grep -rn "ui\.<key>" app components`로 확인). 사용처가 있으면 남긴다.
6. `README.md`: 제품 이름 "말로"와 한 줄 소개, 랜딩의 "만든 방식" 링크가 가리키는 절(번역 정확도 측정 방법)이 있는지 확인하고 없으면 제목만 둔 자리표시 절을 만든다.
7. `npm run test:e2e`가 전부 통과할 때까지 2~3을 반복한다.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
npm run test:e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `test:e2e`는 `.env.local`의 Anthropic·테스트 Supabase 키가 필요하다. 키가 없으면 `blocked`로 두고 사유를 적는다.
2. 아키텍처 체크: e2e가 검증하던 불변식(반드시 규칙 준수, 가능 시간 안 배정, 최소 변경, 확정 뒤 링크 잠금, 이월 표)이 그대로 검증되는가? 앱 수정이 접근성 수정뿐인가?
3. 문서 체크: BROWSER_TEST_SCENARIOS의 각 시나리오를 새 화면에서 손으로 한 번 따라갈 수 있는가(S1·S2·S9·S14 네 개는 실제로 따라간다)?
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(고친 spec·헬퍼, 앱 수정, 지운 ui 키, 남긴 문제)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- e2e가 검증하는 조건을 약하게 만들지 마라(기대값 삭제, `force` 남용, 타임아웃만 늘리기). 이유: 테스트는 솔버·LLM 안전 장치의 증거다.
- 시나리오를 통과시키려고 화면 구조를 되돌리지 마라. 이유: 화면은 UI_GUIDE가 기준이다. 셀렉터를 바꾼다.
- `NEXT_PUBLIC_E2E_LOGIN`을 `.env.local`에 넣지 마라. 이유: 7-availability step 4 결정(프로덕션 빌드에 들어가지 않게 playwright.config.ts의 서버 env로만 켠다).
- 기존 테스트를 깨뜨리지 마라.
