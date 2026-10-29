# Step 9: ui-cards-period

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/docs/UI_GUIDE.md`** ("규칙·요청 카드", "제안 카드", "근무표 작성"의 준비 요약·날짜, "근무 셀", "근무 코드", "반복 사용 컴포넌트", "문구")
- `/docs/PRD.md` (J1 ③, J2, J3, 핵심 기능 1·2·5)
- `/notes/structure-blocks-design-2026-10-29.md` (§5.3, §6, §8, ★12)
- `/lib/store.ts`, `/lib/wording.ts`, `/lib/stats.ts`, `/lib/period.ts` (step 7)
- `/components/ConstraintCard.tsx`, `/components/RulesStep.tsx`, `/components/PeriodWork.tsx`, `/components/ScheduleStep.tsx`, `/components/ConfirmedPeriod.tsx`, `/components/WardHome.tsx`

## 배경

병동 쪽 화면은 step 8에서 열었다. 이 step은 **규칙 카드와 근무표 화면**을 블록·병동 구조에 맞춘다: 프리셋 제목과 문장, 중요도, 설정 변경 카드와 딸린 카드, 시작일 선택·미루기, 근무 코드 수만큼 늘어나는 그리드·통계, 변환 전 확정본 표시.

## 작업

### 1. 규칙·요청 카드 (`ConstraintCard.tsx`, `RulesStep.tsx`)
- 제목 = `presetName`, 해석 결과 = `describeBlock`(UI_GUIDE 문장 틀). 내부 id·코드만 있는 표기 금지.
- 반드시/가능하면 토글 옆에, 가능하면일 때 중요도 select(높음·보통·낮음). 휴가 프리셋은 토글을 숨긴다.
- 설정 변경 카드: `근무 형태` 배지, "근무 코드 추가 · M 미드 · 8시간". 딸린 규칙 카드는 바로 아래 `pl-4`, [적용] 옆 "근무 코드 M 추가가 함께 적용돼요". 삭제 연동(store 동작은 step 7).
- [모두 적용]은 설정 카드를 먼저 적용한다.

### 2. 근무표 작성 ① 준비 요약 (`PeriodWork.tsx`)
- 첫 근무표: 날짜 칸에 시작일 date 입력(기본값 제안, 달력 월은 1~28일만 고를 수 있게 막음) + 끝 날짜(mono, 읽기 전용).
- 다음 근무표: 날짜는 읽기 전용 + [시작일 미루기] Text → date 입력(직전 끝 다음 날 이후만). 미루면 "지난 근무표와 이어지지 않아서 지난 근무를 직접 입력해요" 한 줄과 붙여넣기 입력.
- 근무표 이름: 달력 월이 1일 시작이 아니면 "11/15~12/14 근무표"(`scheduleName`).

### 3. 근무표·통계 (`ScheduleStep.tsx`, `ConfirmedPeriod.tsx`)
- 그리드: 합계 열 = 활성 코드 수(K), 하단 합계 = 근무조별(복합 코드는 parts마다). 기본 4개 밖 코드는 UI_GUIDE "그 밖의 코드" 스타일, 3자 코드는 `text-[11px]`. 셀 `aria-label`은 코드 이름.
- 칸 수정 선택지는 활성 코드 목록.
- 통계 표: 코드별 수 + 근무 시간 열. 최근 4주 열은 `history` 원본에서 계산한 숫자.
- 변환 전 확정본(옛 결과 형식)은 `statsFromAssignments`로 통계를 다시 세고, 희망 반영률·못 지킨 규칙은 숨기고 "변환 전에 확정한 근무표" 한 줄(설계 ★12).
- 해 없음 패널·제안 카드: 블록 문장으로 표시.

### 4. 홈 (`WardHome.tsx`)
- 첫 근무표 만들기 진입이 시작일을 고를 수 있는 ① 준비로 이어지는지 확인한다(새 버튼을 만들지 않는다).

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
! grep -rnE 'TEMPLATE_NAMES|describeParams|"D", "E", "N", "O"' components app
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(마지막 줄: 옛 템플릿 문구 함수와 하드코딩된 코드 목록이 화면 코드에 남지 않았는지. 기본 config의 색 표는 예외로 두어도 된다).
2. 동작 확인: `npm run dev` → 처음 설정에서 규칙 "미드 근무 M 11시~19시 추가하고 평일 미드는 1명"을 입력 → 설정 카드 + 딸린 카드 → 딸린 카드 [적용] → 근무 형태에 M이 생기는지 → 첫 근무표 시작일을 15일로 → 근무표 만들기 → 그리드에 M 열·합계 → 확정 → 다음 근무표의 [시작일 미루기]를 Playwright 스크립트(임시, 커밋하지 않음)나 브라우저로 확인하고 서버를 끈다(실제 API 사용). 다른 프로세스가 3000/8000 포트를 쓰면 건너뛰고 summary에 적는다.
3. UI_GUIDE 체크: 영역마다 Primary 하나, 배너 버튼 최대 하나, 색만으로 구분하지 않음, 문구 표.
4. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. UI_GUIDE에 없는 세부는 멈추지 말고 가까운 기존 패턴으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 샘플 데모(`/demo`), 랜딩, `lib/samples/`를 바꾸지 마라. 이유: step 10의 범위다.
- 새 npm 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
