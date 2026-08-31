-- 서비스 추천 태그를 관리자 정의 값으로 확장하고 활성 태그만 공개한다.
begin;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.service_tags_v2'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%tag in (%';
  if constraint_name is not null then
    execute format('alter table public.service_tags_v2 drop constraint %I', constraint_name);
  end if;
end
$$;

grant select on public.service_tags_v2 to anon, authenticated;

drop policy if exists "public reads active service tags v2" on public.service_tags_v2;
create policy "public reads active service tags v2" on public.service_tags_v2
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1
      from public.catalog_products_v2 product
      where product.id = service_tags_v2.product_id
        and product.is_active
    )
  );

commit;
