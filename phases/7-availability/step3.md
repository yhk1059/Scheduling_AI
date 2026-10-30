# Step 3: availability-db

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라. `/docs/ADR.md`는 ADR-020을 본다:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md`
- `/docs/ADR.md`
- `/supabase/migrations/20261030000000_shops.sql`
- `/docs/ARCHITECTURE.md`
- `/docs/PRD.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

직원 링크를 위한 DB를 SQL 파일로 작성한다. **적용은 사용자가 뒤에 한다.** 이 step에서는 DB에 접속하지 않는다.

## 작업

새 마이그레이션 `supabase/migrations/20261030000100_availability.sql` 하나를 만든다. 기존 파일은 고치지 않는다.

1. `availability_links`: `token uuid primary key default gen_random_uuid()`, `shop_id uuid not null references shops(id) on delete cascade`, `period_start date not null`, `period_length int not null`, `employee_id text not null`, `employee_name text not null`, `shop_name text not null`, `slots jsonb not null default '{}'`, `submitted_at timestamptz`, `locked_at timestamptz`, `unique(shop_id, period_start, employee_id)`, `check (octet_length(slots::text) <= 50000)`.
2. RLS: 자기 `shops` 행의 소유자만 select·insert·update·delete. anon에게 테이블 권한을 주지 않는다.
3. `security definer`, `set search_path = ''` 함수 두 개. anon과 authenticated에 execute를 준다. 그 밖에는 `revoke`한다.
   - `get_availability(p_token uuid)`: 그 행의 `shop_name, employee_name, period_start, period_length, slots, submitted_at, locked`만 돌려준다. 없으면 빈 결과.
   - `submit_availability(p_token uuid, p_slots jsonb)`: 없거나 잠겼으면 예외. 있으면 `slots`, `submitted_at`을 바꾼다. 다른 칼럼은 바꾸지 않는다.
4. `slots` 형식: `{ "2026-11-02": [["09:00", "15:00"], ...] }`. 날짜가 기간 안이고 시각이 30분 단위 06:00~24:00인지 함수가 검사한다.
5. `docs/ARCHITECTURE.md` 디렉토리 구조의 `(예정)` 표시가 있으면 고친다.

## Acceptance Criteria

```bash
test -f supabase/migrations/20261030000100_availability.sql
grep -q 'security definer' supabase/migrations/20261030000100_availability.sql
grep -q "search_path = ''" supabase/migrations/20261030000100_availability.sql
grep -qi 'revoke' supabase/migrations/20261030000100_availability.sql
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/7-availability/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- DB에 접속하거나 마이그레이션을 적용하지 마라. 이유: 적용은 사용자가 확인하고 한다.
- anon에게 `availability_links` 테이블 권한을 주지 마라. 이유: 토큰 없이 다른 직원의 시간을 읽게 된다.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
