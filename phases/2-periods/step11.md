# Step 11: supabase-client

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (특히 "DB 접근은 클라이언트에서 supabase-js + RLS로만", "`backend/`는 DB에 접근하지 않는다")
- `/docs/ADR.md` (**ADR-014**, ADR-012, ADR-007)
- `/docs/ARCHITECTURE.md` (디렉토리 구조의 `lib/supabase.ts`·`supabase/migrations/`, 기술 스택 표, "환경")
- `/docs/PRD.md` (J6, 핵심 기능 7)
- `/lib/api.ts` (얇은 래퍼의 예), `/lib/store.ts`
- `/scripts/hooks/tdd-guard.sh`, `/scripts/test_hooks.py`
- `/package.json`

## 배경

ADR-014: 저장은 Supabase의 `wards` 테이블 하나(병동 문서 = store 상태 jsonb)와 RLS(`owner_id = auth.uid()`)로 하고, 인증은 Google OAuth를 클라이언트에서만 처리한다. 백엔드(FastAPI)는 DB에 접근하지 않는다.
**사전 조건(이미 끝남)**: Supabase 프로젝트(서울 리전, ref `oqttmjycnshhicjqlxzz`)와 Google OAuth 공급자 설정이 끝났고, `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 있다.
이 step은 **마이그레이션 SQL 파일과 얇은 클라이언트 래퍼**만 만든다. store 동기화는 step 12, 화면은 step 13이다. **마이그레이션을 원격 DB에 적용하지 않는다**(phase 실행 후 사람이 확인하고 적용한다).

## 작업

### 1. 마이그레이션 (`supabase/migrations/20261028000000_wards.sql`)
아래 요구를 모두 만족하는 SQL을 쓴다. 보안 규칙이므로 그대로 지킨다.
```sql
create table public.wards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null check (octet_length(data::text) <= 2000000),
  updated_at timestamptz not null default now()
);
alter table public.wards enable row level security;
-- select / insert / update / delete 정책 4개: 모두 `to authenticated`,
--   using / with check 는 owner_id = (select auth.uid())
-- update 시 updated_at = now() 로 바꾸는 트리거 (함수는 security invoker, set search_path = '')
revoke all on public.wards from anon;
```
- 다시 실행해도 깨지지 않도록 만들 필요는 없다(마이그레이션 1회 적용).

### 2. 의존성
- `npm install @supabase/supabase-js` (dependencies). `@supabase/ssr`은 쓰지 않는다.

### 3. `lib/supabase.ts` (얇은 래퍼, TDD 예외)
```ts
/** env가 없으면 false. 이때 앱은 게스트 모드로만 동작한다(빌드·e2e가 env 없이도 돌아야 함). */
export const supabaseConfigured: boolean;

export interface AuthUser { id: string; email: string | null }
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void; // 초기 세션도 한 번 알림
export function signInWithGoogle(): Promise<void>;   // redirectTo: `${location.origin}/app`
export function signOut(): Promise<void>;

export interface WardRow { data: unknown; updatedAt: string }
export function loadWard(): Promise<WardRow | null>;                         // 내 행 1개 또는 null
export function saveWard(userId: string, data: unknown): Promise<{ updatedAt: string }>; // upsert on owner_id, owner_id 명시
export function deleteWard(): Promise<void>;                                   // 내 행 삭제
```
- 클라이언트는 첫 사용 시 한 번만 만든다(지연 생성). 모듈 최상위에서 env가 없다고 throw하지 마라.
- `createClient` 옵션: `auth.persistSession: true`, `detectSessionInUrl: true`, `flowType: "pkce"`.
- 오류는 `Error`로 throw한다(메시지는 사용자 문구로 쓰지 않는다. 화면 문구는 step 13).
- 이 파일은 순수 함수가 아니므로 TDD 대상이 아니다. 동기화 로직은 step 12에서 store에 두고 테스트한다.

### 4. TDD 예외 정리 (`lib/api.ts`와 같은 취급)
- `scripts/hooks/tdd-guard.sh`의 예외 목록에 `*/lib/supabase.ts`를 추가하고, `scripts/test_hooks.py`에 이 경로가 허용되는 케이스를 추가한다.
- `CLAUDE.md` "개발 프로세스"의 "UI 컴포넌트(`app/`, `components/`)와 `lib/api.ts`는 TDD 대상이 아니다" → "`lib/api.ts`, `lib/supabase.ts`"로 고친다. `docs/ADR.md` ADR-012의 같은 문장도 맞춘다.

### 5. env 문서
- `.env.local`은 수정하지 않는다. `README.md`의 환경 변수 안내가 있으면 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 추가한다(값은 쓰지 않는다).

## Acceptance Criteria

```bash
test -f supabase/migrations/20261028000000_wards.sql
grep -c "create policy" supabase/migrations/20261028000000_wards.sql   # 4
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `backend/`에 DB 접근 코드나 Python 의존성이 추가되지 않았는가?
   - service role 키, `@supabase/ssr`, 미들웨어 인증을 쓰지 않았는가?
   - RLS 정책 4개가 모두 `owner_id = (select auth.uid())`이고 `anon` 권한이 없는가?
   - env 없이 `npm run build`가 통과하는가(`NEXT_PUBLIC_SUPABASE_*`를 임시로 비우고 확인할 필요까지는 없다. 모듈 최상위 throw가 없으면 된다)?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (마이그레이션 파일 경로 포함, 원격 미적용)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 마이그레이션을 원격 Supabase에 적용하지 마라(supabase CLI, SQL API, MCP 등 어떤 방법으로도). 이유: 원격 DB 변경은 phase 실행 후 사람이 확인하고 적용한다.
- `.env.local`을 읽어 값을 출력하거나 커밋 대상 파일에 키를 쓰지 마라. 이유: 비밀 노출 방지(anon 키도 저장소에 하드코딩하지 않는다).
- 정규화 테이블(periods, nurses 등)을 만들지 마라. 이유: ADR-014 — 병동 문서 1개로 저장한다.
- `backend/`에서 Supabase를 부르지 마라. 이유: CLAUDE.md CRITICAL 규칙.
- store나 컴포넌트에 로그인·동기화를 연결하지 마라. 이유: step 12~13의 범위다.
- 기존 테스트를 깨뜨리지 마라.
