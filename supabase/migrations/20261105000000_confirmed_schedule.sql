-- 공용 토큰으로 그 근무표의 마지막 확정본을 돌려준다(ADR-021의 공용 링크, 직원 확정 근무표 열람).
-- shops.data(state.periods[])에서 period_start가 같고 status가 'confirmed'이며 versions가 있는 근무표를 찾는다. 없으면 빈 결과다.
-- rows는 [{ "name": 직원 이름, "codes": [코드, …] }] (확정 시점 snapshot.employees 순서, 배정이 있는 직원만). 직원 id는 돌려주지 않는다.
-- 확정본을 따로 저장하지 않고 문서에서 읽으므로 [다시 확정]도 그대로 반영된다. 잠김(locked_at)은 보지 않는다(확정 상태가 기준).
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    sh.data #>> '{state,shop,name}',
    s.period_start,
    (p.value->>'length')::int,
    (v.value->>'confirmed_at')::timestamptz,
    coalesce(p.value->'holidays', '[]'::jsonb),
    coalesce(sh.data #> '{state,shop,config,shifts}', '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', e.value->>'name', 'codes', v.value->'assignments'->(e.value->>'id')) order by e.ord)
      from jsonb_array_elements(coalesce(p.value #> '{snapshot,employees}', sh.data #> '{state,shop,employees}', '[]'::jsonb)) with ordinality as e(value, ord)
      where v.value->'assignments' ? (e.value->>'id')
    ), '[]'::jsonb)
  from public.availability_shares s
  join public.shops sh on sh.id = s.shop_id
  cross join lateral jsonb_array_elements(coalesce(sh.data #> '{state,periods}', '[]'::jsonb)) as p(value)
  cross join lateral (select p.value->'versions'->(jsonb_array_length(p.value->'versions') - 1) as value) v
  where s.token = p_token
    and p.value->>'start_date' = s.period_start::text
    and p.value->>'status' = 'confirmed'
    and jsonb_array_length(coalesce(p.value->'versions', '[]'::jsonb)) > 0
  limit 1;
$$;

revoke all on function public.get_confirmed_schedule(uuid) from public, anon, authenticated;
grant execute on function public.get_confirmed_schedule(uuid) to anon, authenticated;
