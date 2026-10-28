-- 병동 문서 1개(store 상태 jsonb)를 사용자마다 1행으로 저장한다 (ADR-014).
create table public.wards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null check (octet_length(data::text) <= 2000000),
  updated_at timestamptz not null default now()
);

alter table public.wards enable row level security;

create policy "wards_select_own" on public.wards
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "wards_insert_own" on public.wards
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "wards_update_own" on public.wards
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "wards_delete_own" on public.wards
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- 수정할 때마다 updated_at을 서버 시각으로 바꾼다.
create function public.wards_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger wards_set_updated_at
  before update on public.wards
  for each row execute function public.wards_set_updated_at();

revoke all on public.wards from anon;
