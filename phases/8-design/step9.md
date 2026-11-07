# Step 9: settings-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "결정 사항 › 범위"(이 화면들은 디자인 시스템만 따라간다)
- `/docs/UI_GUIDE.md` — "화면 구조 › 매장 준비 · 매장 설정", "컴포넌트 › 입력 필드 · 카드 · 반복 사용 컴포넌트 › 제외된 직원 · 대화상자", "색상 › 그림자", "타이포그래피"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/components/ShopSettings.tsx`, `/components/ShopSetup.tsx`, `/components/CoverageForm.tsx`, `/components/Dialog.tsx`, `/components/HolidayCalendar.tsx`
- `/components/RulesStep.tsx` — step 5가 바꾼 입력 바 패널([매장 조건] 탭이 그대로 쓴다)

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 매장 설정과 매장 준비는 시안에 없고, 디자인 시스템(토큰·타이포·카드 규격)만 따라간다. 이 step은 옛 규격 클래스를 새 토큰으로 바꾸고 대화상자에 그림자를 준다. 입력 동작과 저장 흐름은 그대로다.

## 작업

1. `ShopSetup.tsx`(매장 준비): 제목 "매장 준비"(`ui.pageTitle`), 본문 카드는 `ui.card`, [첫 근무표 시작하기] `ui.primaryLg`. 비활성 이유 한 줄은 버튼 옆.
2. `ShopSettings.tsx`: 제목(`ui.pageTitle`) + 탭 3개(step 1의 앱 탭과 같은 밑줄 스타일, `aria-current`). 각 탭의 섹션 제목은 `ui.sectionTitle`, 표·폼은 `ui.card` 안. "바꾼 내용은 바로 저장돼요" 보조 줄과 주기 변경 배너(`ui.banner`)는 그대로. [매장 조건] 탭은 `RulesStep`을 그대로 써서 step 5의 패널이 보인다.
3. `CoverageForm.tsx`, 명단 표, 근무 형태 표: 셀 입력 `ui.cell` 규격 유지, 레이블 `ui.label`, 오류 `ui.error`. 칩 입력(태그)은 `ui.chip`과 같은 모양.
4. `Dialog.tsx`: 본문 `rounded-xl` + `ui.shadow`, 제목 `ui.sectionTitle`, 버튼 줄 오른쪽 정렬, Primary 하나. 데이터 삭제 2단계와 포커스 처리는 그대로.
5. `HolidayCalendar.tsx`: 선택한 날 `bg-[#155E75] text-white`, 오늘 테두리, 나머지 무채색. 동작 그대로.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 저장 흐름(즉시 저장, 재시도)과 명단 규칙(최대 40명, 중복 이름 오류, 삭제 조건)을 바꾸지 않았는가? 대화상자의 `role="dialog"`·`aria-modal`·Esc·포커스 복귀가 남아 있는가?
3. 수동 저니 체크리스트(`npm run dev`, 1440px):
   - 매장 준비: 제목 28px, 명단 입력 줄에서 Enter로 추가, 직원 0명이면 버튼 비활성 + 이유.
   - 매장 설정 세 탭이 앱 탭과 같은 밑줄 스타일이다. [매장 조건]에 강조 패널 입력 바가 보인다.
   - 필요 인원 폼 오류 문구, 태그 칩, 근무 형태 표가 깨지지 않는다.
   - [내 매장 데이터 삭제] 대화상자에 그림자가 있고 Esc로 닫힌다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 설정 항목·검증 규칙·저장 흐름을 바꾸지 마라. 이유: 디자인 phase.
- `RulesStep.tsx`·`ConstraintCard.tsx`를 고치지 마라. 이유: step 5가 끝낸 범위.
- 옛 `ui` 키를 이 step에서 지우지 마라. 이유: step 10에서 사용처가 0인 키만 정리한다.
- 기존 테스트를 깨뜨리지 마라.
