# Step 3: store-ward-periods

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` ("데이터 층", J1, J2, J5)
- `/docs/ADR.md` (ADR-005, ADR-014, ADR-015)
- `/docs/ARCHITECTURE.md` ("상태 관리", "제약 단일 표현", "간호사 id")
- `/lib/store.ts`, `/lib/store.test.ts` (현재 단일 월 구조)
- `/lib/period.ts` (step 0), `/lib/types.gen.ts` (step 1에서 바뀐 `Period`)
- `/lib/roster-import.ts` (명단 id 부여 방식), `/lib/samples/ward-15.json`
- `components/` 전체 (store를 쓰는 곳)

## 배경

지금 store는 "병동 1개 + 달 1개"가 섞인 평면 구조다. ARCHITECTURE "상태 관리"에 따라 **`ward + periods[]`** 구조로 바꾼다.
병동(명단, 필요 인원, 병동 규칙, 기간 단위)은 계속 유지되고, 기간(날짜 범위, 공휴일, 요청, 결과, 상태)은 기간마다 새로 만든다. 이력은 확정된 `periods[]`다.
이월 자동 계산, 누적 부담, 지난 날짜 잠금, 버전 diff는 step 7~8에서 붙인다. 이 step은 데이터 구조와 기본 동작, 요청 조립 함수까지만 한다.

## 작업

**`lib/store.test.ts`를 먼저 새 구조에 맞게 고쳐 쓴다**(TDD). 그 다음 `lib/store.ts`를 구현하고, 컴포넌트는 컴파일되도록 최소 수정한다.

### 1. 상태 구조 (`lib/store.ts`)
```ts
export interface WardNurse extends Nurse { active: boolean }

export interface Ward {
  name: string;
  unit: PeriodUnit;                 // lib/period.ts
  nurses: WardNurse[];
  nextNurseNo: number;              // 다음에 부여할 번호. 줄어들지 않는다
  rules: ConstraintSpec[];          // scope "ward". 필요 인원(daily_coverage)도 여기
  pendingRules: ConstraintSpec[];   // 적용 대기 카드
  isSample: boolean;                // 샘플에서 시작했는지(step 12 로그인 질문에 쓴다)
}

export interface PeriodVersion {
  confirmed_at: string;             // ISO 시각
  assignments: Assignments;
  changed: DiffCell[];              // 직전 버전 대비 바뀐 칸. 이 step에서는 항상 []
}

export interface WorkPeriod extends PeriodRange {   // { start_date, length }
  id: string;
  holidays: number[];
  requests: ConstraintSpec[];        // scope "period" (요청, 수동 고정)
  pendingRequests: ConstraintSpec[];
  disabledIds: string[];             // [이번 기간만 끄기]
  ruleOverrides: Record<string, ConstraintSpec>;  // 이 기간에만 바뀐 병동 규칙(제안 수락 update)
  carryOver: CarryOverRow[];         // 수동 입력 이월(첫 기간)
  result: ScheduleResult | null;
  resultVersion: number | null;
  status: "draft" | "confirmed";
  versions: PeriodVersion[];
  snapshot: { nurses: WardNurse[]; rules: ConstraintSpec[] } | null;  // 확정 시점의 명단·병동 규칙
}

interface Data {
  ward: Ward | null;
  periods: WorkPeriod[];             // start_date 오름차순
  view: View;                        // 지금 보는 화면(아래)
  inputVersion: number;
}
type View =
  | { screen: "home" }
  | { screen: "settings"; tab: "roster" | "rules" }
  | { screen: "period"; periodId: string; step: 1 | 2 | 3 };
