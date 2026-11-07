# Step 4: shop-home

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "화면별 방향 › 매장 홈"
- `/docs/UI_GUIDE.md` — "화면 구조 › 매장 홈", "컴포넌트 › 카드 › 강조 바탕 패널 · 스테퍼 · 배지", "타이포그래피"
- `/docs/PRD.md` — "J2 › 다음 근무표", "J4"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/components/ShopHome.tsx` — `confirmedTime`, 지금의 홈
- `/lib/wording.ts` — `nextTask`, `TASK_STEPS`, `taskDoneSteps`, `scheduleName`
- `/lib/stats.ts` — `statsFromAssignments`
- `/lib/store.ts` — `WorkPeriod`, 확정본·제출 현황이 어디에 있는지
- `/components/PeriodWork.tsx` — 직원 링크 표와 제출 현황을 어떻게 읽는지(같은 데이터를 홈 카드에 쓴다)

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 홈은 "지금 할 일"을 먼저 보여 주는 화면이다. 지금은 카드 세 개가 같은 무게라 할 일이 튀지 않는다. 이 step은 지금 할 일 카드를 강조 바탕 패널로 키우고 직원 링크 카드를 옆에 붙이며, 지난 근무표 표에 열을 더한다.

## 작업

1. 제목 줄: 매장 이름(`ui.pageTitle`) + 오른쪽 "직원 12명 · 매장 조건 6개 · 1주 단위"(`text-[13px] text-[#66665E]`) + [매장 설정] Text. 조건 수는 `shopRuleCount`.
2. 운영 중 카드(있을 때만): 얇은 카드(`px-5 py-3.5`) 한 줄에 `운영 중` 배지 · 근무표 이름(16px 링크, 누르면 확정 근무표 열기) · 날짜 범위(mono 보조) · "마지막 확정 11/1 18:20" · 오른쪽 [변경 입력] `ui.secondary`.
3. 지금 할 일 카드: `ui.panel` + `px-8 py-7 grid-cols-[1fr_320px] gap-8`. 왼쪽: `ui.eyebrow` "지금 할 일" → 문장(`text-[22px] font-semibold`, UI_GUIDE 표의 상태별 문장 앞에 근무표 이름을 붙인다. 예: "11/9~11/15 근무표 · 직원 링크를 공유하고 조건을 확인하세요") → 보조 한 줄(작성 중이면 "아직 근무표를 만들지 않았어요. 12명 중 7명이 가능 시간을 제출했어요.") → 단계 줄(TASK_STEPS, 완료는 체크, 현재는 청록 원, 미래는 테두리 원; `Stepper`를 쓸 수 없으면 같은 모양으로 직접 그린다, 누를 수 없음) → 버튼 하나 `ui.primaryLg`. 오른쪽 320px: 작성 중일 때만 직원 링크 카드("직원 링크" + [링크 복사] 작은 Secondary, 링크 mono 말줄임, "{제출} / {전체}명 제출" + [새로고침] Text, 진행 막대 `h-1.5 rounded bg-[#E2E2DC]` 안 `bg-[#155E75]`, "미제출: 이름…"). 링크·제출 현황은 `PeriodWork`가 쓰는 것과 같은 store 데이터와 복사 동작을 쓴다(함수를 공유할 수 있으면 `lib/`로 올리지 말고 `PeriodWork`에서 export해 import한다). 확정 상태일 때는 오른쪽 열을 비우고 패널을 한 열로 둔다.
4. 지난 근무표 표: `ui.card` 안 `<table>`. 열은 근무표(이름, `font-medium`) · 기간(mono) · 확정(시각 mono, 다시 확정했으면 "· n번 다시 확정") · 마감 횟수 차이(mono "min ~ max") · [열기 →] 링크. 행 hover `bg-[#F6F6F3]`. 비어 있으면 "확정한 근무표가 여기에 쌓여요" 한 줄.
   - 마감 횟수 차이: `lib/stats.ts`에 순수 함수를 **테스트 먼저** 더한다.
     ```ts
     export function closingSpread(assignments: Record<string, Code[]>, config: ShopConfig, activeIds: string[]): { min: number; max: number } | null
     ```
     세는 근무조가 마감(C)인 코드를 센다(복합 코드는 parts로). 활성 직원이 없으면 null. 확정본 배정은 `WorkPeriod`의 확정 결과에서 읽는다.
5. 홈 안의 Primary는 지금 할 일 버튼 하나뿐이어야 한다(확정 상태면 [다음 근무표 만들기]가 Primary, [열기]는 Secondary).

## Acceptance Criteria

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `lib/stats.test.ts`에 `closingSpread` 테스트가 있어야 한다.
2. 아키텍처 체크: 홈에서 새 데이터 요청·저장을 추가하지 않았는가? `lib/stats.ts` 외 `lib/`를 고치지 않았는가?
3. 수동 저니 체크리스트(`npm run dev`, 1440px, 테스트 매장은 `npm run seed`나 `docs/BROWSER_TEST_SCENARIOS.md`의 시드):
   - 작성 중 상태: 강조 패널에 문장·단계·버튼, 오른쪽에 링크 카드. [링크 복사]가 "복사했어요"로 바뀐다. [새로고침]이 제출 수를 갱신한다.
   - 확정 상태: 패널 한 열, [다음 근무표 만들기] Primary, [열기] Secondary.
   - 운영 중 근무표가 있으면 얇은 카드가 패널 위에 있고 [변경 입력]이 확정 근무표의 변경 입력 바에 포커스를 둔다.
   - 지난 근무표 표의 마감 횟수 차이가 확정 근무표의 통계 표와 맞는다.
   - 화면에 Primary 버튼이 하나다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, closingSpread 시그니처, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 홈에 새 상태·저장·API 호출을 넣지 마라. 이유: 디자인 phase. 데이터는 store에 이미 있는 것만 쓴다.
- `PeriodWork.tsx`의 ① 화면 본문을 고치지 마라(export 추가만). 이유: step 6의 범위.
- 미제출 경고·독촉을 넣지 마라. 이유: PRD J2 "직원은 모두 제출한다고 가정한다".
- 기존 테스트를 깨뜨리지 마라.
