begin;

-- The legacy rate table is not exposed to the browser. This private function
-- gives only authorised administrators a compact list of product names that
-- have rate data but no v2 cruise/alias yet.
create or replace function private.list_unmapped_rate_cruises_v2()
returns table (
  legacy_name text,
  rate_count bigint,
  schedule_types text[]
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    r.cruise_name as legacy_name,
    count(*) as rate_count,
    array_agg(distinct r.schedule_type order by r.schedule_type) as schedule_types
  from public.cruise_rate_card r
  left join public.cruise_aliases_v2 a on a.alias = r.cruise_name
  left join public.cruises_v2 c on c.legacy_name = r.cruise_name
  where (select public.is_cruise_admin())
    and nullif(btrim(r.cruise_name), '') is not null
    and a.cruise_id is null
    and c.id is null
  group by r.cruise_name
  order by r.cruise_name;
$$;

grant usage on schema private to authenticated;
revoke all on function private.list_unmapped_rate_cruises_v2() from public;
grant execute on function private.list_unmapped_rate_cruises_v2() to authenticated;

create or replace function public.admin_unmapped_rate_cruises_v2()
returns table (
  legacy_name text,
  rate_count bigint,
  schedule_types text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_unmapped_rate_cruises_v2();
$$;

revoke all on function public.admin_unmapped_rate_cruises_v2() from public;
grant execute on function public.admin_unmapped_rate_cruises_v2() to authenticated;

commit;