```
- `STORAGE_VERSION`을 3으로 올린다. 이전 버전이나 손상된 데이터는 지금처럼 초기화하고 `resetNotice`를 띄운다. 기존 사용자 데이터는 초기화해도 된다는 결정이 있다.

### 2. 액션 (시그니처 수준. 이름은 바꿔도 되지만 역할은 지킨다)
- 병동: `startWard()`(빈 병동), `loadSample(today)`(샘플 병동 + 첫 기간 1개, `isSample: true`), `setWardName`, `setUnit`, `setCoverage`(기존과 같음, ward.rules에), `addPendingRules`/`applyRule`/`updateRule`/`removeRule`
- 명단: `addNurses(rows)`, `updateNurse(id, patch)`, `setNurseActive(id, active)`, `replaceRoster(rows)`(명단 붙여넣기·CSV 결과 반영)
  - **간호사 id 규칙**: 새 간호사에게만 `n{nextNurseNo}`(2자리 0 채움)를 부여하고 `nextNurseNo`를 올린다. 기존 id는 다시 매기지 않는다. `replaceRoster`는 이름이 같은 기존 간호사의 id를 유지하고, 새 이름에만 새 id를 준다. 명단에서 빠진 사람은 삭제하지 않고 `active: false`로 둔다.
  - 아직 어떤 기간에도 쓰이지 않은(초안 기간의 요청도 참조하지 않는) 간호사만 실제 삭제를 허용하는 `removeNurse(id)`를 둔다. 그 외에는 비활성으로만 바꾼다.
- 기간: `createPeriod(today)` — 기간이 없으면 `periodFrom(unit, firstPeriodStart(unit, today))`, 있으면 마지막 기간 뒤 `nextPeriod`. 새 기간을 만들고 그 기간 화면 ①로 간다. 초안 기간이 이미 있으면 새로 만들지 않고 그 기간을 연다.
  - `toggleHoliday(periodId, day)`, `setCarryOver(periodId, rows)`
  - 요청 카드: `addPendingRequests`/`applyRequest`/`updateRequest`/`removeRequest`
  - `setDisabled(periodId, constraintId, disabled)` — 병동 규칙이든 요청이든 이 기간의 `disabledIds`만 바꾼다. 병동 규칙 원본은 바꾸지 않는다.
  - `applyChanges(periodId, changes)` — 검증된 제안 수락: disable → `disabledIds`, update → 요청이면 요청을 고치고, 병동 규칙이면 `ruleOverrides[id]`에 바꾼 사본을 둔다.
  - `setFixed(periodId, nurseId, day, shift)` / `clearFixed(...)` — 기간의 `requests`에 `fixed_assignment`(scope "period")
  - `setResult(periodId, result)` — 응답 버전이 현재와 같을 때만 부른다
  - `confirm(periodId)` — `status: "confirmed"`, `versions`에 `{ confirmed_at: now, assignments, changed: [] }` 추가, `snapshot`에 지금의 활성 명단과 병동 규칙(override 적용 전 원본) 저장
- 화면: `go(view)`
- `hasInput()`: 병동이 있거나 기간이 하나라도 있으면 true. `reset()`: 초기 상태로(inputVersion은 올림)

### 3. 요청 조립 순수 함수 (`lib/store.ts`에서 export)
```ts
/** 기간 하나의 /solve·/explain 요청 본문(input_version 제외). */
export function toScheduleRequest(ward: Ward, period: WorkPeriod): Omit<ScheduleRequest, "input_version">;
```
- 초안 기간은 현재 병동(`ward.nurses`, `ward.rules`)을, 확정된 기간은 `period.snapshot`을 쓴다. PRD J1 "고친 병동 설정은 다음에 만드는 기간부터, 확정된 기간은 바뀌지 않는다"를 지키기 위해서다.
- `nurses`: 활성 간호사만(`active` 필드는 빼고 `Nurse` 모양으로)
- `constraints`: (병동 규칙에 `ruleOverrides` 적용) + 요청. `disabledIds`에 있으면 `enabled: false`. **비활성 간호사를 참조하는 제약은 뺀다**(백엔드 참조 무결성 422 방지).
- `carry_over`: `period.carryOver`에서 활성 간호사 행만. (step 8에서 지난 확정본 자동 이월로 바뀐다)
- `previous`: 결과가 있으면 그 assignments를 활성 간호사만 남겨 보낸다(최소 변경 재스케줄).
- `inputVersion`은 병동·기간 내용이 바뀔 때마다 올린다. 화면 이동(`go`)은 올리지 않는다.

### 4. 테스트가 최소한 다룰 것
- id: 추가·붙여넣기 재반영·순서 변경 후에도 기존 id 유지, 빠진 사람은 비활성, `nextNurseNo` 단조 증가
- `createPeriod`: 첫 기간(단위별), 연속 기간, 초안이 있으면 새로 만들지 않음
- `setDisabled`/`applyChanges`가 병동 규칙 원본을 바꾸지 않음
- `toScheduleRequest`: 비활성 간호사와 그를 참조하는 제약 제외, 꺼진 제약 enabled=false, override 적용, 확정 기간은 snapshot 사용
- `confirm`: status, versions 1개, snapshot
- persist: 버전이 다르거나 손상되면 초기화 + resetNotice, localStorage 사용 불가 시 메모리

### 5. 컴포넌트 최소 수정
- 지금의 1~4단계 화면이 새 store로 계속 동작하도록 셀렉터만 바꾼다(예: 현재 기간 = `view.periodId`의 기간, 없으면 첫 초안). 화면 구조 개편은 step 4~5에서 한다.
- `lib/api.ts`는 그대로 두고, 호출하는 컴포넌트가 `toScheduleRequest`로 본문을 만든다.

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - store가 백엔드에 보내는 모양이 `ScheduleRequest`(생성 타입)와 일치하는가?
   - 별도 저장소 추상화 계층을 만들지 않았는가? (ARCHITECTURE "상태 관리")
   - 제약 단일 표현(필요 인원도 `daily_coverage`)을 유지하는가?
3. `npm run dev`로 띄워 샘플 병동 → 생성이 여전히 되는지 확인하고 서버를 종료한다.
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 백엔드 모델에 `active`나 병동 단위 필드를 추가하지 마라. 이유: 백엔드는 기간 하나를 푸는 무상태 계산기다. 활성 필터와 기간 단위는 클라이언트 책임이다.
- 간호사를 배열 순서로 id를 다시 매기지 마라. 이유: 요청과 고정 배정이 다른 사람에게 옮겨 간다(PRD 데이터 층).
- Supabase나 로그인 관련 코드를 넣지 마라. 이유: step 11~13의 범위다.
- 이월 자동 계산, 누적 부담, 지난 날짜 잠금을 넣지 마라. 이유: step 7~8의 범위다.
- 화면 레이아웃을 새로 만들지 마라. 이유: step 4~5의 범위다.
- 기존 테스트를 깨뜨리지 마라(store 구조 변경으로 바뀌는 store 테스트는 새 구조로 다시 쓴다).
