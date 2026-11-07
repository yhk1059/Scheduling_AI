# Step 5: ui-period

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J2, J4, 핵심 기능 2·4·5)
- **`/docs/UI_GUIDE.md`** ("기간 작업", "스테퍼", "근무 셀", "반복 사용 컴포넌트"의 꺼진 카드·이월 근무 표, "상호작용 상태", "피드백과 오류", "문구", "접근성")
- `/lib/store.ts` (step 3: `WorkPeriod`, `toScheduleRequest`, 기간 액션), `/lib/period.ts`, `/lib/csv.ts`, `/lib/api.ts`
- `/components/AppShell.tsx`, `/components/WardHome.tsx`, `/components/Dialog.tsx` (step 4)
- `/components/ScheduleStep.tsx`, `/components/RulesStep.tsx`, `/components/ConstraintCard.tsx`, `/components/HolidayCalendar.tsx`, `/components/Stepper.tsx`, `/components/WardStep.tsx`(이월 붙여넣기 부분)

## 배경

기간 작업 화면을 UI_GUIDE "기간 작업"대로 만든다: 제목(날짜 범위 + 상태 배지), 제목 아래 스테퍼 ① 준비 → ② 요청 → ③ 근무표.
기간 길이는 7~31일이고 월 경계를 넘을 수 있다. 이 step은 단일 기간 작업 흐름(첫 기간 기준)을 완성한다. 이월 자동 채우기, 누적 부담 표시, 지난 날짜 잠금, [다시 확정]은 step 9에서 붙인다.

## 작업

### 1. 기간 작업 화면 (`components/PeriodWork.tsx`)
- 제목 위 "← 홈" Text 링크. 제목은 `formatRange`(`font-mono text-[22px] font-semibold`) + 상태 배지(초안 / 확정).
- 스테퍼(`components/Stepper.tsx` 개편): 제목 아래, 3단계. 지난 단계는 `<button>`으로 돌아갈 수 있고 아직 오지 않은 단계는 비활성. 단계를 옮기면 새 단계 제목(`h2`, `tabIndex={-1}`)으로 포커스를 옮긴다. 단계는 `view.step`에 저장한다.

### 2. ① 준비
- 날짜 범위(읽기 전용)와 기간 길이
- 공휴일 체크(`HolidayCalendar`를 기간 날짜 기준으로 개편: 월 경계를 넘으면 두 달에 걸쳐 그린다. 기간 밖 날짜는 비활성)
- 명단 요약 한 줄(활성 N명) + [병동 설정] Text — 지난 기간 대비 변동 요약은 step 9
- 이월 근무: 첫 기간용 붙여넣기 입력(기존 `parseCarryOver` 재사용). 선택 사항임을 표시한다.
- 오른쪽 아래 [다음] Primary → ②

### 3. ② 요청
- `RulesStep`을 scope `"period"`로 재사용: 자연어 입력 바(placeholder "예: 이영희 15~17일 휴가") + 요청 카드. translate 요청의 `context.period`는 이 기간, `today`는 실제 오늘.
- 이 기간에 적용될 병동 규칙을 접힌 목록으로 보여 주고, 각 카드에 [이번 기간만 끄기] Text를 둔다.
- **꺼진 규칙·요청 카드**(UI_GUIDE): 원문·해석 결과를 `text-[#66665E]`로, `이번 기간 꺼짐` 배지, [다시 켜기] Text. `setDisabled` 사용.
- [다음] Primary → ③

### 4. ③ 근무표 (`ScheduleStep.tsx` 개편)
- 요청 본문은 `toScheduleRequest(ward, period)`로 만든다.
- 그리드: `grid-cols-[150px_44px_repeat(N,30px)_repeat(4,34px)_repeat(2,44px)]`의 N = 기간 길이. 누적 부담 열 2개 자리는 step 9에서 채우므로 지금은 `—`로 둔다.
- 날짜 헤더: `dayHeader`(기간 첫날과 달의 1일은 `M/D`), 요일, 일요일·공휴일 빨강, 토요일 청록, 주말·공휴일 열 배경.
- 셀 `aria-label="{이름} {M}월 {D}일 {코드}"`의 M/D는 `periodDays`로 날짜마다 계산한다.
- 해 없음 패널, 제안 카드, [이번 기간만 끄기](충돌 제약), 수동 고정, 통계 표, 요약 지표는 기존 동작을 유지하되 store 액션을 기간 단위로 바꾼다(`applyChanges(periodId, …)`, `setFixed(periodId, …)`).
- [확정] → `confirm(periodId)`. 확정 후 상태 배지가 `확정`으로 바뀐다. 운영 중 변경 입력 바(기존 월중 변경)는 확정된 기간에서만 보이고, 문구를 "운영 중 변경"으로 바꾼다.
- [CSV 다운로드]: 파일명 `근무표-{start_date}_{end_date}.csv`. `toScheduleCsv`가 기간 날짜 헤더를 쓰는지 확인한다(step 1에서 바뀜).

### 5. 문구 정리
UI_GUIDE "문구" 표를 따른다: "이달", "이번 달", "전월 근무", "이달 요청"을 "이번 기간", "이월 근무", "요청"으로 바꾼다. `components/`와 `app/`(랜딩 `app/page.tsx`, `LandingPreview.tsx` 포함) 전체에서 검색해 남기지 않는다.

### 6. 정리
`AppShell`에서 기간 작업 화면을 `PeriodWork`로 교체하고, 더 이상 쓰지 않는 옛 단계 컴포넌트를 지운다.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
! grep -rnE "이달|이번 달|전월" components app   # 금지 용어 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 수동 확인(LLM 없이 가능한 범위): `npm run dev` → 샘플 → 병동 설정에서 기간 단위를 2주로 변경 → 홈 → [다음 기간 만들기] → ① 공휴일 체크(월 경계를 넘는 경우 포함) → ② 병동 규칙 하나 [이번 기간만 끄기] → [다시 켜기] → ③ 생성 → 14열 그리드와 `M/1` 헤더 확인 → 셀 고정 → 확정 → CSV 파일명. 확인 후 서버를 종료한다.
3. UI_GUIDE 체크: 셀 30px 미만 금지, 근무표는 `overflow-x-auto` 상자, 스테퍼 포커스 이동, 진행 중 "푸는 중…"과 버튼 비활성.
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 이월 자동 계산, 누적 부담, 지난 날짜 잠금, 버전 기록을 넣지 마라. 이유: step 7~9의 범위다.
- [이번 기간만 끄기]로 병동 규칙 원본을 고치지 마라. 이유: 꺼짐은 그 기간에만 있다(ARCHITECTURE "제약 단일 표현").
- 셀을 30px보다 작게 하거나 표를 축소하지 마라. 이유: UI_GUIDE 레이아웃 규칙. 31일 기간은 가로 스크롤로 본다.
- 차트·표 라이브러리를 추가하지 마라. 이유: 기술 스택 금지 목록.
- 기존 테스트를 깨뜨리지 마라.
