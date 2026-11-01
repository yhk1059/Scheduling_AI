-- 직원 화면 "매장 근무조" 카드(UI_GUIDE 직원 가능 시간 입력): 공용 링크 명단에 매장의 근무조를 함께 돌려준다.
-- 휴무(O)·꺼진 근무조·복합 코드는 뺀다. 토큰 검증과 다른 열은 그대로다. 반환 열이 늘어 함수를 다시 만든다.
drop function public.get_availability_roster(uuid);

create function public.get_availability_roster(p_token uuid)
returns table (
  shop_name text,
  period_start date,
  period_length int,
  employee_name text,
  link_token uuid,
  submitted boolean,
  locked boolean,
  shifts jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.shop_name, l.period_start, l.period_length, l.employee_name, l.token, l.submitted_at is not null, l.locked_at is not null,
    coalesce((
      select jsonb_agg(jsonb_build_object('code', d.value->>'code', 'name', d.value->>'name', 'start', d.value->>'start', 'end', d.value->>'end') order by d.ord)
      from jsonb_array_elements(coalesce(sh.data #> '{state,shop,config,shifts}', '[]'::jsonb)) with ordinality as d(value, ord)
      where coalesce((d.value->>'active')::boolean, true)
        and d.value->>'code' <> 'O'
        and coalesce(jsonb_array_length(d.value->'parts'), 0) = 0
    ), '[]'::jsonb)
  from public.availability_shares s
  join public.availability_links l on l.shop_id = s.shop_id and l.period_start = s.period_start
  join public.shops sh on sh.id = s.shop_id
  where s.token = p_token
  order by l.employee_name;
$$;

revoke all on function public.get_availability_roster(uuid) from public, anon, authenticated;
grant execute on function public.get_availability_roster(uuid) to anon, authenticated;
