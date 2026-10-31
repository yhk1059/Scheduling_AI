# Step 7: confirmed-period

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "화면별 방향 › 확정 근무표"
- `/docs/UI_GUIDE.md` — "화면 구조 › 확정 근무표", "컴포넌트 › 근무 셀(지난 날짜) · 요약 지표 · 반복 사용 컴포넌트 › 배너", "타이포그래피"
- `/docs/PRD.md` — "J4. 운영 중 변경"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/components/ConfirmedPeriod.tsx`
- `/components/ScheduleStep.tsx` — step 6이 바꾼 `SummaryCard`, `ScheduleGrid`, `StatsTable`, 예외 입력 패널 모양(변경 입력 패널은 같은 모양)
- `/components/ConstraintCard.tsx` — step 5의 카드
- `/components/ShopHome.tsx` — [변경 입력]이 어떤 view로 들어오는지(포커스 대상)
- `/lib/store.ts` — 확정본 버전(`confirmed`·버전 목록)이 어디에 있는지

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 확정 근무표는 운영 중 변경을 넣는 화면이다. 이 step은 변경 입력 패널을 첫 요소로 올리고, 바뀐 칸 요약과 지표를 한 줄에 두며, 확정 기록 목록을 더한다. 최소 변경 재스케줄·다시 확정·변경 취소 로직은 그대로다.

## 작업

1. 제목 줄: "← 근무표 목록" → 근무표 이름(`ui.pageTitle`) + 날짜 범위(mono) + `운영 중`/`확정` 배지. 오른쪽 "마지막 확정 11/1 18:20 · 직원 링크는 잠겼어요". 스테퍼 없음.
2. 변경 입력 패널(끝난 근무표가 아닐 때): `ui.panel` + `grid-cols-[7fr_5fr]`. 왼쪽 "변경 입력" 제목 + 설명 "확정한 뒤 생긴 병가·휴가를 적으면, 확정 근무표에서 최소한으로 바꿔 다시 만들어요. 이미 지난 날은 건드리지 않아요." + `ui.bar`(placeholder "예: 최지훈 이번 주 병가", [요청 만들기] `ui.primaryBar`). 오른쪽에 변경 카드 목록(답장 형태, 적용되면 배지 "적용됨 · 다시 만들었어요"). 홈 [변경 입력]으로 들어오면 입력에 포커스(기존 동작), 그 밖에는 제목에 포커스.
3. 요약 줄: 왼쪽 바뀐 칸 배너(`ui.banner` 규격: 작은 주황 테두리 셀 아이콘 + "**2명, 5칸 변경** · 주황 테두리 칸이 바뀐 곳이에요. 아직 다시 확정하지 않았어요." 변경이 없으면 숨김) + 오른쪽 `SummaryCard`.
4. 근무표 카드: 표 위에 "오늘은 11/4 수예요. 지난 날짜는 🔒 자동으로 고정돼요."(운영 중일 때만). 지난 날짜 셀은 `opacity-55` + 자물쇠, 오늘 열 머리 `border-b-2 border-[#155E75]`, 변경 셀 주황 테두리. `ScheduleGrid` 재사용.
5. 버튼 줄: 왼쪽 [변경 취소] Text(변경 있을 때만). 오른쪽 [CSV 받기] Text(변경 없으면 `ui.secondary`) · [다시 확정] `ui.primaryLg`(변경 있을 때만). 끝난 근무표는 [CSV 받기]만.
6. 확정 기록: `ui.sectionTitle` "확정 기록" + `ui.card` 안 행마다 "시각(mono) · 확정 · 바뀐 칸 n칸 / 처음 확정". store의 확정본 버전 목록을 읽는다. 비교·복원 버튼은 두지 않는다.
7. 통계 표는 step 6과 같은 모양.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 최소 변경 재풀이·다시 확정·변경 취소·지난 날짜 고정 로직을 바꾸지 않았는가? 확정본 버전 비교·복원 UI를 넣지 않았는가(PRD MVP 제외)?
3. 수동 저니 체크리스트(`npm run dev`, 1440px, Anthropic·Supabase 키 필요, 운영 중 매장 시드):
   - 홈 [변경 입력] → 이 화면의 입력 바에 포커스가 있다. 홈 [열기] → 제목에 포커스.
   - "최지훈 이번 주 병가" 입력 → 카드 [적용] → 주황 테두리 칸 + 배너 "n명, n칸 변경". 오늘 이전 칸은 바뀌지 않고 자물쇠.
   - [변경 취소] → 배너 사라지고 마지막 확정본으로. [다시 확정] → 확정 기록에 행이 늘고 배너 사라짐.
   - 끝난 근무표를 열면 패널·편집 없이 [CSV 받기]만.
   - 화면에 Primary가 하나(변경 있을 때 [다시 확정]) 또는 없음.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 확정 기록 데이터 출처, e2e 영향)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 확정본 버전 비교·복원 화면을 만들지 마라. 이유: PRD MVP 제외.
- 재스케줄·확정 로직과 store 구조를 바꾸지 마라. 이유: 디자인 phase.
- `ScheduleStep.tsx`의 공유 컴포넌트 동작을 바꾸지 마라(선택적 prop만). 이유: step 6이 끝낸 범위.
- 기존 테스트를 깨뜨리지 마라.
