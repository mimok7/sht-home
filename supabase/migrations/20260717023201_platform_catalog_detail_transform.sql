begin;

-- 플랫폼의 상세 원본을 상품별로 보존하고, 전역 참조 데이터와 분리한다.
alter table public.catalog_products_v2
  drop constraint if exists catalog_products_v2_service_type_check;
alter table public.catalog_products_v2
  add constraint catalog_products_v2_service_type_check
  check (service_type in ('cruise', 'hotel', 'tour', 'vehicle', 'airport'));

create table public.catalog_product_details_v2 (
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  source text not null,
  source_table text not null,
  source_id text not null,
  detail_type text not null,
  payload jsonb not null,
  source_updated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, source_table, source_id)
);

create table public.catalog_reference_data_v2 (
  source text not null,
  source_table text not null,
  source_id text not null,
  reference_type text not null,
  payload jsonb not null,
  source_updated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, source_table, source_id)
);

create index catalog_product_details_v2_product_idx
  on public.catalog_product_details_v2 (product_id, detail_type)
  where is_active;
create index catalog_reference_data_v2_type_idx
  on public.catalog_reference_data_v2 (reference_type, source_table)
  where is_active;

alter table public.catalog_product_details_v2 enable row level security;
alter table public.catalog_reference_data_v2 enable row level security;

create policy "public reads active catalog details v2" on public.catalog_product_details_v2
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.catalog_products_v2 p
      where p.id = product_id and p.is_active
    )
  );
create policy "public reads active catalog references v2" on public.catalog_reference_data_v2
  for select to anon, authenticated using (is_active);

revoke all on public.catalog_product_details_v2 from anon, authenticated;
revoke all on public.catalog_reference_data_v2 from anon, authenticated;
grant select on public.catalog_product_details_v2 to anon, authenticated;
grant select on public.catalog_reference_data_v2 to anon, authenticated;

-- 기존 가격 중심 변환을 유지한 뒤, 상세 원본과 공항 상품까지 가공한다.
create or replace function public.refresh_platform_catalog_full_v2()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  detail_count integer;
  reference_count integer;
  product_count integer;
  price_count integer;
