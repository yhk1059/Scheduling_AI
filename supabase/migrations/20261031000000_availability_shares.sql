-- 근무표당 공용 링크 하나 (ADR-021). 직원은 공용 토큰으로 명단을 읽고 이름을 고른다. 입력은 기존 직원 토큰 함수로 한다.
create table public.availability_shares (
  token uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  period_start date not null,
  locked_at timestamptz,
  unique (shop_id, period_start)
);

alter table public.availability_shares enable row level security;

create policy "availability_shares_select_own" on public.availability_shares
  for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

create policy "availability_shares_insert_own" on public.availability_shares
  for insert to authenticated
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

create policy "availability_shares_update_own" on public.availability_shares
  for update to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

create policy "availability_shares_delete_own" on public.availability_shares
  for delete to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

revoke all on public.availability_shares from anon;

-- 공용 토큰으로 명단을 돌려준다. 없으면 빈 결과다. 칸(slots)은 돌려주지 않는다.
create function public.get_availability_roster(p_token uuid)
returns table (
  shop_name text,
  period_start date,
  period_length int,
  employee_name text,
  link_token uuid,
  submitted boolean,
  locked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.shop_name, l.period_start, l.period_length, l.employee_name, l.token, l.submitted_at is not null, l.locked_at is not null
  from public.availability_shares s
  join public.availability_links l on l.shop_id = s.shop_id and l.period_start = s.period_start
  where s.token = p_token
  order by l.employee_name;
$$;

revoke all on function public.get_availability_roster(uuid) from public, anon, authenticated;
grant execute on function public.get_availability_roster(uuid) to anon, authenticated;
