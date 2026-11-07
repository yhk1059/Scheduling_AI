# Step 8: availability-form

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "사용자와 디자인 요구 › 직원", "화면별 방향 › 직원 가능 시간 입력"
- `/docs/UI_GUIDE.md` — "화면 구조 › 직원 가능 시간 입력", "색상", "컴포넌트 › 워드마크 · 버튼", "타이포그래피", "접근성"
- `/docs/PRD.md` — "J2 › 직원 화면", "J8"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/components/AvailabilityForm.tsx`, `/app/a/[token]/page.tsx`
- `/lib/availability.ts` — `slotLabel`, `cellsFromSlots`, `slotsFromCells`, `applyDrag`
- `/e2e/test-helpers.ts` — `dragCells`, `submitAvailability`가 셀을 어떻게 찾는지

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 직원은 카톡 링크를 열어 1분 안에 드래그하고 나간다. 어느 매장의 어느 주인지가 먼저 보이고, 칠하는 동작이 분명해야 한다. 이 step은 화면을 두 열로 바꾸고 하단 고정 줄을 둔다. 드래그·제출·잠금 로직은 그대로다.

## 작업

1. `app/a/[token]/page.tsx`: `metadata.title` "가능 시간 입력"(template으로 "가능 시간 입력 · 말로").
2. `AvailabilityForm.tsx` 공통: 앱 상단 바·탭 없음. 맨 위 줄 `<Wordmark size="small" />` + "· 가능 시간 입력"(`text-[13px] text-[#66665E]`). `max-w-[1360px] px-10`.
3. 이름 고르기: 제목 "{매장 이름} · 가능 시간 입력"(`ui.pageTitle`) + 날짜 범위(mono) + "내 이름을 골라 주세요" → 이름 칩(`<button>` 높이 44 `rounded-full border border-[#C9C9C1] bg-white px-[18px] text-[15px] font-medium`, 제출한 이름 옆에 `제출함` 배지). 이미 제출한 이름 배너와 [이어서 고치기] [취소], 좁은 화면 안내는 그대로.
4. 입력: 제목 "{매장 이름} · {이름}님의 가능 시간"(`ui.pageTitle`) + 아래 한 줄 "{날짜 범위(mono)} 근무표예요. 일할 수 있는 시간을 드래그해서 칠해 주세요. 칠한 칸에서 시작하면 지워져요." + 오른쪽 [이름 다시 고르기] Text.
   - 두 열 `grid-cols-[1fr_260px] gap-5`. 왼쪽 캘린더는 `rounded-lg border border-[#E2E2DC] bg-white overflow-hidden` 상자: 머리 행 44px(요일 + 날짜, 토 청록·일/공휴일 빨강), 시각 열 56px(정시마다 mono 11), 칸은 `<button aria-pressed aria-label>` 그대로, 높이는 화면에 맞추되 최소 14 기본 16. 정시 줄 `border-t-[#E2E2DC]`, 반시 줄 더 옅게. 주말 열 바탕 `bg-[#F6F4EE]`, 칠한 칸 `bg-[#155E75]`. 드래그 중 선택 영역에 `ui.shadow`(가능하면). [이전 주] [다음 주]는 머리 행 위 오른쪽.
   - 오른쪽: "이번 주 칠한 시간" 카드(요일마다 "월 11/9 · 09:00~15:00", 없으면 "없음" 보조 색, 합계 시간. `slotsFromCells`로 계산) + "매장 근무조" 카드(코드·이름·시각, "근무조 시간을 다 덮어야 그 근무에 들어갈 수 있어요") + 안내 두 줄.
5. 하단 고정 줄: `sticky bottom-0 bg-white border-t border-[#E2E2DC] h-[72px]`. 왼쪽 개인정보처리방침 링크, 오른쪽 "{n}일 · {시간}시간 칠했어요" + [제출] `ui.primaryXl`(높이 48). 제출 뒤 "제출했어요. 이 링크로 다시 고칠 수 있어요"는 버튼 옆 `role="status"`.
6. 잠긴 뒤·토큰 오류 화면은 문구 그대로, 같은 워드마크 줄과 제목 규격.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 이 화면이 DB 함수(`get_availability_roster`, `get_availability`, `submit_availability`)만 부르고 store를 쓰지 않는가? 셀 `aria-label` 형식 "{M}월 {D}일 {시작}~{끝}"과 `aria-pressed`가 남아 있는가(e2e `dragCells`)?
3. 수동 저니 체크리스트(`npm run dev`, 1440px와 1280px, Supabase 키 + 작성 중 근무표의 링크):
   - 링크를 열면 워드마크 줄 → 매장 이름 제목 → 이름 칩. 제출한 이름에 배지.
   - 이름을 고르면 두 열 화면. 드래그로 칠하고 칠한 칸에서 드래그하면 지워진다. 오른쪽 요약이 바로 바뀐다.
   - 1280×720에서 캘린더가 세로 스크롤 없이 들어가고 하단 줄이 가려지지 않는다.
   - 키보드: Tab으로 칸에 가서 Space로 토글된다.
   - [제출] → 상태 문구. 잠긴 링크·틀린 토큰 화면이 문구대로 보인다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 칸 높이 계산 방식, e2e 영향)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 이 화면에서 store·Supabase 테이블 직접 접근을 쓰지 마라. 이유: CLAUDE.md CRITICAL(직원 링크는 토큰을 확인하는 DB 함수만).
- 본인 확인·미제출 경고·모바일 대응을 넣지 마라. 이유: PRD(ADR-021, MVP 제외).
- `lib/availability.ts`를 고치지 마라. 이유: 순수 함수는 그대로 쓴다.
- 기존 테스트를 깨뜨리지 마라.
