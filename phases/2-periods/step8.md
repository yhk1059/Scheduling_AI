# Step 8: store-continuity

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (J3, J4, 핵심 기능 6)
- `/docs/ADR.md` (ADR-015)
- `/docs/ARCHITECTURE.md` ("기간 연속성", "상태 관리")
- `/lib/store.ts`, `/lib/store.test.ts` (step 3)
- `/lib/continuity.ts`, `/lib/continuity.test.ts` (step 7)
- `/lib/period.ts`, `/lib/types.gen.ts` (`HistoryLoad`, `ScheduleRequest.history_load`)

## 배경

step 7의 순수 함수를 store에 연결해 기간 연속성을 완성한다.
- 다음 기간을 만들면 날짜 범위가 자동으로 정해지고, 이월은 지난 확정본에서 채워진다.
- 생성 요청에 누적 부담(`history_load`)과 지난 날짜 잠금이 들어간다.
- [확정]/[다시 확정]마다 확정본 버전(시각, 바뀐 칸)이 쌓인다.
- 지난 기간이 바뀌어 다음 기간의 이월이 달라지면 이를 알 수 있다.

## 작업

**`lib/store.test.ts`에 테스트를 먼저 추가한다**(TDD).

### 1. 요청 조립 (`toScheduleRequest` 확장)
```ts
export function toScheduleRequest(
  ward: Ward, period: WorkPeriod, periods: WorkPeriod[], today: string,
): Omit<ScheduleRequest, "input_version">;
```
- `carry_over`: `previousConfirmedPeriod`가 있으면 `carryOverFrom(prev, 활성 id)`, 없으면 `period.carryOver`(수동 입력). **요청할 때마다 새로 계산한다**(PRD J4: 이월은 다음에 생성할 때 다시 계산).
- `history_load`: `historyLoadFor(periods, period, 활성 id)`
- 운영 중인 기간이면 `pastDayLocks(period, 활성 명단, today)`를 constraints에 더한다. 같은 칸의 수동 고정(`fix-…`)이 있으면 잠금이 우선한다(수동 고정을 뺀다).
- 기존 규칙(활성 필터, disabled, override, snapshot)은 유지한다.

### 2. 이월 사용 기록과 변경 판정
- `WorkPeriod`에 `carryOverUsed: CarryOverRow[] | null`을 추가한다. `setResult` 시 그 요청에 쓴 `carry_over`를 저장한다(호출부가 넘긴다: `setResult(periodId, result, usedCarryOver)`).
- 셀렉터 순수 함수: `carryOverChanged(period, periods): boolean` — `carryOverUsed`가 있고, 지금 계산한 자동 이월과 `sameCarryOver`가 false면 true. 다음 기간이 초안이든 확정이든 같다(PRD J4).
- `STORAGE_VERSION`을 올린다(필드 추가).

### 3. 확정 버전
- `confirm(periodId)`:
  - 첫 확정: `versions = [{ confirmed_at, assignments, changed: [] }]`, `status: "confirmed"`, snapshot 저장(step 3과 같음)
  - 이미 확정된 기간(= [다시 확정]): `changed = diffAssignments(직전 버전, 현재 결과)`로 버전을 추가한다. 바뀐 칸이 없으면 버전을 추가하지 않는다.
- 셀렉터: `hasUnconfirmedChanges(period)` — 확정된 기간에서 현재 결과가 최신 버전과 다르면 true([다시 확정] 활성화에 쓴다).

### 4. 다음 기간 만들기
- `createPeriod(today)`: 기간이 있으면 `nextPeriod(ward.unit, 마지막 기간)`. 단위를 바꿔 마지막 기간 끝과 새 단위의 시작일이 맞지 않으면 `periodFrom(unit, 마지막 끝 + 1일)`. 새 기간의 공휴일은 비워 둔다.
- 마지막 기간이 아직 초안이면 새 기간을 만들지 않고 그 기간을 연다(기존과 같음).

### 5. 홈 화면용 셀렉터 (순수 함수, export)
```ts
export function homeSummary(periods: WorkPeriod[], today: string): {
  operating: WorkPeriod | null;         // isOperating
  next: { state: "none" } | { state: "draft" | "confirmed"; period: WorkPeriod };  // 오늘 이후 시작하는 가장 이른 기간
  recent: WorkPeriod[];                 // 최근 기간(시작일 내림차순)
};
```
- `rosterChanges`를 쓰는 셀렉터 `rosterChangesFor(ward, periods, periodId)`도 export한다(① 준비의 명단 점검에 쓴다).

### 테스트가 최소한 다룰 것
- 연속한 다음 기간: 범위 자동, 요청의 carry_over = 지난 확정본 마지막 7일
- 첫 기간: 수동 carry_over 사용
- history_load가 요청에 들어감, 비활성 간호사 제외
- 운영 중 기간 재풀이: 오늘 이전 날짜 잠금이 constraints에 있고, 같은 칸의 수동 고정은 빠짐
- [다시 확정]: changed 계산, 변경 없으면 버전 추가 안 함
- 지난 기간 [다시 확정]으로 마지막 7일이 바뀌면 다음 기간의 `carryOverChanged`가 true
- `homeSummary`: 운영 중/다음 기간 없음·초안·확정

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts lib/continuity.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 컴포넌트가 `toScheduleRequest`의 바뀐 시그니처를 쓰도록 호출부를 맞춘다(오늘 날짜는 로컬 날짜를 `YYYY-MM-DD`로).
2. 아키텍처 체크리스트를 확인한다:
   - 이월·누적 부담·잠금 계산이 `lib/continuity.ts` 순수 함수를 거치는가?
   - 백엔드에 보내는 값이 `ScheduleRequest` 생성 타입과 일치하는가?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 지난 날짜 잠금을 `requests`에 저장하지 마라. 이유: 오늘 날짜가 바뀌면 달라진다. 요청할 때마다 계산한다.
- 자동 이월을 기간 데이터에 복사해 두고 그 값으로 풀지 마라. 이유: 지난 기간이 바뀌면 다음 생성 때 다시 계산해야 한다(PRD J4). 저장하는 것은 "그때 쓴 값"(`carryOverUsed`)뿐이다.
- 버전 비교·복원 기능을 만들지 마라. 이유: PRD MVP 제외 사항.
- 화면 구조를 바꾸지 마라(호출부 시그니처 맞춤은 예외). 이유: step 9의 범위다.
- 기존 테스트를 깨뜨리지 마라.
