-- These RLS-protected internal tables had no policies, which already denied
-- client access. Record that default-deny contract explicitly without changing
-- server/service-role access or application-visible reads.
do $block$
declare
  tbl record;
begin
  for tbl in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  loop
    execute format(
      'create policy internal_no_client_access on %I.%I as restrictive for all to anon, authenticated using (false) with check (false)',
      tbl.nspname,
      tbl.relname
    );
  end loop;
end;
$block$;
