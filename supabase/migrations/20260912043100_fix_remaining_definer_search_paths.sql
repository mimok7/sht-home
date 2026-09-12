-- SECURITY DEFINER routines run with elevated privileges. Pin their lookup path
-- after direct RPC access has been removed, without changing their business logic.
do $block$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    execute format(
      'alter function %s set search_path to pg_catalog, public, private',
      fn.signature
    );
  end loop;
end;
$block$;
