# Step 7: docs-e2e

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`(ADR-016, ADR-020, ADR-022, ADR-024의 형식), `/docs/PRD.md`, `/docs/UI_GUIDE.md`, `/docs/BROWSER_TEST_SCENARIOS.md`, `/docs/DEMO_SCENARIO.md`, `/README.md`
- step 0~6이 만든 파일: `lib/demo.ts`, `lib/demo-doc.ts`, `lib/samples/demo-shop.json`, `scripts/dining-data.ts`, `scripts/gen-demo-shop.ts`, `lib/store.ts`(체험 모드), `app/demo/page.tsx`, `components/Demo.tsx`, `components/AppShell.tsx`, `components/PeriodWork.tsx`, `components/ShopHome.tsx`, `components/ScheduleStep.tsx`, `components/RulesStep.tsx`, `app/page.tsx`, `components/LoginScreen.tsx`
- `/phases/11-demo/index.json` — 앞 step들의 summary(결정 사항과 바뀐 문구)
- `/e2e/entry.spec.ts`(S1의 랜딩 버튼 검사), `/e2e/test-helpers.ts`(`T0`, `trackProblems`, `expectNoProblems`, `expectNoDevTerms`), `/playwright.config.ts`

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더했다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝, 직원 20명)을 실제 앱 화면으로 눌러 본다. 자유 입력은 없고 버튼만 누른다. LLM 엔드포인트는 부르지 않고 솔버만 실제로 부른다. 상태는 메모리에만 두고 저장하지 않는다. 확정·직원 링크·저장은 막고 [내 매장으로 시작하기]로 안내한다. 랜딩은 [내 매장으로 시작하기] + [체험하기], 상단 바에 [데모 영상]이다.

이 step은 문서를 현재 코드에 맞추고, 로그인 없이 도는 체험 e2e를 더하고, 깨진 S1을 고친다.

## 작업

1. **`docs/ADR.md`에 ADR-025 추가**: 제목 "로그인 없는 체험은 샘플 매장을 메모리에 올린 실제 앱 화면". 머리에 `> ADR-022의 "방문자는 직접 눌러 볼 수 없다" 트레이드오프를 고친다. 영상은 그대로 둔다.` 형식은 ADR-024를 따른다(결정 / 이유 / 트레이드오프).
   - 결정: `/demo`는 `AppShell`의 체험 모드다. 데이터는 `lib/samples/demo-shop.json`(한강 다이닝, 번역된 카드 10장 중 2장은 대기, 해 없음 설명과 검증된 제안을 미리 저장)이고 `npm run gen:demo-shop`이 실제 백엔드로 만든다. 날짜는 열 때 오늘 이후 첫 월요일로 옮기고 공휴일은 비운다. 스토어는 싱글턴에 `demo` 플래그, persist 저장소를 메모리로 바꾸고, `signedIn`이 체험을 먼저 끝낸다. 체험에서 부르는 API는 `/solve`뿐이고 `/translate`·`/explain`·Supabase는 부르지 않는다. 저장된 설명은 요청의 규칙 제약이 저장 시점과 같을 때만 보여 준다. 막는 것: 말로 적기, 직원 링크, 확정, 저장. 로그인 사용자는 `/demo`에서 `/app`으로 간다.
   - 이유: 영상과 로그인 사이의 간격(처음 온 사람에게 로그인은 부담, 영상은 수동적). ADR-016의 샘플이 실패한 이유 둘(조작 불가, 내 매장과 같은 저장소)을 피하고, ADR-022의 비용 우려(방문자마다 LLM 호출)는 버튼만 누르게 해서 없앤다. 백엔드 엔드포인트에 지금도 인증이 없으므로 체험이 LLM 노출을 늘리지 않는다.
   - 트레이드오프: 화면이나 번역·설명 형식이 바뀌면 JSON을 다시 만들어야 한다(영상과 같은 유지 비용). 카드를 바꾼 뒤의 해 없음에는 설명이 없다. 한강 다이닝 한 매장뿐이다. 새로고침하면 처음부터다.

2. **`docs/PRD.md`**: 보조 사용자(포트폴리오 방문자)에 "랜딩의 [체험하기]로 로그인 없이 샘플 매장을 눌러 본다"를 더한다. 화면 목록에 `/demo`(체험: 샘플 매장을 올린 앱, 로그인 없음, 저장 없음)를 더한다. 흐름(랜딩 → …)과 랜딩 설명의 버튼을 맞춘다. 데모 영상 절(J7) 아래에 체험 저니(J7-b: 랜딩 [체험하기] → ② 대기 카드 2장 [모두 적용] → ③ [근무표 만들기] → 근무표 없음과 저장된 설명·제안 → [수락] → 근무표 → [확정] → 안내 대화상자 → [내 매장으로 시작하기] 또는 [나가기])를 적는다. "MVP에서 제외"의 "게스트 모드"는 유지하되 "(체험은 게스트 모드가 아니다: 내 매장이 아니라 샘플 매장이고 저장하지 않는다)"를 덧붙인다.

3. **`docs/ARCHITECTURE.md`**: 디렉토리 구조에 `app/demo/page.tsx`, `components/Demo.tsx`, `lib/demo.ts`, `lib/demo-doc.ts`, `lib/samples/demo-shop.json`, `scripts/dining-data.ts`, `scripts/gen-demo-shop.ts`를 더하고 `scripts/record-dining.ts` 설명을 맞춘다. "상태 관리 › 저장"에 체험(메모리 저장소, `demo` 플래그, `signedIn` 가드) 한 항목. "데이터 흐름"에 `체험: /demo → demoData(JSON, 오늘) → store(메모리) → /solve만 → 해 없음이면 저장된 설명(규칙 제약 signature가 같을 때)` 한 줄. "환경 › 로컬"에 `npm run gen:demo-shop`(백엔드 :8000 필요).

4. **`docs/UI_GUIDE.md`**: "화면 목록"에 체험(`/demo`). "랜딩 페이지" 절의 상단 바([데모 영상] Text + [GitHub]), 히어로([내 매장으로 시작하기] Primary + [체험하기] Secondary, 보조 한 줄 문구), CTA 띠(두 번째 버튼 [체험하기]) 문구를 코드와 같게 고친다. "로그인 화면"에 카드 아래 Text 링크. 새 절 "체험"(상단 바 오른쪽 체험 바: "체험 중" 배지 + "저장되지 않아요" + [내 매장으로 시작하기] + [나가기]; 본문 위 안내 한 줄; ① 직원 링크 카드의 체험 문구; ② 입력 바 자리의 안내 패널; ③ [확정] → "확정은 내 매장에서 할 수 있어요" 대화상자; 저장된 설명은 규칙 제약을 바꾸면 보이지 않음). 문구는 step 3~6 summary와 코드의 실제 문장을 그대로 옮긴다.

5. **`docs/BROWSER_TEST_SCENARIOS.md`**: S1을 고친다(상단 바 `button "데모 영상"` 1개, `link "체험하기"` 2개는 href `/demo`, `link "내 매장으로 시작하기"` 2개는 href `/app`). 새 **S20 체험 저니**를 적는다(사전 상태: 로그인 없음, 시계 `T0`; `/demo` → 상단 바 "체험 중" → ② 매장 조건이 현재 단계, 대기 카드 2장 → [모두 적용] → ③ → [근무표 만들기] → "이 조건으로는 근무표를 만들 수 없어요" → "원인을 분석하는 중…"이 뜨지 않고 제안 카드([수락])가 바로 보인다, `/api/py/explain`·`/api/py/translate` 요청 0 → [수락] → "반드시 규칙을 모두 지켰어요" → [확정] → 대화상자 "확정은 내 매장에서 할 수 있어요" → [닫기] → ①에서 "20명 중 20명 제출"과 직원별 캘린더, [링크 복사] 없음 → [나가기] → 랜딩 → 다시 `/demo`를 열면 대기 카드가 다시 2장(저장되지 않음) → localStorage의 `shop-scheduler` 키에 "한강 다이닝"이 없다). 실행 환경의 spec 목록에 `e2e/demo.spec.ts: S20 (로그인 없음, Supabase 없음, /solve만 실제)`를 더한다. 개발 용어 검사는 저장된 설명(LLM 문장)이 보이는 ③ 해 없음 화면에서는 건너뛴다.

6. **`e2e/entry.spec.ts`** S1을 시나리오대로 고친다. **`e2e/demo.spec.ts`**(새 파일)에 S20을 쓴다. 로그인·`clearAccount`·Supabase 도우미를 쓰지 않는다. `page.on("request")`로 `/api/` 요청을 모아 `/solve` 외의 경로가 없음을 검사한다. `trackProblems`/`expectNoProblems`는 쓴다. 솔버 대기는 다른 spec의 상한(15초)을 따른다.

7. **`README.md`**: 데모 영상 링크 줄 옆에 체험 한 줄을 더한다. 배포 URL이 README에 이미 있으면 그 호스트의 `/demo`를, 없으면 "랜딩의 [체험하기]로 로그인 없이 샘플 매장을 눌러 볼 수 있습니다"만 적는다. "사용" 절에 "로그인 전에 [체험하기]로 샘플 매장을 눌러 볼 수 있습니다" 한 줄.

8. `npm run test:e2e -- e2e/demo.spec.ts e2e/entry.spec.ts`를 돌린다. `.env.local`의 테스트 Supabase·테스트 계정·Anthropic 키가 필요하다(S1이 로그인한다). 이미 떠 있는 `npm run dev`(`NEXT_PUBLIC_E2E_LOGIN` 없음)가 있으면 Playwright가 그 서버를 재사용해 S1 로그인이 막힌다. 그 경우 그 서버를 멈추고 Playwright가 띄우게 한다(BROWSER_TEST_SCENARIOS "실행 환경"). 키가 없으면 `demo.spec.ts`만 돌리고 S1은 `blocked_reason`에 적는다.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
npm run test:e2e -- e2e/demo.spec.ts e2e/entry.spec.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 문서의 파일 목록·문구가 실제 코드와 같은가(복사해 넣었는가)?
   - `demo.spec.ts`가 Supabase·로그인 도우미 없이 도는가? `/solve` 외의 API 요청이 0임을 검사하는가?
   - ADR-025가 ADR-016·022와의 관계를 적었는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(고친 문서와 절, 새 spec의 검사 항목, e2e 결과)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(테스트 환경 변수 없음 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 문서를 맞추려고 앱 코드의 문구를 바꾸지 마라. 이유: 이 step은 문서와 e2e가 코드를 따라간다. 코드 버그를 찾으면 summary에 적고 고치지 않는다(명백한 오타 수준만 예외).
- `demo.spec.ts`에서 LLM 응답 문장을 그대로 검사하지 마라. 이유: 저장된 설명이라 지금은 고정이지만 JSON을 다시 만들면 바뀐다. 제안 카드의 존재와 [수락] 버튼만 검사한다.
- `public/demo.mp4`를 다시 녹화하지 마라. 이유: 영상은 로그인 사용자의 흐름이고 이 phase가 바꾸지 않았다(랜딩 첫 장면만 바뀌었으나 영상은 앱 화면이 주다). 필요하면 summary에 "재녹화 권장"으로 적는다.
- 기존 테스트를 깨뜨리지 마라.
