begin;

-- 공항 요금의 airport_code는 내부 식별자이며, airport_name 참조 코드와도
-- 체계가 달라 상품명으로 사용할 수 없다. 원본 요금에 이미 있는 서비스·노선·
-- 차량 정보를 이용해 사람이 읽을 수 있는 상품명을 항상 만든다.
create or replace function private.apply_airport_product_name_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  natural_name text;
begin
  if new.source = 'sht-platform'
    and new.service_type = 'airport'
    and not (new.manual_override ? 'name_ko') then
    select concat_ws(
      ' · ',
      nullif(btrim(r.payload ->> 'service_type'), ''),
      nullif(btrim(r.payload ->> 'route'), ''),
      nullif(btrim(r.payload ->> 'vehicle_type'), '')
    )
    into natural_name
    from public.platform_source_records r
    where r.source = new.source
      and r.source_table = 'airport_price'
      and r.payload ->> 'airport_code' = new.source_key
    order by r.source_updated_at desc nulls last, r.synced_at desc nulls last
    limit 1;

    if natural_name is not null and natural_name <> '' then
      new.name_ko := natural_name;
    end if;
  end if;
  return new;
end;
$$;

-- 수동으로 정한 홈페이지 상품명은 기존 수동 오버라이드 트리거가 마지막에
-- 적용되도록 이름순 실행 순서를 유지한다.
drop trigger if exists catalog_products_v2_apply_z_airport_product_name on public.catalog_products_v2;
create trigger catalog_products_v2_apply_z_airport_product_name
before insert or update on public.catalog_products_v2
for each row execute procedure private.apply_airport_product_name_v2();

-- 이미 동기화된 공항 상품도 같은 규칙을 즉시 적용한다.
update public.catalog_products_v2
set updated_at = now()
where source = 'sht-platform'
  and service_type = 'airport'
  and not (manual_override ? 'name_ko');

commit;
