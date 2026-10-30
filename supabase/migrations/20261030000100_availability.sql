-- 직원 가능 시간 링크 (ADR-020). 직원은 로그인 없이 토큰을 확인하는 함수 두 개만 호출한다.
create table public.availability_links (
  token uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  period_start date not null,
  period_length int not null check (period_length > 0),
  employee_id text not null,
  employee_name text not null,
  shop_name text not null,
  slots jsonb not null default '{}' check (octet_length(slots::text) <= 50000),
  submitted_at timestamptz,
  locked_at timestamptz,
  unique (shop_id, period_start, employee_id)
);

alter table public.availability_links enable row level security;

create policy "availability_links_select_own" on public.availability_links
  for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

create policy "availability_links_insert_own" on public.availability_links
  for insert to authenticated
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

create policy "availability_links_update_own" on public.availability_links
  for update to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

create policy "availability_links_delete_own" on public.availability_links
  for delete to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));

revoke all on public.availability_links from anon;

-- 토큰 하나로 그 직원의 칸만 돌려준다. 없으면 빈 결과다.
create function public.get_availability(p_token uuid)
returns table (
  shop_name text,
  employee_name text,
  period_start date,
  period_length int,
  slots jsonb,
  submitted_at timestamptz,
  locked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.shop_name, l.employee_name, l.period_start, l.period_length, l.slots, l.submitted_at, l.locked_at is not null
  from public.availability_links l
  where l.token = p_token;
$$;

-- slots 형식: { "2026-11-02": [["09:00", "15:00"], ...] }. 다른 칼럼은 바꾸지 않는다.
create function public.submit_availability(p_token uuid, p_slots jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_length int;
  v_locked timestamptz;
  v_day text;
  v_ranges jsonb;
  v_range jsonb;
  v_from text;
  v_to text;
  v_time constant text := '^([01][0-9]|2[0-4]):(00|30)$';
begin
  select l.period_start, l.period_length, l.locked_at into v_start, v_length, v_locked
  from public.availability_links l
  where l.token = p_token
  for update;

  if not found then
    raise exception 'availability link not found' using errcode = 'P0002';
  end if;
  if v_locked is not null then
    raise exception 'availability link is locked' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'object' then
    raise exception 'slots must be an object' using errcode = '22023';
  end if;

  for v_day, v_ranges in select key, value from jsonb_each(p_slots) loop
    if v_day !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char(to_date(v_day, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_day
      or v_day::date < v_start
      or v_day::date >= v_start + v_length then
      raise exception 'date out of period: %', v_day using errcode = '22023';
    end if;
    if jsonb_typeof(v_ranges) <> 'array' then
      raise exception 'ranges must be an array: %', v_day using errcode = '22023';
    end if;
    for v_range in select value from jsonb_array_elements(v_ranges) loop
      if jsonb_typeof(v_range) <> 'array' or jsonb_array_length(v_range) <> 2
        or jsonb_typeof(v_range -> 0) <> 'string' or jsonb_typeof(v_range -> 1) <> 'string' then
        raise exception 'range must be [from, to]: %', v_day using errcode = '22023';
      end if;
      v_from := v_range ->> 0;
      v_to := v_range ->> 1;
      if v_from !~ v_time or v_to !~ v_time or v_from < '06:00' or v_to > '24:00' or v_from >= v_to then
        raise exception 'invalid time range: % %~%', v_day, v_from, v_to using errcode = '22023';
      end if;
    end loop;
  end loop;

  update public.availability_links
  set slots = p_slots, submitted_at = now()
  where token = p_token;
end;
$$;

revoke all on function public.get_availability(uuid) from public, anon, authenticated;
revoke all on function public.submit_availability(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_availability(uuid) to anon, authenticated;
grant execute on function public.submit_availability(uuid, jsonb) to anon, authenticated;
