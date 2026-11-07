# Step 4: demo-availability-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — UI는 TDD 대상이 아니다. DB 접근은 supabase-js + RLS뿐
- `/docs/ARCHITECTURE.md` — "패턴 › 직원 링크", "데이터 흐름 › 가능 시간"
- `/docs/UI_GUIDE.md` — "① 가능 시간", "매장 홈 › 지금 할 일 › 직원 링크 카드", 문구 규칙
- `/components/PeriodWork.tsx` — `LinksSection`(`syncAvailabilityLinks` 호출, 제출 현황, `AvailabilityOverview`에 넘기는 `rows`)
- `/components/ShopHome.tsx` — `useShareStatus`(`loadShareStatus` 호출), `ShareCard`, `TaskPanel`의 `submittedText`
- `/components/AvailabilityOverview.tsx` — `rows: AvailabilityLink[]`를 받아 직원별 캘린더를 그린다
- `/lib/demo.ts` — `demoLinkRows(availability, employees, submittedAt)`
- `/lib/store.ts` — `demo` 플래그, `WorkPeriod.availability`
- `/lib/supabase.ts` — `AvailabilityLink`

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝)을 실제 앱 화면으로 눌러 본다. 체험 데이터는 직원 20명이 가능 시간을 **모두 제출한 상태**로 시작한다(`period.availability`에 들어 있다).

①과 매장 홈은 직원 링크 행을 Supabase에서 읽어 제출 현황과 직원별 캘린더를 그린다. 체험에서는 로그인이 없어 RLS가 빈 결과나 오류를 주고 "링크를 만드는 중…"에서 멈춘다. 이 step은 체험일 때 링크 호출을 하지 않고 `period.availability`로 같은 화면을 그린다. 링크 복사는 체험에서 할 수 없다고 안내한다.

## 작업

1. **`components/PeriodWork.tsx` `LinksSection`**: `const demo = useAppStore((s) => s.demo)`.
   - 체험이면 `syncAvailabilityLinks`를 부르지 않는다(effect 안에서 `if (demo) return;`). 대신 `rows = demoLinkRows(period.availability, employees, DEMO_SUBMITTED_AT)`를 쓴다(`DEMO_SUBMITTED_AT`은 모듈 상수, 고정 ISO 문자열이면 된다. 화면에 시각은 보이지 않는다).
   - 체험일 때 카드 내용: 제목 "직원 링크", 설명 `ui.help` "체험에서는 직원 링크를 보낼 수 없어요. 직원이 가능 시간을 모두 제출한 상태로 시작해요", 그 아래 지금과 같은 "{n}명 중 {m}명 제출" 줄과 진행 막대, 미제출 목록. [링크 복사]·[새로고침]·URL·"링크를 만드는 중…"·실패 문구는 없다.
   - `AvailabilityOverview`는 체험에서도 그대로 그린다(`rows`만 바뀐다).
   - 체험이 아닐 때의 동작과 문구는 한 글자도 바꾸지 않는다.

2. **`components/ShopHome.tsx`**:
   - `useShareStatus(draft)`: `demo`를 읽어 체험이면 `loadShareStatus`를 부르지 않는다. 반환에 `demo: boolean`을 더하고, 체험이면 `url: null`, `missing`은 `draft.availability`에 없는 활성 직원 이름, `failed: false`, `none: false`.
   - `ShareCard`: `status.demo`면 제목 "직원 링크" + "{m} / {n}명 제출" 줄 + 진행 막대 + 미제출 목록 + `ui.help` "체험에서는 직원 링크를 보낼 수 없어요". [링크 복사]·[새로고침]·"불러오는 중…"·"[이어서 하기]를 누르면…"은 없다.
   - `TaskPanel`의 `submittedText`는 `share.url || share.demo`일 때 만든다(체험에서도 "20명 중 20명이 가능 시간을 제출했어요."가 보인다).

3. 수동 확인(가능하면): `/demo`에서 스테퍼 [가능 시간]을 눌러 ①에 "20명 중 20명 제출"과 직원별 캘린더(서민호 화요일 빈칸)가 보이고, 오류 알림이 없는지. [근무표] 탭 → 매장 홈의 직원 링크 카드가 체험 문구로 보이는지. 확인했으면 summary에 적고, 못 했으면 "수동 체크: 확인 못 함"이라고 적는다.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 체험에서 `lib/supabase.ts`의 링크 함수(`syncAvailabilityLinks`, `loadShareStatus`)가 불리지 않는가?
   - 체험이 아닐 때의 코드 경로와 문구가 그대로인가?
   - 화면 문구에 개발 용어가 없는가(UI_GUIDE "문구")?
   - `lib/`·`backend/`가 바뀌지 않았는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(바뀐 컴포넌트, 체험 문구, 수동 체크 결과)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 체험용으로 가짜 토큰이나 가짜 URL을 만들지 마라. 이유: 직원 화면(`/a/{토큰}`)은 DB 함수가 토큰을 확인하므로 어차피 열리지 않는다. 링크가 없다고 솔직히 안내한다.
- `AvailabilityOverview`의 props 모양을 바꾸지 마라. 이유: `rows`만 바꾸면 그대로 쓸 수 있다.
- ③·②와 랜딩을 고치지 마라. 이유: step 5·6이 한다.
- 기존 테스트를 깨뜨리지 마라.