begin
  perform public.refresh_platform_catalog_v2();

  -- 객실별 cruise_info를 하나의 크루즈 상품으로 집계해 기본 설명과 이미지를 보강한다.
  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, description, category, image_url,
    metadata, source_updated_at, is_active
  )
  select distinct on (coalesce(nullif(r.payload ->> 'cruise_name', ''), r.payload ->> 'name'))
    'cruise', r.source,
    coalesce(nullif(r.payload ->> 'cruise_name', ''), r.payload ->> 'name'),
    coalesce(nullif(r.payload ->> 'cruise_name', ''), r.payload ->> 'name'),
    nullif(r.payload ->> 'description', ''), nullif(r.payload ->> 'category', ''),
    nullif(r.payload ->> 'cruise_image', ''),
    jsonb_build_object(
      'duration', r.payload ->> 'duration',
      'star_rating', r.payload ->> 'star_rating',
      'features', r.payload ->> 'features',
      'itinerary', r.payload ->> 'itinerary',
      'cancellation_policy', r.payload ->> 'cancellation_policy'
    ),
    r.source_updated_at, true
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'cruise_info'
    and nullif(btrim(coalesce(r.payload ->> 'cruise_name', r.payload ->> 'name', '')), '') is not null
  order by coalesce(nullif(r.payload ->> 'cruise_name', ''), r.payload ->> 'name'), r.source_updated_at desc nulls last
  on conflict (service_type, source, source_key) do update set
    name_ko = excluded.name_ko,
    description = excluded.description,
    category = excluded.category,
    image_url = excluded.image_url,
    metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  -- 공항은 공항 코드별 상품과 차량·서비스별 요금으로 가공한다.
  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, category, metadata,
    source_updated_at, is_active
  )
  select distinct on (r.payload ->> 'airport_code')
    'airport', r.source, r.payload ->> 'airport_code',
    coalesce(nullif(n.payload ->> 'airport_name', ''), r.payload ->> 'airport_code'),
    'AIRPORT', jsonb_build_object('airport_code', r.payload ->> 'airport_code'),
    r.source_updated_at, coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  left join public.platform_source_records n
    on n.source = r.source
   and n.source_table = 'airport_name'
   and n.payload ->> 'airport_code' = r.payload ->> 'airport_code'
  where r.source = 'sht-platform'
    and r.source_table = 'airport_price'
    and nullif(btrim(r.payload ->> 'airport_code'), '') is not null
  order by r.payload ->> 'airport_code', r.source_updated_at desc nulls last
  on conflict (service_type, source, source_key) do update set
    name_ko = excluded.name_ko,
    metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  insert into public.catalog_prices_v2 (
    product_id, source, source_table, source_id, label, price_amount, currency,
    price_unit, max_guests, metadata, source_updated_at, is_active
  )
  select
    p.id, r.source, r.source_table, r.source_id,
    concat_ws(' / ', nullif(r.payload ->> 'service_type', ''), nullif(r.payload ->> 'vehicle_type', '')),
    nullif(r.payload ->> 'price', '')::numeric, 'VND', 'per_vehicle',
    nullif(r.payload ->> 'max_capacity', '')::smallint,
    jsonb_build_object(
      'route', r.payload ->> 'route',
      'route_from', r.payload ->> 'route_from',
      'route_to', r.payload ->> 'route_to',
      'duration', r.payload ->> 'duration',
      'recommended_capacity', r.payload ->> 'recommended_capacity',
      'vehicle_examples', r.payload ->> 'vehicle_examples',
      'year', r.payload ->> 'year'
    ),
    r.source_updated_at, coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  join public.catalog_products_v2 p
    on p.service_type = 'airport'
   and p.source = r.source
   and p.source_key = r.payload ->> 'airport_code'
  where r.source = 'sht-platform' and r.source_table = 'airport_price'
  on conflict (source, source_table, source_id) do update set
    product_id = excluded.product_id,
    label = excluded.label,
    price_amount = excluded.price_amount,
    currency = excluded.currency,
    price_unit = excluded.price_unit,
    max_guests = excluded.max_guests,
    metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  -- 상품에 직접 연결 가능한 모든 상세 행을 보존한다.
  with mapped_details as (
    select p.id as product_id, r.source, r.source_table, r.source_id, 'cruise_info' as detail_type, r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.catalog_products_v2 p on p.service_type = 'cruise' and p.source = r.source
      and p.source_key = coalesce(nullif(r.payload ->> 'cruise_name', ''), r.payload ->> 'name')
    where r.source = 'sht-platform' and r.source_table = 'cruise_info'

    union all
    select p.id, r.source, r.source_table, r.source_id, r.source_table, r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.catalog_products_v2 p on p.service_type = 'cruise' and p.source = r.source
      and p.source_key = r.payload ->> 'cruise_name'
    where r.source = 'sht-platform'
      and r.source_table in ('cruise_rate_card', 'cruise_promotion', 'cruise_holiday_surcharge', 'cruise_tour_options', 'cruise_info_by_category', 'cruise_rooms_view')

    union all
    select p.id, r.source, r.source_table, r.source_id, 'cruise_rate_card_inclusions', r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.platform_source_records rate on rate.source = r.source and rate.source_table = 'cruise_rate_card'
      and rate.source_id = r.payload ->> 'rate_card_id'
    join public.catalog_products_v2 p on p.service_type = 'cruise' and p.source = r.source
      and p.source_key = rate.payload ->> 'cruise_name'
    where r.source = 'sht-platform' and r.source_table = 'cruise_rate_card_inclusions'

    union all
    select p.id, r.source, r.source_table, r.source_id, 'cruise_promotion_rate', r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.platform_source_records promo on promo.source = r.source and promo.source_table = 'cruise_promotion'
      and promo.source_id = r.payload ->> 'promotion_id'
    join public.catalog_products_v2 p on p.service_type = 'cruise' and p.source = r.source
      and p.source_key = promo.payload ->> 'cruise_name'
    where r.source = 'sht-platform' and r.source_table = 'cruise_promotion_rate'

    union all
    select p.id, r.source, r.source_table, r.source_id, r.source_table, r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.catalog_products_v2 p on p.service_type = 'hotel' and p.source = r.source
      and p.source_key = r.payload ->> 'hotel_code'
    where r.source = 'sht-platform' and r.source_table in ('hotel_info', 'hotel_price')

    union all
    select p.id, r.source, r.source_table, r.source_id, r.source_table, r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.catalog_products_v2 p on p.service_type = 'airport' and p.source = r.source
      and p.source_key = r.payload ->> 'airport_code'
    where r.source = 'sht-platform' and r.source_table in ('airport_name', 'airport_price')

    union all
    select p.id, r.source, r.source_table, r.source_id, r.source_table, r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.catalog_products_v2 p on p.service_type = 'tour' and p.source = r.source
      and p.source_key = r.payload ->> 'tour_id'
    where r.source = 'sht-platform'
      and r.source_table in ('tour', 'tour_pricing', 'tour_schedule', 'tour_inclusions', 'tour_exclusions', 'tour_important_info', 'tour_addon_options', 'tour_payment_pricing', 'tour_cancellation_policy', 'tour_cruise_integration')

    union all
    select p.id, r.source, r.source_table, r.source_id, r.source_table, r.payload, r.source_updated_at
    from public.platform_source_records r
    join public.catalog_products_v2 p on p.service_type = 'vehicle' and p.source = r.source
      and p.source_key = coalesce(nullif(r.payload ->> 'rent_code', ''), r.source_id)
    where r.source = 'sht-platform' and r.source_table = 'rentcar_price'
  )
  insert into public.catalog_product_details_v2 (
    product_id, source, source_table, source_id, detail_type, payload, source_updated_at, is_active
  )
  select product_id, source, source_table, source_id, detail_type, payload, source_updated_at, true
  from mapped_details
  on conflict (source, source_table, source_id) do update set
    product_id = excluded.product_id,
    detail_type = excluded.detail_type,
    payload = excluded.payload,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  -- 제품에 바로 연결되지 않는 공통 위치와 읽기 전용 뷰는 참조 데이터로 유지한다.
  insert into public.catalog_reference_data_v2 (
    source, source_table, source_id, reference_type, payload, source_updated_at, is_active
  )
  select r.source, r.source_table, r.source_id,
    case r.source_table when 'cruise_location' then 'cruise_location' when 'cruise_info_view' then 'cruise_info_view' else r.source_table end,
    r.payload, r.source_updated_at, true
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table in ('cruise_location', 'cruise_info_view')
  on conflict (source, source_table, source_id) do update set
    reference_type = excluded.reference_type,
    payload = excluded.payload,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  select count(*) into detail_count from public.catalog_product_details_v2 where source = 'sht-platform';
  select count(*) into reference_count from public.catalog_reference_data_v2 where source = 'sht-platform';
  select count(*) into product_count from public.catalog_products_v2 where source = 'sht-platform';
  select count(*) into price_count from public.catalog_prices_v2 where source = 'sht-platform';
  return jsonb_build_object('products', product_count, 'prices', price_count, 'details', detail_count, 'references', reference_count);
