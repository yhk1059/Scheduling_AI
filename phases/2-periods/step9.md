# Step 9: ui-continuity

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J3, J4, J5, 데모 저니 8·9)
- **`/docs/UI_GUIDE.md`** ("병동 홈", "기간 작업"의 ① 준비, "근무 셀"의 지난 날짜, "반복 사용 컴포넌트"의 이월 근무 표·누적 부담 근거·배너, "문구")
- `/lib/store.ts` (step 8: `toScheduleRequest`, `carryOverChanged`, `hasUnconfirmedChanges`, `homeSummary`, `rosterChangesFor`, `confirm`)
- `/lib/continuity.ts` (step 7: `isOperating`, `pastDayLocks`, `historyLoadFor`)
- `/components/WardHome.tsx`, `/components/PeriodWork.tsx`, `/components/ScheduleStep.tsx`, `/components/AppShell.tsx` (step 4~5)

## 배경

step 7~8에서 만든 기간 연속성을 화면에 드러낸다. 이 step이 끝나면 게스트 모드에서 "첫 기간 확정 → 운영 중 변경 → 다음 기간 만들기 → 이월·누적 부담 근거 확인"이 끝까지 된다(데모 저니 8·9).

## 작업

### 1. 병동 홈 완성 (`WardHome.tsx`)
UI_GUIDE "병동 홈" 순서대로 `homeSummary(periods, today)`를 쓴다.
1. **운영 중 기간 카드**: 날짜 범위(mono), `운영 중` 배지, 마지막 확정 시각(최신 버전 `confirmed_at`, mono), [열기] Secondary. 없으면 카드를 그리지 않는다.
2. **다음 기간 카드**: 없음 → [다음 기간 만들기] Primary(홈의 유일한 Primary) / 초안 → [이어서 작성] Secondary / 확정 → [열기] Secondary. 기간이 하나도 없으면 [첫 기간 만들기].
3. **최근 기간 표**: 기간, 상태 배지, 확정 시각. 행 클릭 → 그 기간.
4. **병동 요약 한 줄**(step 4 그대로).

### 2. ① 준비 (`PeriodWork.tsx`)
- **명단 점검**: `rosterChangesFor` 결과로 "지난 기간 이후 추가 2명 · 비활성 1명"과 이름 목록. 변동이 없으면 "지난 기간과 명단이 같아요". + [병동 설정] Text.
- **이월 근무 표**: 지난 확정본이 있으면 근무 셀 그리드를 재사용한 읽기 전용 표(`<div>` 셀, 편집 불가). 열은 지난 기간 마지막 날들(날짜 헤더 `M/D`). 표 위에 "지난 기간 확정본에서 가져왔어요". 지난 확정본이 없으면 step 5의 붙여넣기 입력을 그대로 보여 준다.
- **이월 변경 배너**: `carryOverChanged`가 true면 주의 배너 "지난 기간이 바뀌어 이월이 달라졌어요. 다시 생성하면 반영돼요" + [근무표로] 버튼 하나. ③ 근무표 상단에도 같은 배너를 보여 준다.

### 3. ③ 근무표 (`ScheduleStep.tsx`)
- **누적 부담 열 2개**: 그리드 오른쪽 끝 열(step 5에서 `—`로 둔 자리)에 간호사별 최근 4주 N, 주말(mono). 값은 요청에 보낸 `history_load`에서 가져오고, 없으면 0.
- 통계 표에도 같은 두 열("최근 4주 N", "최근 4주 주말")을 더한다.
- **누적 부담 근거 한 줄**(요약 지표 아래): 최근 4주 나이트가 평균보다 많았던 간호사 중 이번 기간 N이 평균 이하인 사람 수로 "최근 4주 나이트가 많았던 3명은 이번 기간 나이트를 줄였어요". 한 명이면 "지난 4주 나이트 6회 → 이번 기간 2회"처럼 이름과 숫자로. 해당자가 없거나 history가 비면 쓰지 않는다. 계산은 컴포넌트 안 작은 함수로 둔다.
- **지난 날짜**: 운영 중인 기간에서 오늘 이전 칸은 자물쇠 SVG를 보이고 눌러도 편집 메뉴가 열리지 않는다(`aria-disabled`). 오늘 열 머리에 `border-b-2 border-[#155E75]` 밑줄.
- **운영 중 변경**: 확정된 기간에서 운영 중 변경 입력 바 → 재풀이(최소 변경, 지난 날짜는 잠금) → 변경 칸 하이라이트 → `hasUnconfirmedChanges`면 [다시 확정] Primary 활성. 누르면 버전이 쌓이고 "마지막 확정 14:32"(mono)가 갱신된다.
- `setResult`에 그 요청의 `carry_over`를 함께 넘긴다(step 8 시그니처).

### 4. 문구
UI_GUIDE "문구" 표를 지킨다(기간, 이월 근무, 초안/확정, 다시 확정). 토스트를 쓰지 않고 결과는 그 자리에 보여 준다.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 수동 확인(LLM 없이): `npm run dev` → 샘플 → 병동 설정에서 기간 단위 1주 → 홈 → 첫 기간 만들기 → ③ 생성 → 확정 → 홈에서 [다음 기간 만들기] → ① 이월 표가 지난 기간 마지막 7일로 채워짐 → ③ 생성 → 누적 부담 열과 근거 한 줄 확인 → 첫 기간으로 돌아가 칸 하나 고정 후 재풀이 → [다시 확정] → 다음 기간에서 이월 변경 배너 확인. 지난 날짜 잠금은 브라우저 개발자 도구에서 시계를 바꾸거나, 첫 기간이 오늘을 포함하도록 만들어 확인한다. 확인 후 서버를 종료한다.
3. UI_GUIDE 체크: 홈의 Primary는 하나, 배너 버튼 최대 하나, 이월 표 셀은 편집 불가 `<div>`, 색만으로 구분하지 않음(자물쇠·테두리).
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 버전 목록, 버전 비교, 복원 화면을 만들지 마라. 이유: PRD MVP 제외 사항. 마지막 확정 시각만 보여 준다.
- 근거 문장을 LLM으로 만들지 마라. 이유: PRD MVP 제외 사항(LLM 요약 문장). 숫자로 결정적으로 만든다.
- 이월 표를 편집 가능하게 만들지 마라. 이유: 이월은 지난 확정본에서 온다. 바꾸려면 지난 기간을 고친다.
- 로그인·저장 관련 UI를 넣지 마라. 이유: step 13의 범위다.
- 기존 테스트를 깨뜨리지 마라.
