# Step 8: employee-view-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — CRITICAL: 로그인 없는 직원 링크는 토큰을 확인하는 DB 함수만 호출
- `/docs/UI_GUIDE.md` — "직원 가능 시간 입력"(맨 위 줄, 제목, 이름 칩, 잠긴 뒤), "근무 셀", "근무 코드", "요약 지표", "타이포그래피", "문구" 표, "접근성"
- `/docs/PRD.md` — J2 "직원 화면", J8 "확정 뒤에는 '이미 확정된 근무표예요'"(이 step이 바꾸는 부분)
- `/lib/supabase.ts` — step 7의 `getConfirmedSchedule`, `ConfirmedSchedule`, 기존 `getAvailabilityRoster`(`locked`, `employees[].employee_name`)
- `/lib/confirmed-view.ts` — step 7의 `employeeDays`, `employeeTotals`, `weekPages`
- `/components/AvailabilityForm.tsx` — `AvailabilityForm`(공용 토큰 → `NamePicker` → `EmployeeForm`), `TopLine`, `LoadMessage`, `NamePicker`의 잠김 분기, `PAGE` 상수, `DayHeader`
- `/components/ScheduleStep.tsx` — `ScheduleGrid`(props: `config`, `rows`, `result`, `period`, `holidays`, `isWeekend`, `fixed`, `selected`, `disabled`, `readOnly`, `onSelect`, `legend`), `codeClass`, `cellText`, `DayHead`. 랜딩 `HeroSequence`가 이 파일의 `ScheduleGrid`를 import하는 선례가 있다
- `/components/ShopHome.tsx` — `shortTime`(M/D HH:MM)
- `/components/ui.ts` — `pageTitle`, `sectionTitle`, `card`, `badge`, `badgeTone`, `text`
- `/app/a/[token]/page.tsx` — 라우트(바꾸지 않는다)

## 배경

step 7이 토큰으로 확정본을 읽는 함수와 순수 함수를 만들었다. 이 step은 직원 화면(`/a/{공용 토큰}`)을 바꾼다: 근무표가 확정됐으면 "이미 확정된 근무표예요" 대신 자기 이름을 고르면 **자기 근무(기간 전체, 주 단위)와 전체 근무표**를 본다. 가능 시간 입력 흐름(확정 전)은 그대로다. 잠긴 뒤의 보기 전용 캘린더는 없앤다(근무표가 그 자리를 대신한다).

## 작업

1. `components/EmployeeSchedule.tsx`(새 파일, `"use client"`): 
   ```ts
   export default function EmployeeSchedule({ token, name, onBack }: { token: string; name: string; onBack: () => void }): JSX.Element
   ```
   - `getConfirmedSchedule(token)`을 읽는다(`EmployeeForm`과 같은 `loading | error | not_found | ok` 패턴, [다시 시도]). `null`이면 `"확정 근무표를 아직 불러올 수 없어요. 잠시 뒤 다시 열어 주세요"` + [다시 시도](저장이 끝나기 전일 수 있다).
   - 화면(위에서부터): `TopLine`(기존 것 export) → 제목 `{매장 이름} · {이름}님의 근무표`(`ui.pageTitle`, h1) + 날짜 범위(mono) + `확정 {M/D HH:MM}` 보조 글자 + 오른쪽 [이름 다시 고르기] Text(`onBack`) → **내 근무** 섹션(`ui.sectionTitle` "내 근무") → **전체 근무표** 섹션 → 아래 개인정보처리방침 링크(기존 `NamePicker`와 같은 자리).
   - **내 근무**: `employeeDays`로 만든 날짜를 `weekPages`로 7일씩 카드(`ui.card`) 한 줄에 7칸(`grid-cols-7`). 칸마다 요일+날짜(`월 11/2`, mono, 토 `text-[#155E75]` 일·공휴일 `text-[#B42318]`), 근무 셀 색(`codeClass`)의 코드 글자, 그 아래 label(`오픈 09:00~15:00`). 휴무는 글자 없이 비운 셀 + "휴무". 카드 머리에 `근무 {workDays}일 · {hours}시간`(`employeeTotals`). 2주 이상이면 주마다 카드를 세로로 쌓는다([이전 주]/[다음 주] 없이 전부 보여 준다. 한 달이면 카드 5개).
   - **전체 근무표**: `ScheduleGrid`를 `readOnly`·`disabled`·`legend`로 그린다. `rows`는 `schedule.rows`를 `Employee` 모양(`{ id: name, name, active: true, tags: [] }`)으로, `result`는 `{ assignments: Object.fromEntries(rows.map(r => [r.name, r.codes])) }`에 `ScheduleGrid`가 요구하는 나머지 필드를 채운다. `ScheduleGrid`의 `result` prop 타입이 `ScheduleResult` 전체를 요구하면 `Pick<ScheduleResult, "assignments" | "soft_violations">`처럼 **쓰는 필드만으로 좁혀도 된다**(기존 호출은 모두 `ScheduleResult`를 넘기므로 호환). `hideViolations`를 켠다. 자기 행을 눈에 띄게 하려면 `ScheduleGrid`에 선택 prop `highlightId?: string`(이름 칸 `font-semibold bg-[#F0F6F8]`)을 더한다. `fixed`는 빈 Map, `onSelect`는 no-op, `history` 없음, `isWeekend`는 `isWeekendDay(range, d, holidays)`.
   - 셀 `aria-label`은 `ScheduleGrid`가 `{이름} {M}월 {D}일 {코드}`로 만든다. 내 근무 칸에도 같은 꼴의 `aria-label`을 둔다.
   - store(`useAppStore`)를 쓰지 않는다. `ScheduleGrid`를 import하면 `lib/store` 모듈이 함께 번들에 들어오지만 호출하지 않는다(랜딩과 같다). 
