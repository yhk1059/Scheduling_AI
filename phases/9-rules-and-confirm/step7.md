# Step 7: employee-view-db

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — CRITICAL: DB 접근은 클라이언트 supabase-js + RLS로만, 로그인 없는 직원 링크는 토큰을 확인하는 DB 함수만, `backend/`는 DB 접근 금지
- `/docs/ARCHITECTURE.md` — "패턴 › 직원 링크", "데이터 흐름 › 가능 시간·저장", "상태 관리"(저장 문서 모양: `shops.data = { version, state: { shop, periods, view, inputVersion } }`)
- `/docs/ADR.md` — ADR-014(저장), ADR-020·021(직원 링크, 토큰 DB 함수, `security definer`)
- `/supabase/migrations/20261030000100_availability.sql` — `get_availability`·`submit_availability`(토큰 확인, `security definer`, `set search_path = ''`, `revoke`/`grant`)
- `/supabase/migrations/20261031000000_availability_shares.sql`, `/supabase/migrations/20261101000000_roster_shifts.sql` — `get_availability_roster`가 **`shops.data`의 jsonb를 직접 읽는** 선례(`sh.data #> '{state,shop,config,shifts}'`)와 함수 재생성 방식(`drop function` 뒤 `create`)
- `/lib/supabase.ts` — `getAvailabilityRoster`(rpc 호출, `22P02` → null, 빈 결과 → null), `AvailabilityRoster`·`RosterShift` 타입
- `/lib/store.ts` — `WorkPeriod`(`start_date`, `length`, `holidays`, `status`, `versions[].assignments`·`confirmed_at`, `snapshot.employees`), `confirm`(확정본이 어디에 쌓이는지), `PeriodVersion`
- `/lib/types.gen.ts` — `ScheduleResult.assignments`(직원 id → 코드 배열, 인덱스 0 = 1일), `ShiftDef`
- `/lib/period.ts` — `PeriodRange`, `periodDays`, `dateOfDay`, `isWeekendDay`
- `/lib/availability.test.ts`, `/lib/period.test.ts` — 순수 함수 테스트 방식
- `/docs/BROWSER_TEST_SCENARIOS.md` — "실행 환경"(테스트 Supabase 프로젝트, `.env.local` 키)

## 배경

직원은 지금 확정 뒤 링크를 열면 "이미 확정된 근무표예요"만 본다. 이 step과 다음 step은 직원이 같은 링크에서 자기 이름을 고르면 **확정 근무표**(자기 근무와 전체 표)를 보게 한다. 이 step은 데이터 쪽이다: 토큰으로 확정본을 읽는 DB 함수, `lib/supabase.ts` 래퍼, 화면이 쓸 순수 함수. 화면은 step 8이다.

**확정본을 어디서 읽는가(결정)**: 매니저가 확정할 때 클라이언트가 확정본을 링크 행 옆에 따로 저장하지 않고, DB 함수가 **`shops.data` 문서에서 그 근무표의 마지막 확정본을 읽는다.** 이유: (1) `get_availability_roster`가 이미 같은 문서에서 근무조를 읽는 선례가 있다. (2) 새 저장 경로가 없어 확정본과 문서가 어긋날 일이 없다([다시 확정]도 자동으로 반영된다). (3) 테이블·열 추가가 없다. 트레이드오프: 문서 저장(디바운스 1초)이 끝나기 전에는 함수가 빈 결과를 돌려준다 — 화면은 "아직 불러올 수 없어요 · 다시 시도"로 받는다(step 8).

## 작업

TDD: 3의 순수 함수는 테스트를 먼저 쓴다. SQL은 테스트 Supabase 프로젝트에 적용해야 확인할 수 있으므로 아래 검증 절차의 호출 확인을 따른다.

1. `supabase/migrations/20261105000000_confirmed_schedule.sql`(새 파일):
   ```sql
   -- 공용 토큰으로 그 근무표의 마지막 확정본을 돌려준다(ADR-021의 공용 링크, 직원 확정 근무표 열람).
   -- shops.data(state.periods[])에서 period_start가 같고 status가 'confirmed'이며 versions가 있는 근무표를 찾는다. 없으면 빈 결과다.
   -- rows는 [{ "name": 직원 이름, "codes": [코드, …] }] (확정 시점 snapshot.employees 순서, 배정이 있는 직원만). 직원 id는 돌려주지 않는다.
   create function public.get_confirmed_schedule(p_token uuid)
   returns table (
     shop_name text,
     period_start date,
     period_length int,
     confirmed_at timestamptz,
     holidays jsonb,   -- 기간 안 인덱스(1..length) 배열
     shifts jsonb,     -- 매장 근무 형태 전부(휴무·꺼진 것·복합 코드 포함): [{code, name, start, end, hours, parts, active}]
     rows jsonb        -- [{name, codes}]
   )
   language sql stable security definer set search_path = '' as $$ … $$;
   revoke all on function public.get_confirmed_schedule(uuid) from public, anon, authenticated;
   grant execute on function public.get_confirmed_schedule(uuid) to anon, authenticated;
   ```
   - `availability_shares s`에서 `s.token = p_token`인 행의 `shop_id`·`period_start`로 `shops sh`를 찾고, `jsonb_array_elements(sh.data #> '{state,periods}')` 중 `p->>'start_date' = s.period_start::text` and `p->>'status' = 'confirmed'` and `jsonb_array_length(coalesce(p->'versions','[]')) > 0`인 것을 고른다. 마지막 버전은 `p->'versions'->(jsonb_array_length(p->'versions') - 1)`.
   - `shop_name`은 `sh.data #>> '{state,shop,name}'`. 직원 목록은 `coalesce(p #> '{snapshot,employees}', sh.data #> '{state,shop,employees}')`를 `with ordinality`로 순서를 지켜 `assignments ? (e->>'id')`인 것만 `{name, codes}`로 모은다.
   - `shifts`는 `sh.data #> '{state,shop,config,shifts}'` 그대로(화면이 코드 색·이름·시각을 그리는 데 전부 필요하다. 꺼진 코드도 지난 확정본에 남아 있을 수 있다).
   - 토큰이 없거나 확정 전이면 0행. 잠김(`locked_at`) 여부는 보지 않는다(확정 상태가 기준이다).
   - 토큰 외 입력을 받지 않는다. 쓰기를 하지 않는다(`stable`).
