# Step 2: wording-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/docs/UI_GUIDE.md`** ("문구" 전체, "근무표 이름", "병동 홈"의 지금 할 일 카드 표, "규칙·요청 카드", "요약 지표", "반복 사용 컴포넌트")
- `/docs/PRD.md` ("화면"의 데이터 용어와 화면 문구 구분)
- `/components/ConstraintCard.tsx` (`TEMPLATE_NAMES`, `describeParams`, `dayRanges`, `formatDays`, `nurseLabel`)
- `/lib/period.ts` (`monthDay`, `formatRange`, `unitLabel`, `PeriodUnit`)
- `/lib/store.ts` (`Ward`, `WorkPeriod`, `homeSummary`, `hasUnconfirmedChanges`)
- `/components/WardHome.tsx`, `/components/ScheduleStep.tsx` (지금 문구가 어떻게 만들어지는지)

## 배경

UX 점검에서 화면에 개발 용어(기간, 초안, hard/soft, 해 있음, n01, `N 뒤 O 1일`, 평균 대비 편차 -0.40)가 그대로 보여 수간호사가 이해하지 못했다. UI_GUIDE "문구" 표가 새 화면 문구를 정했다.
여러 화면이 같은 문구를 쓰므로, **화면 문구를 만드는 순수 함수를 `lib/wording.ts`에 모으고 테스트한다.** 컴포넌트에 적용하는 것은 step 4~6이다. 이 step에서는 함수와 테스트를 만들고, 기존 `describeParams`만 새 함수로 옮긴다.

## 작업

**`lib/wording.test.ts`를 먼저 쓴다(TDD).** 시그니처는 방향이며 이름과 인자는 조정해도 된다.

```ts
/** "11월 근무표"(달력 월) / "11/2~11/15 근무표"(주 단위). 월 경계를 넘는 주 단위도 처리 */
export function scheduleName(period: PeriodRange, unit: PeriodUnit): string;
/** 근무표 주기 select 레이블: month → "한 달(1일~말일)", 1주/2주/4주 */
export function unitName(unit: PeriodUnit): string;
/** 상단 바·홈 요약용 짧은 이름: "한 달 단위", "2주 단위" */
export function unitShort(unit: PeriodUnit): string;

/** 템플릿 이름(카드 제목). 예: off_after_night_block → "나이트 다음 휴무", min_days_off → "최소 휴무 일수" */
export const TEMPLATE_NAMES: Record<ConstraintSpec["type"], string>;
/** "반드시" | "가능하면" */
export function hardnessLabel(h: "hard" | "soft"): string;
/** 카드 해석 결과 한 줄. 내부 id(n01)와 코드만 있는 표기를 쓰지 않는다 */
export function describeParams(c: ConstraintSpec, nurses: Nurse[], period: Period): string;

/** 병동 규칙 수. 필요 인원(daily_coverage)은 세지 않는다. 모든 화면이 이 함수를 쓴다 */
export function wardRuleCount(rules: ConstraintSpec[]): number;
/** 평균 대비 근무일: 2.6 → "+3일", -0.4 → "0일", -1.6 → "−2일" (정수 반올림, 0은 부호 없음) */
export function formatDeviation(d: number): string;

/** 홈 "지금 할 일" 카드 상태 */
export type NextTask =
  | { kind: "none"; name: string }                       // "12월 근무표를 만들 차례예요" / [12월 근무표 만들기]
  | { kind: "drafting"; name: string; requests: number } // 생성 전
  | { kind: "generated"; name: string }                  // 생성 후, 확정 전
  | { kind: "confirmed"; name: string; confirmedAt: string };
export function nextTask(ward: Ward, periods: WorkPeriod[], today: string): NextTask;
```

### 규칙
- `describeParams` 예(UI_GUIDE "규칙·요청 카드"):
  - leave → "이영희 · 11/15~11/17 · 휴무"
  - shift_preference → "박민수 · 주말·공휴일 · 나이트 피하기", "정유진 · 11/20 · 데이 희망"
  - off_after_night_block → "나이트 다음 날은 휴무 1일", max_consecutive_nights → "나이트 연속 3일까지"
  - daily_coverage → "데이 · 평일 · 3~4명"
  - 명단에 없는 간호사는 "(명단에 없는 간호사)"
  - 근무 코드는 문장 안에서 데이/이브닝/나이트/휴무로 쓴다.
- `nextTask`는 store의 `homeSummary`가 있다면 그것을 재사용하거나 감싼다. 같은 판정을 두 곳에서 따로 하지 마라.
- `components/ConstraintCard.tsx`는 `TEMPLATE_NAMES`, `describeParams`를 `lib/wording.ts`에서 import하도록 바꾼다(컴포넌트의 다른 문구는 step 4).
- 테스트: 위 예시 전부, 월 경계를 넘는 주 단위 이름, `formatDeviation`의 반올림과 0, `wardRuleCount`가 필요 인원을 빼는지, `nextTask` 4가지 상태(운영 중 기간이 있을 때 다음 근무표를 고르는지 포함).

## Acceptance Criteria

```bash
npx vitest run lib/wording.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/wording.ts`가 순수 함수만 있고 React·store 상태 훅을 import하지 않는가?
   - 반환 문구가 UI_GUIDE "문구" 표의 "쓰는 말"과 일치하는가?
3. 결과에 따라 `phases/3-ux/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (export 목록 포함)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 컴포넌트의 화면 구조나 다른 문구를 바꾸지 마라(ConstraintCard의 import 교체만). 이유: step 4~6의 범위다.
- 데이터 이름(`period`, `hard`, `carry_over` 등)이나 백엔드 모델을 바꾸지 마라. 이유: 화면 문구만 바꾸기로 했다(UI_GUIDE "문구").
- LLM 프롬프트의 용어를 바꾸지 마라. 이유: eval 결과가 흔들린다. 이번 범위가 아니다.
- 기존 테스트를 깨뜨리지 마라.