2. `components/AvailabilityForm.tsx`:
   - `NamePicker`: `roster.locked`일 때 문구를 `"확정된 근무표예요. 내 이름을 고르면 근무표를 볼 수 있어요"`로 바꾸고, 이름을 고르면(제출 여부와 관계없이, 덮어쓰기 확인 없이) `onPick`에 **직원 이름**을 넘겨 `EmployeeSchedule`을 연다. `제출함` 배지는 잠긴 뒤에는 보여 주지 않는다(제출이 끝난 상태라 뜻이 없다).
   - `AvailabilityForm`: `picked` 상태를 `{ kind: "availability"; token } | { kind: "schedule"; name }`으로 나눈다. 잠기지 않았으면 기존 `EmployeeForm`.
   - `Calendar`의 `locked` 분기(보기 전용 캘린더, "이미 확정된 근무표예요" 하단 줄)는 제출 중에 잠기는 경우(`submitAvailability` → `"locked"`)에만 남는다. 그 경우 문구를 `"그사이 근무표가 확정됐어요. 이름 고르기로 돌아가면 근무표를 볼 수 있어요"`로 바꾸고 [이름 다시 고르기]를 둔다.
   - `TopLine`의 보조 글자 "· 가능 시간 입력"은 근무표 화면에서 "· 근무표"로 바꾼다(`TopLine`에 prop을 더한다).
3. `app/a/[token]/page.tsx`의 `metadata.title`은 "가능 시간 입력" 그대로 둔다(라우트 하나가 두 상태를 가진다. 바꾸려면 summary에 제안만 적는다).

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 직원 화면이 호출하는 것이 토큰 DB 함수 세 개 + `get_confirmed_schedule`뿐인가(테이블 직접 접근 없음)?
   - 직원 id·다른 직원의 가능 시간이 화면·DOM에 나오지 않는가?
   - UI_GUIDE "문구" 표와 "근무 셀"(글자 + 색, 휴무는 빈칸) 규칙을 지켰는가? 이모지를 쓰지 않았는가?
3. 수동 체크(step 7의 마이그레이션이 적용된 테스트 Supabase, `npm run seed` 또는 테스트 계정의 확정 근무표): 공용 링크를 로그인 없는 창(1280×800)에서 열어 이름을 고르면 내 근무 카드와 전체 근무표가 보이고, 자기 행이 강조된다. 확정 전 링크는 기존 가능 시간 입력 그대로다. 틀린 토큰은 "링크를 확인해 주세요". 확정 직후(저장 전) 열면 "아직 불러올 수 없어요"와 [다시 시도]. 환경이 없으면 summary에 "확인 못 함"을 적는다.
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구·접근성 이름·버튼 위치를 적어라**(잠긴 이름 고르기 문장, 제목 꼴, 섹션 제목, 버튼 이름, 없어진 것: 보기 전용 캘린더·`제출함` 배지·"이미 확정된 근무표예요. 입력한 시간은 볼 수만 있어요"). e2e S12 11~13단계가 바뀐다는 것을 적어라. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 직원 화면에서 `useAppStore`·`lib/store.ts`의 상태를 읽거나 쓰지 마라. 이유: 직원은 로그인이 없고 매니저 문서에 접근하면 안 된다. 데이터는 토큰 DB 함수로만 온다.
- 본인 확인(PIN 등)을 더하지 마라. 이유: ADR-021 "본인 확인은 두지 않는다".
- 근무표를 수정·교환하는 동작을 두지 마라. 이유: PRD MVP 제외(근무 교환). 보기 전용이다.
- `ScheduleGrid`의 기존 동작(편집, 고정, 합계)을 바꾸지 마라. 이유: 매니저 화면이 쓴다. 선택 prop 추가와 타입 좁히기만 허용한다.
- `supabase/migrations/`와 `lib/supabase.ts`의 함수 시그니처를 바꾸지 마라. 이유: step 7이 끝났다. 모자란 데이터가 있으면 summary에 적어라.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