2. `lib/supabase.ts`:
   ```ts
   export interface ConfirmedSchedule {
     shop_name: string;
     period_start: string;
     period_length: number;
     confirmed_at: string;
     holidays: number[];
     shifts: ShiftDef[];
     rows: { name: string; codes: string[] }[];
   }
   /** 공용 링크로 마지막 확정본을 읽는다. 없는 링크·확정 전이면 null. */
   export async function getConfirmedSchedule(token: string): Promise<ConfirmedSchedule | null>;
   ```
   `getAvailabilityRoster`와 같은 방식(`rpc`, `22P02` → null, 빈 배열 → null, 그 밖의 오류는 throw).
3. `lib/confirmed-view.ts`(새 파일, 순수 함수, TDD `lib/confirmed-view.test.ts`):
   ```ts
   export interface EmployeeDay { day: number; date: string; weekday: number; code: string; label: string; weekend: boolean }
   /** 이름이 같은 직원의 기간 전체 날짜. label은 "오픈 09:00~15:00", 더블은 "더블 오픈+마감", 휴무는 "휴무", 모르는 코드는 코드 그대로. 이름이 없으면 null. */
   export function employeeDays(schedule: ConfirmedSchedule, name: string): EmployeeDay[] | null;
   /** 근무일 수와 실근무 시간 합(config의 hours). */
   export function employeeTotals(days: EmployeeDay[], shifts: ShiftDef[]): { workDays: number; hours: number };
   /** 7일씩 나눈 페이지(직원 입력 화면과 같은 단위). */
   export function weekPages(days: EmployeeDay[]): EmployeeDay[][];
   ```
   - `weekend`은 `isWeekendDay(range, day, holidays)`. 복합 코드의 label은 `parts`의 이름을 `+`로 잇는다. `codes` 길이가 `period_length`보다 짧으면 남은 날은 코드 `""`·label `"휴무"`가 아니라 `"—"`로 둔다(데이터가 빠진 것을 숨기지 않는다).
   - 테스트: 7일·14일 기간, 더블 코드, 공휴일 주말 판정, 없는 이름 → null, 짧은 codes.
4. 검증 절차 2의 DB 호출 확인용 임시 스크립트는 커밋하지 않는다(scratch에 두고 지운다).

## Acceptance Criteria

```bash
npx vitest run lib/confirmed-view.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **DB 적용 확인**: `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`로 supabase-js를 만들어 `rpc("get_confirmed_schedule", { p_token: "00000000-0000-0000-0000-000000000000" })`를 한 번 호출한다(vite-node 한 줄 스크립트, 커밋하지 않음). 오류 없이 `[]`가 오면 적용된 것이다. 오류 코드가 `PGRST202`(함수 없음)·`42883`이거나 env가 없으면 **`blocked`**로 두고 `blocked_reason`에 "`supabase/migrations/20261105000000_confirmed_schedule.sql`을 테스트·운영 Supabase 프로젝트에 적용해 주세요(SQL Editor에 붙여넣기)"를 적고 즉시 중단한다. 사용자가 적용한 뒤 다시 실행하면 이 확인부터 통과한다.
3. 아키텍처 체크리스트를 확인한다:
   - 함수가 `security definer` + `set search_path = ''`이고 `anon`에 테이블 권한을 주지 않았는가? `revoke`/`grant`가 기존 함수와 같은 모양인가?
   - 반환에 직원 id·가능 시간 칸·다른 근무표가 섞이지 않는가?
   - `backend/`를 손대지 않았는가? `lib/confirmed-view.ts`가 `lib/store.ts`·`components/`를 import하지 않는가?
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(마이그레이션 파일, 함수 이름·반환 열, 래퍼·순수 함수 시그니처, DB 적용 확인 결과)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다. 화면 변경은 없어야 정상이다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(마이그레이션 미적용, env 없음) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 확정본을 저장하는 새 테이블·열이나 클라이언트 쓰기 경로를 만들지 마라. 이유: 위 결정(문서에서 읽기). 확정본은 이미 `shops.data`에 있다.
- `backend/`에서 DB를 읽거나 service role 키를 쓰지 마라. 이유: CLAUDE.md CRITICAL, ARCHITECTURE "쓰지 않는 것".
- Supabase MCP 도구나 CLI로 마이그레이션을 직접 적용하지 마라. 이유: DB 적용은 사용자가 한다. 적용이 안 돼 있으면 `blocked`다.
- `get_availability_roster`·`get_availability`·`submit_availability`를 바꾸지 마라. 이유: 가능 시간 입력 흐름은 그대로다. 새 함수 하나만 더한다.
- 반환에 직원 id(`e01`)를 넣지 마라. 이유: ADR-021 "직원 id는 돌려주지 않는다". 이름으로 충분하다.
- 화면(`components/AvailabilityForm.tsx`, `app/a/`)을 고치지 마라. 이유: step 8이 한다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
