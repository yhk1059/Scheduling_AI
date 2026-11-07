# Step 11: ui-cards

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/docs/UI_GUIDE.md`** ("규칙·요청 카드"의 해석 결과·조정 가능한 값·예시 판정, "제안 카드", "근무 셀", "근무 코드", "접근성", "문구")
- `/docs/PRD.md` (J1 ③ 카드, J2 해가 없을 때, 핵심 기능 1·3)
- `/notes/expression-rules-design-2026-10-30.md` (§1 ★6·★7, §4.2, §5, §6)
- `/lib/store.ts`, `/lib/wording.ts` (step 9: `describeRule`의 parts, `setRuleValue`, `setRequestValue`, 카드 `examples`, `applyChanges`)
- `/components/ConstraintCard.tsx`, `/components/RulesStep.tsx`, `/components/PeriodWork.tsx`, `/components/ScheduleStep.tsx`, `/components/ConfirmedPeriod.tsx`, `/components/SampleDemo.tsx`

## 배경

결정 ★6·★7: 사용자가 **식의 의미를 확인**하는 곳은 카드다. 해석 결과는 식에서 결정적으로 만든 문장이고, 조정 가능한 값은 밑줄로 보이며 [수정]으로 고친다. 서버가 찾은 위반 사례를 예시 판정 띠로 보여 준다. 해 없음 제안은 "최대 연속 나이트 3 → 4"처럼 값·끄기·가능하면 바꾸기로 읽힌다.

## 작업

UI 컴포넌트는 TDD 대상이 아니다. build·lint·수동 저니로 검증한다.

### 1. 해석 결과와 조정 가능한 값 (`ConstraintCard.tsx`)
- 제목 = `presetName`, 해석 결과 = `describeRule().parts`. 값 부분은 `underline decoration-dotted underline-offset-2`(UI_GUIDE).
- [수정]: 카드 안에 값마다 label + 숫자 입력이 펼쳐지고 [저장] / [취소]. 병동 규칙은 `setRuleValue`, 기간 요청은 `setRequestValue`. 값이 없는 규칙(휴가 등)은 지금처럼 날짜 수정만. 식 구조는 고치지 않는다는 안내 한 줄 "바꾸려면 말로 다시 적어 주세요".
- 기존 수정 폼(수·날짜)은 값 수정으로 대체되는 범위에서 정리한다(휴가 날짜 수정은 유지).

### 2. 예시 판정 띠
- 해석 결과 아래 "이런 근무면 이 규칙에 어긋나요" 한 줄 + `RuleExample`마다 작은 근무 띠: 간호사 이름(명단에서) + `days`의 근무 셀(UI_GUIDE "근무 셀" 크기 축소판), `marks` 칸은 `ring-1 ring-[#B42318]`, 아래 `detail` 한 줄(`text-xs`).
- 대기 카드는 펼쳐 두고, 적용된 카드는 [예시 보기] Text(`aria-expanded`)로 접는다. 예시가 없으면 영역을 숨긴다.
- 접근성: 띠는 표(`role="table"` 또는 실제 `<table>`)이고 어긋난 칸은 `aria-label`에 "어긋남"을 포함.

### 3. 제안 카드 (`ScheduleStep.tsx`)
- 설명 한 줄을 변경 종류로: `set_value` → "{label} {이전} → {새 값}", `disable` → "이번 근무표에서만 끄기", `set_hardness` → "반드시 → 가능하면". 검증 결과 줄은 그대로.
- [수락]은 step 9의 `applyChanges`.

### 4. 그 밖
- 근무표 작성 ①의 "이 근무표에 적용되는 병동 규칙" 접힌 목록, 확정 근무표의 변경 카드, 샘플 데모(`SampleDemo.tsx`)의 규칙 카드도 `describeRule`로 보이게 한다(데모는 보기 전용, 예시 띠 없음).

### 5. 동작 확인 (수동 저니, 임시 Playwright 가능·커밋하지 않음)
1. 병동 규칙 "나이트는 3번까지만 연속" → 카드 문장에 밑줄 "3" → 예시 띠 1개 이상 → [적용] → [수정]에서 4로 저장 → 문장 갱신.
2. "신규가 나이트면 책임도 나이트에 1명"(태그 신규·책임 간호사 준비) → 조건 규칙 카드, 예시 띠.
3. 휴가 2건을 더해 해 없음 → 제안 카드 문구가 값 변경 꼴 → [수락] → 해결.
콘솔 오류·API 오류가 없어야 한다.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행하고, 위 수동 저니를 `npm run dev`로 확인한다. 3000/8000 포트를 다른 작업 트리가 쓰고 있으면 남의 프로세스를 끄지 말고, 수동 저니는 건너뛰었다고 summary에 적는다. 실제 Anthropic API를 쓴다(`.env.local`).
2. 아키텍처 체크: 카드 해석 결과에 LLM 문장을 쓰지 않는가? UI_GUIDE 색·컴포넌트·접근성 규칙을 지켰는가? 내부 id·코드만 있는 표기가 화면에 나오지 않는가?
3. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(카드 구성, 접근성 이름, 수동 저니 결과, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. UI_GUIDE에 없는 세부는 기존 컴포넌트 모양을 따르고 summary에 `결정: …`으로 적는다.

## 금지사항

- 카드에서 식 구조(범위·셀렉터·조건)를 고치는 UI를 만들지 마라. 이유: 결정 ★7, 구조 변경은 말로 다시 입력한다.
- 예시를 클라이언트에서 계산하거나 LLM에 요청하지 마라. 이유: 예시는 서버의 결정적 평가 결과다(ADR-019).
- 테스트 전용 속성(`data-testid` 등)을 넣지 마라.
- 기존 테스트를 깨뜨리지 마라.
