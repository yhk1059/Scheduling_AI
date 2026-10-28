# Step 7: continuity-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J3, J4, J5, 핵심 기능 6)
- `/docs/ADR.md` (ADR-015)
- `/docs/ARCHITECTURE.md` ("기간 연속성" 패턴, 데이터 흐름의 "다음 기간")
- `/lib/period.ts` (step 0), `/lib/store.ts` (step 3의 `WorkPeriod`, `PeriodVersion`, `WardNurse`)
- `/lib/types.gen.ts` (`CarryOverRow`, `HistoryLoad`, `ConstraintSpec`, `DiffCell` — step 6에서 `HistoryLoad` 추가)
- `/backend/domain/constants.py` (`CARRY_OVER_DAYS = 7`, `HISTORY_DAYS = 28`)
- `/lib/roster-import.ts` (`CARRY_OVER_DAYS` 미러 상수)

## 배경

ARCHITECTURE "기간 연속성": 다음 기간의 `carry_over`는 지난 확정본에서, 누적 부담은 최근 4주 확정본에서 클라이언트가 계산한다. 운영 중인 기간의 지난 날짜는 고정 배정 제약으로 잠근다. **모두 `lib/`의 순수 함수다.**
이 step은 그 순수 함수들만 만든다. store 연결은 step 8, 화면은 step 9에서 한다.

## 작업

`lib/continuity.ts`를 만든다. **`lib/continuity.test.ts`를 먼저 작성**한다(TDD).
store 타입을 import해도 되지만 store 인스턴스(`useAppStore`)는 import하지 않는다.

```ts
export const HISTORY_DAYS = 28; // backend/domain/constants.py HISTORY_DAYS

/** 기간의 최신 확정본(versions 마지막). 없으면 null. */
export function latestConfirmed(period: WorkPeriod): Assignments | null;

/** target 바로 앞에서 끝나는(끝 날짜 + 1 = target 시작일) 확정 기간. 없으면 null. */
export function previousConfirmedPeriod(periods: WorkPeriod[], target: PeriodRange): WorkPeriod | null;

/**
 * 지난 확정본의 마지막 CARRY_OVER_DAYS일 → carry_over 행.
 * nurseIds에 있는 간호사만, 행 길이는 min(7, 지난 기간 길이).
 */
export function carryOverFrom(prev: WorkPeriod, nurseIds: string[]): CarryOverRow[];

/**
 * target 시작일 직전 HISTORY_DAYS일 안에 있는 확정 기간들의 최신 확정본으로
 * 간호사별 { nurse_id, nights, weekends }를 센다. 주말은 그 기간의 토·일과 그 기간 holidays.
 * nurseIds에 있는 간호사만, 둘 다 0인 간호사는 뺀다.
 */
export function historyLoadFor(periods: WorkPeriod[], target: PeriodRange, nurseIds: string[]): HistoryLoad[];

/**
 * 운영 중인 기간에서 today 이전(today 미포함) 날짜를 최신 확정본으로 잠그는 fixed_assignment 목록.
 * id는 `lock-{nurse_id}-{day}`, scope "period", source_text "지난 날짜 고정: {이름} {M}/{D} {코드}".
 * today가 기간 시작 이전이면 [], 기간이 끝났으면 전체 날짜. 확정본이 없으면 [].
 */
export function pastDayLocks(period: WorkPeriod, nurses: Nurse[], today: string): ConstraintSpec[];

/** 기간이 운영 중인지: 확정됨 && start_date <= today <= end. */
export function isOperating(period: WorkPeriod, today: string): boolean;

/** 두 배정의 바뀐 칸(공통 간호사·날짜만). */
export function diffAssignments(before: Assignments, after: Assignments): DiffCell[];

/** 같은 carry_over인지(간호사 순서 무관). 이월 변경 배너 판정에 쓴다. */
export function sameCarryOver(a: CarryOverRow[], b: CarryOverRow[]): boolean;

/** 지난 확정 기간의 snapshot 명단과 현재 활성 명단 비교: 추가·비활성화된 간호사. */
export function rosterChanges(prev: WorkPeriod | null, nurses: WardNurse[]): { added: WardNurse[]; deactivated: WardNurse[] };
```

### 핵심 규칙
- 날짜 계산은 `lib/period.ts` 함수만 쓴다(타임존 문제 방지).
- 기간 사이에 빈 날이 있으면(예: 기간 단위를 바꿔 간격이 생김) `previousConfirmedPeriod`는 null이다. 이월은 연속한 기간에서만 자동으로 채운다.
- 누적 부담 창은 기간 경계와 무관하게 날짜로 자른다(지난 기간의 일부 날짜만 들어갈 수 있다).
- 비활성 간호사는 결과에서 빠진다(호출부가 활성 id만 넘긴다).

### 테스트가 최소한 다룰 것
- `carryOverFrom`: 7일, 지난 기간이 7일보다 짧은 경우는 없지만 1주 단위(정확히 7일), 명단에 없는 간호사 제외
- `previousConfirmedPeriod`: 연속, 간격 있음, 지난 기간이 초안이면 null
- `historyLoadFor`: 28일 창이 두 기간에 걸치는 경우, 공휴일 포함 주말 계산, 나이트·주말 0인 간호사 제외, 최신 버전 사용
- `pastDayLocks`: 기간 전/중/후, 잠금 id와 날짜, 확정본 없음
- `diffAssignments`: 바뀐 칸만, 새 간호사·빠진 간호사 무시
- `sameCarryOver`, `rosterChanges`

## Acceptance Criteria

```bash
npx vitest run lib/continuity.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/continuity.ts`가 순수 함수만 갖고 React, store 인스턴스, fetch, localStorage를 쓰지 않는가?
   - 지난 날짜 잠금이 새 잠금 개념이 아니라 `fixed_assignment` 제약인가(ADR-015)?
   - 상수가 백엔드 `constants.py`와 같은 값이고 주석으로 출처를 밝혔는가?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `lib/store.ts`와 컴포넌트를 수정하지 마라. 이유: store 연결은 step 8, 화면은 step 9의 범위다.
- 지난 날짜 잠금 제약을 저장하는 형태로 설계하지 마라. 이유: 오늘 날짜에 따라 달라지므로 요청을 만들 때마다 새로 계산한다(step 8에서 `toScheduleRequest`가 붙인다).
- 백엔드를 수정하지 마라. 이유: 이 step은 클라이언트 순수 함수만 다룬다.
- 기존 테스트를 깨뜨리지 마라.
