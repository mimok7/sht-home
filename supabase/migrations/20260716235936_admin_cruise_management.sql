begin;

-- Administration is deliberately based on immutable app_metadata, not
-- user_metadata. Assign the role with the Supabase Admin API, for example:
-- auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } })
-- Users must sign in again (or refresh their token) after the role changes.
create or replace function public.is_cruise_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

revoke all on function public.is_cruise_admin() from public;
grant execute on function public.is_cruise_admin() to authenticated;

do $$
declare
  managed_table text;
begin
  foreach managed_table in array array[
    'cruises_v2',
    'cruise_itineraries_v2',
    'cabins_v2',
    'rate_plans_v2',
    'child_policies_v2',
    'cruise_transfers_v2',
    'cruise_tags_v2',
    'cruise_aliases_v2',
    'cabin_aliases_v2'
  ] loop
    execute format('grant select, insert, update on public.%I to authenticated', managed_table);
    execute format('drop policy if exists "cruise admins manage %s" on public.%I', managed_table, managed_table);
    execute format(
      'create policy "cruise admins manage %s" on public.%I for all to authenticated using ((select public.is_cruise_admin())) with check ((select public.is_cruise_admin()))',
      managed_table,
      managed_table
    );
  end loop;
end $$;

commit;
