# Step 0: period-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` ("데이터 층"의 기간 단위, J2·J3의 기간 기본값)
- `/docs/ADR.md` (ADR-010, ADR-015)
- `/docs/ARCHITECTURE.md` (API 계약의 `period`)
- `/docs/UI_GUIDE.md` ("근무 셀"의 날짜 헤더·aria-label 규칙)
- `/lib/store.ts` (`nextMonth`), `/lib/csv.ts`, `/components/ScheduleStep.tsx` (지금 날짜·요일을 계산하는 방식)

## 배경

이 phase는 근무 기간을 "달력 월(year/month)"에서 "시작일 + 길이(start_date + length)"로 일반화하고(ADR-015), 기간 간 이월·누적 부담·잠금·버전, Supabase 저장과 Google 로그인(ADR-014)을 차례로 붙인다.
이 step은 그 첫 단계로, 기간 날짜 계산을 담당하는 **순수 함수 모듈만** 만든다. 기존 코드는 아직 바꾸지 않는다. 다음 step(period-domain)에서 백엔드 `Period`가 `{ start_date, length }`로 바뀌고 프론트가 이 모듈을 쓰게 된다.

## 작업

`lib/period.ts`를 만든다. **`lib/period.test.ts`를 먼저 작성**하고(TDD), 테스트가 통과하는 구현을 쓴다.

### 타입
```ts
/** 병동의 기간 단위. 주 단위는 월요일에 시작한다. */
export type PeriodUnit = "1w" | "2w" | "4w" | "month";
/** 백엔드 Period와 같은 모양. start_date는 "YYYY-MM-DD". */
export interface PeriodRange { start_date: string; length: number }

export const PERIOD_UNITS: { value: PeriodUnit; label: string }[]; // "1주", "2주", "4주", "달력 월"
export const MAX_PERIOD_DAYS = 31; // backend/domain/constants.py와 같은 값(다음 step에서 추가)
```

### 함수 (시그니처만 정한다. 구현은 재량)
```ts
/** today 또는 그 이후의 첫 기간 시작일. 주 단위는 월요일, 달력 월은 1일. today가 이미 시작일이면 today. */
export function firstPeriodStart(unit: PeriodUnit, today: string): string;
/** after(포함) 이후의 첫 유효 시작일에서 시작하는 기간. 달력 월이면 그 달의 일수, 주 단위면 7·14·28. */
export function periodFrom(unit: PeriodUnit, after: string): PeriodRange;
/** 직전 기간 다음 날 이후의 첫 기간(연속한 다음 기간). */
export function nextPeriod(unit: PeriodUnit, prev: PeriodRange): PeriodRange;
/** 마지막 날짜(포함). */
export function periodEnd(p: PeriodRange): string;
/** 1-based 날짜 인덱스 → "YYYY-MM-DD". */
export function dateOfDay(p: PeriodRange, day: number): string;
/** "YYYY-MM-DD" → 1-based 인덱스. 범위 밖이면 null. */
export function dayOfDate(p: PeriodRange, date: string): number | null;
/** 인덱스별 { day, date, month, dom, weekday(0=일) } 목록. */
export function periodDays(p: PeriodRange): PeriodDay[];
/** 토·일 또는 holidays(인덱스)에 있으면 true. */
export function isWeekendDay(p: PeriodRange, day: number, holidays: number[]): boolean;
/** 표기: "2026.11.23 – 12.6"(같은 해), 해가 바뀌면 끝에도 연도. */
export function formatRange(p: PeriodRange): string;
/** 날짜 헤더: 기간 첫날이거나 달의 1일이면 "M/D", 아니면 "D". */
export function dayHeader(p: PeriodRange, day: number): string;
/** 기간 단위 표기 "1주" 등. */
export function unitLabel(unit: PeriodUnit): string;
```

### 핵심 규칙
- 날짜 계산은 **타임존 영향을 받지 않게** 한다. `"YYYY-MM-DD"` 문자열을 UTC 자정(`Date.UTC`)으로만 다루거나 정수 연산으로 처리한다. `new Date("2026-11-01")`의 로컬 시각 메서드(`getDate`, `getDay`)를 섞어 쓰지 마라. 이유: 브라우저 타임존에 따라 하루가 밀린다.
- 기간 길이는 항상 1~31이다(달력 월 28~31, 주 단위 7·14·28).

### 테스트가 최소한 다룰 것
- `firstPeriodStart`: 주 단위(오늘이 월요일인 경우와 아닌 경우), 달력 월(오늘이 1일인 경우와 아닌 경우), 연말(12월 → 다음 해 1월)
- `nextPeriod`: 2주 단위가 월 경계를 넘는 경우, 달력 월의 2월(윤년 2028 포함), 12월 → 1월
- 단위가 바뀐 경우: 달력 월 기간 뒤에 `periodFrom("1w", 다음 날)`이 그 다음 날 이후 첫 월요일에서 시작하는 것
- `dateOfDay`/`dayOfDate` 왕복, 범위 밖이면 null
- `dayHeader`: 기간 첫날, 달의 1일, 그 밖의 날
- `isWeekendDay`: 토·일과 공휴일 인덱스
- `formatRange`: 같은 해, 해가 바뀌는 경우

## Acceptance Criteria

```bash
npx vitest run lib/period.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/period.ts`는 순수 함수만 있고 React, store, fetch를 import하지 않는가?
   - 새 npm 의존성(날짜 라이브러리 등)을 추가하지 않았는가?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 기존 파일(`lib/store.ts`, `lib/csv.ts`, 컴포넌트, `backend/`)을 수정하지 마라. 이유: 기간 모델 계약 변경은 다음 step에서 한 번에 한다.
- date-fns, dayjs 같은 날짜 라이브러리를 추가하지 마라. 이유: 기술 스택에 없는 의존성이고, 필요한 계산이 단순하다.
- 기존 테스트를 깨뜨리지 마라.