end;
$$;

revoke all on function public.refresh_platform_catalog_full_v2() from public;
grant execute on function public.refresh_platform_catalog_full_v2() to service_role;

-- 수신 원본이 상세 또는 참조 테이블로 모두 연결됐는지 테이블별로 점검한다.
create or replace function public.platform_catalog_v2_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with raw_counts as (
    select source_table, count(*)::integer as row_count
    from public.platform_source_records
    where source = 'sht-platform'
    group by source_table
  ), price_counts as (
    select source_table, count(*)::integer as row_count
    from public.catalog_prices_v2
    where source = 'sht-platform'
    group by source_table
  ), product_counts as (
    select service_type, count(*)::integer as row_count
    from public.catalog_products_v2
    where source = 'sht-platform'
    group by service_type
  ), detail_counts as (
    select source_table, count(*)::integer as row_count
    from public.catalog_product_details_v2
    where source = 'sht-platform'
    group by source_table
  ), reference_counts as (
    select source_table, count(*)::integer as row_count
    from public.catalog_reference_data_v2
    where source = 'sht-platform'
    group by source_table
  ), missing_prices as (
    select r.source_table, count(*)::integer as row_count
    from public.platform_source_records r
    left join public.catalog_prices_v2 p on p.source = r.source and p.source_table = r.source_table and p.source_id = r.source_id
    where r.source = 'sht-platform'
      and r.source_table in ('cruise_rate_card', 'hotel_price', 'tour_pricing', 'rentcar_price', 'airport_price')
      and p.id is null
    group by r.source_table
  ), missing_sources as (
    select r.source_table, count(*)::integer as row_count
    from public.platform_source_records r
    left join public.catalog_product_details_v2 d on d.source = r.source and d.source_table = r.source_table and d.source_id = r.source_id
    left join public.catalog_reference_data_v2 f on f.source = r.source and f.source_table = r.source_table and f.source_id = r.source_id
    where r.source = 'sht-platform' and d.product_id is null and f.source_id is null
    group by r.source_table
  )
  select jsonb_build_object(
    'rawCounts', coalesce((select jsonb_object_agg(source_table, row_count) from raw_counts), '{}'::jsonb),
    'priceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from price_counts), '{}'::jsonb),
    'productCounts', coalesce((select jsonb_object_agg(service_type, row_count) from product_counts), '{}'::jsonb),
    'detailCounts', coalesce((select jsonb_object_agg(source_table, row_count) from detail_counts), '{}'::jsonb),
    'referenceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from reference_counts), '{}'::jsonb),
    'unconvertedPriceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from missing_prices), '{}'::jsonb),
    'unconvertedSourceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from missing_sources), '{}'::jsonb),
    'latestSourceSyncAt', (select max(synced_at) from public.platform_source_records where source = 'sht-platform'),
    'latestRunAt', (select max(received_at) from public.platform_sync_runs where source = 'sht-platform')
  );
$$;

revoke all on function public.platform_catalog_v2_status() from public;
grant execute on function public.platform_catalog_v2_status() to service_role;

commit;
