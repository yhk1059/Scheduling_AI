# Step 6: schedule-step

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "화면별 방향 › 근무표 작성 ③"
- `/docs/UI_GUIDE.md` — "화면 구조 › 근무표 작성"(①②③ 전부와 "③ 근무표의 버튼" 표), "컴포넌트 › 근무 셀 · 요약 지표 · 제안 카드 · 반복 사용 컴포넌트 › 지난 근무 마지막 며칠 표 · 최근 4주 부담 · 배너", "타이포그래피"
- `/docs/PRD.md` — "J2"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/components/PeriodWork.tsx` — 제목·스테퍼·① 가능 시간(준비 요약, 링크 카드)
- `/components/ScheduleStep.tsx` — ③ 전체(`ScheduleBody`, `OutcomePanel`, `SummaryCard`, `ScheduleGrid`, `StatsTable`, `useSolve`)
- `/components/ShiftTable.tsx`
- `/components/ConstraintCard.tsx`, `/components/RulesStep.tsx` — step 5가 바꾼 카드·입력 바 모양(③ 예외 입력도 같은 모양)
- `/components/ShopHome.tsx` — step 4가 홈 링크 카드를 어떻게 그렸는지(①의 링크 카드와 모양을 맞춘다)
- `/e2e/test-helpers.ts` — `scheduleTitle`, `readGrid`, `dragCells`, `primaryButtons`, `readHistoryColumns`가 ③을 어떻게 읽는지

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 근무표 작성은 반복 사용의 핵심 화면이다. 이 step은 ③의 순서를 "예외 입력 패널 → 지표 + 안내 → 근무표 → 버튼 줄 → 통계"로 바꾸고, 제목 줄과 ①의 카드를 새 토큰으로 맞춘다. 솔버 호출, 고정, 재풀이, 확정 흐름은 그대로다.

## 작업

1. `PeriodWork.tsx` 제목 줄: "← 근무표 목록" Text → 근무표 이름(`ui.pageTitle`) + 날짜 범위(mono 14 보조) + `작성 중` 배지 → 스테퍼(step 1이 바꾼 `Stepper`).
   - ① 준비 요약 카드와 직원 링크 카드를 `ui.card` 규격으로 맞춘다. 링크 카드는 홈의 링크 카드와 같은 모양(링크 mono, [링크 복사], 제출 수 + 진행 막대, 미제출 이름, [새로고침]). 내용·동작은 그대로.
2. `ScheduleStep.tsx` ③ 순서:
   1. 예외 입력 패널: `ui.panel` + `grid-cols-[7fr_5fr] gap-6`. 왼쪽 제목 "이번 근무표에만 적용할 예외가 있나요?" + 설명 "휴가, 희망, 기피를 말로 적어요. 가능 시간에 이미 있는 내용은 다시 적지 않아도 돼요." + `ui.bar`(마크 + 입력 + [요청 만들기] `ui.primaryBar`). 오른쪽에 요청 카드 목록(답장 형태, 작은 변형). 더는 접지 않는다. 지난 근무 변경 배너·가능 시간 변경 배너는 패널 위.
   2. 요약 지표(`SummaryCard`, 왼쪽) + "칸을 누르면 바꿀 수 있어요. 🔒 고정한 칸은 다시 만들 때 그대로 둬요"(오른쪽, 근무표가 있을 때만). 지표에 "최근 4주 마감 배려" 칸을 더한다(기록이 없으면 칸 없음). 만들기 전에는 지표 대신 설명 한 줄 "가능 시간과 매장 조건으로 근무표를 만들어요" + [근무표 만들기] `ui.primaryLg`.
   3. 근무표 카드: `ScheduleGrid` + 합계 행. 날짜 헤더는 두 줄(날짜 mono 11 / 요일), 첫 날과 1일은 `M/D`. 토 `text-[#155E75]` 일·공휴일 `text-[#B42318]`. 최근 4주 열 머리는 "최근 4주\n마감" 두 줄.
   4. 버튼 줄: 왼쪽 [이전] `ui.secondary`. 오른쪽 [CSV 받기] Text · [다시 만들기] `ui.secondary` · [확정] `ui.primaryLg`. 가능 시간이 바뀌어 확정이 비활성이면 버튼 옆 한 줄로 이유.
   5. 통계 표: `ui.sectionTitle` "개인별 통계" + 오른쪽 보조 "“왜 나만 주말이 많아요?”에 보여 줄 근거예요." → `ui.card` 안 `StatsTable`(열 이름 UI_GUIDE "문구" 표대로, 숫자 mono 오른쪽 정렬, 평균보다 많은 근무일이 +면 `text-[#A15C07]`).
   - 해 없음이면 근무표 자리에 `OutcomePanel`(테두리 `border-[#E8B4AE]`, `근무표 없음` 배지, 함께 지킬 수 없는 규칙 목록, 제안 카드는 UI_GUIDE "제안 카드" 규격: 제목 + `검증됨` + 바꾸는 것 + 검증 결과 + [무시] Text [수락] Primary).
3. `ShiftTable.tsx`: 셀 규격·헤더를 2와 같은 스타일로(지난 근무 마지막 며칠 표가 이 컴포넌트를 쓰면 함께 바뀐다). 편집 불가 셀은 `<div>` 그대로.
4. 근무 셀(`CELL`, `codeClass`)은 UI_GUIDE "근무 셀"과 같은지 확인하고 다르면 맞춘다. 고정 자물쇠는 SVG, 변경은 `shadow-[inset_0_0_0_2px_#D97706]`, 선택은 outline.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `useSolve`·확정·링크 잠금·CSV 로직을 바꾸지 않았는가? 셀 `button`의 `aria-label` 형식("{이름} {M}월 {D}일 {코드}")과 ③ 제목 `h2`(`tabIndex={-1}`, 글자 "근무표")가 남아 있는가(e2e `scheduleTitle`·`readGrid`가 쓴다)?
3. 수동 저니 체크리스트(`npm run dev`, 1440px, Anthropic·Supabase 키 필요):
   - ① 준비 요약·링크 카드가 홈 카드와 같은 모양이고 [링크 복사]가 동작한다.
   - ③ 만들기 전: 패널 → 설명 + [근무표 만들기]. 만든 뒤: 패널 → 지표(배려 칸 포함) → 근무표 → 버튼 줄 → 통계 순서.
   - 예외 입력 "이영희 12일 휴가" → 오른쪽에 휴가 카드(토글 없음, `반드시` 배지).
   - 칸 클릭 → outline, 고정 → 자물쇠, [다시 만들기] → 고정 유지. 해 없음 → 패널과 제안 카드, [수락] → 재풀이.
   - [확정] → 확정 근무표로 이동. 화면에 Primary가 하나다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 바뀐 DOM 구조 중 e2e에 영향 줄 수 있는 것, 지표 배려 칸의 데이터 출처)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 솔버 요청·응답 처리, 확정·잠금 순서, 가능 시간 다시 읽기를 바꾸지 마라. 이유: 7-availability에서 정한 안전 장치다(ADR-020·021).
- 셀을 30px보다 작게 하거나 표를 줄이지 마라. 이유: UI_GUIDE "레이아웃".
- `ConfirmedPeriod.tsx`를 고치지 마라. 이유: step 7의 범위. 공유 컴포넌트(`SummaryCard`, `ScheduleGrid`)의 prop 추가는 선택적이어야 한다.
- 기존 테스트를 깨뜨리지 마라.
