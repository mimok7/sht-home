begin;

-- 플랫폼 원본을 홈페이지 상품 화면에서 공통으로 사용할 v2 카탈로그로 가공한다.
-- 기존 cruises_v2 등 관리자가 직접 편집하는 데이터는 이 동기화로 변경하지 않는다.
create table public.catalog_products_v2 (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (service_type in ('cruise', 'hotel', 'tour', 'vehicle')),
  source text not null,
  source_key text not null,
  name_ko text not null,
  description text,
  category text,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_type, source, source_key)
);

create table public.catalog_prices_v2 (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  source text not null,
  source_table text not null,
  source_id text not null,
  label text,
  price_amount numeric(14, 2) check (price_amount is null or price_amount >= 0),
  currency text not null default 'VND',
  price_unit text not null check (price_unit in ('per_adult', 'per_person', 'per_room', 'per_vehicle', 'unknown')),
  min_guests smallint check (min_guests is null or min_guests > 0),
  max_guests smallint check (max_guests is null or max_guests > 0),
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_table, source_id),
  check (valid_from is null or valid_to is null or valid_from <= valid_to),
  check (min_guests is null or max_guests is null or min_guests <= max_guests)
);

create index catalog_products_v2_service_active_idx
  on public.catalog_products_v2 (service_type, name_ko)
  where is_active;
create index catalog_prices_v2_product_active_idx
  on public.catalog_prices_v2 (product_id, valid_from, valid_to)
  where is_active;

alter table public.catalog_products_v2 enable row level security;
alter table public.catalog_prices_v2 enable row level security;

create policy "public reads active catalog products v2" on public.catalog_products_v2
  for select to anon, authenticated using (is_active);
create policy "public reads active catalog prices v2" on public.catalog_prices_v2
  for select to anon, authenticated using (is_active);

revoke all on public.catalog_products_v2 from anon, authenticated;
revoke all on public.catalog_prices_v2 from anon, authenticated;
grant select on public.catalog_products_v2 to anon, authenticated;
grant select on public.catalog_prices_v2 to anon, authenticated;

-- 이 함수는 홈페이지 수신 API의 service_role만 실행한다. 공개 클라이언트에는
-- 권한을 주지 않으므로 원본 JSON을 임의로 홈페이지 상품으로 만들 수 없다.
create or replace function public.refresh_platform_catalog_v2()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  product_count integer;
  price_count integer;
begin
  if to_regclass('public.platform_source_records') is null then
    raise exception 'platform_source_records 테이블이 필요합니다';
  end if;

  -- 호텔 기본 정보가 있으면 이를 우선 사용하고, 요금만 있는 호텔은 이름을
  -- 보존한 최소 상품으로 생성한다.
  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, description, category,
    metadata, source_updated_at, is_active
  )
  select
    'hotel', r.source, r.payload ->> 'hotel_code', r.payload ->> 'hotel_name',
    nullif(r.payload ->> 'notes', ''), nullif(r.payload ->> 'product_type', ''),
    jsonb_build_object('location', r.payload ->> 'location', 'star_rating', r.payload ->> 'star_rating'),
    r.source_updated_at,
    coalesce((r.payload ->> 'active')::boolean, true)
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'hotel_info'
    and nullif(btrim(r.payload ->> 'hotel_code'), '') is not null
    and nullif(btrim(r.payload ->> 'hotel_name'), '') is not null
  on conflict (service_type, source, source_key) do update set
    name_ko = excluded.name_ko,
    description = excluded.description,
    category = excluded.category,
    metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, category, source_updated_at, is_active
  )
  select distinct on (r.payload ->> 'hotel_code')
    'hotel', r.source, r.payload ->> 'hotel_code', r.payload ->> 'hotel_name',
    'HOTEL', r.source_updated_at, true
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'hotel_price'
    and nullif(btrim(r.payload ->> 'hotel_code'), '') is not null
    and nullif(btrim(r.payload ->> 'hotel_name'), '') is not null
  order by r.payload ->> 'hotel_code', r.source_updated_at desc nulls last
  on conflict (service_type, source, source_key) do nothing;

  -- 투어 상세 정보가 없는 요금은 관리자 검토 전까지 비활성 초안으로 보관한다.
  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, description, category, image_url,
    metadata, source_updated_at, is_active
  )
  select
    'tour', r.source, r.payload ->> 'tour_id', r.payload ->> 'tour_name',
    coalesce(nullif(r.payload ->> 'description', ''), nullif(r.payload ->> 'overview', '')),
    nullif(r.payload ->> 'category', ''), nullif(r.payload ->> 'image_url', ''),
    jsonb_build_object('duration', r.payload ->> 'duration', 'location', r.payload ->> 'location'),
    r.source_updated_at,
    coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'tour'
    and nullif(btrim(r.payload ->> 'tour_id'), '') is not null
    and nullif(btrim(r.payload ->> 'tour_name'), '') is not null
  on conflict (service_type, source, source_key) do update set
    name_ko = excluded.name_ko,
    description = excluded.description,
    category = excluded.category,
    image_url = excluded.image_url,
    metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, category, source_updated_at, is_active
  )
  select distinct on (r.payload ->> 'tour_id')
    'tour', r.source, r.payload ->> 'tour_id',
    '투어 정보 확인 필요', 'TOUR', r.source_updated_at, false
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'tour_pricing'
    and nullif(btrim(r.payload ->> 'tour_id'), '') is not null
  order by r.payload ->> 'tour_id', r.source_updated_at desc nulls last
  on conflict (service_type, source, source_key) do nothing;

  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, category, metadata,
    source_updated_at, is_active
  )
  select distinct on (r.payload ->> 'cruise_name')
    'cruise', r.source, r.payload ->> 'cruise_name', r.payload ->> 'cruise_name',
    'CRUISE', jsonb_build_object('source', 'cruise_rate_card'), r.source_updated_at,
    coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'cruise_rate_card'
    and nullif(btrim(r.payload ->> 'cruise_name'), '') is not null
  order by r.payload ->> 'cruise_name', r.source_updated_at desc nulls last
  on conflict (service_type, source, source_key) do update set
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  insert into public.catalog_products_v2 (
    service_type, source, source_key, name_ko, description, category, metadata,
    source_updated_at, is_active
  )
  select distinct on (coalesce(nullif(r.payload ->> 'rent_code', ''), r.source_id))
    'vehicle', r.source, coalesce(nullif(r.payload ->> 'rent_code', ''), r.source_id),
    concat_ws(' ', nullif(r.payload ->> 'vehicle_type', ''), nullif(r.payload ->> 'route', '')),
    nullif(r.payload ->> 'description', ''), nullif(r.payload ->> 'category', ''),
    jsonb_build_object('capacity', r.payload ->> 'capacity', 'way_type', r.payload ->> 'way_type'),
    r.source_updated_at, coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  where r.source = 'sht-platform'
    and r.source_table = 'rentcar_price'
    and nullif(btrim(coalesce(r.payload ->> 'vehicle_type', r.payload ->> 'route', '')), '') is not null
  order by coalesce(nullif(r.payload ->> 'rent_code', ''), r.source_id), r.source_updated_at desc nulls last
  on conflict (service_type, source, source_key) do update set
    name_ko = excluded.name_ko,
    description = excluded.description,
    category = excluded.category,
    metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

  insert into public.catalog_prices_v2 (
    product_id, source, source_table, source_id, label, price_amount, currency,
    price_unit, valid_from, valid_to, metadata, source_updated_at, is_active
  )
  select
    p.id, r.source, r.source_table, r.source_id,
    concat_ws(' / ', nullif(r.payload ->> 'schedule_type', ''), nullif(r.payload ->> 'room_type', '')),
    nullif(r.payload ->> 'price_adult', '')::numeric, coalesce(nullif(r.payload ->> 'currency', ''), 'VND'),
    'per_adult', nullif(r.payload ->> 'valid_from', '')::date, nullif(r.payload ->> 'valid_to', '')::date,
    jsonb_build_object('room_type_en', r.payload ->> 'room_type_en', 'season_name', r.payload ->> 'season_name'),
    r.source_updated_at, coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  join public.catalog_products_v2 p
    on p.service_type = 'cruise' and p.source = r.source and p.source_key = r.payload ->> 'cruise_name'
  where r.source = 'sht-platform' and r.source_table = 'cruise_rate_card'
  on conflict (source, source_table, source_id) do update set
    product_id = excluded.product_id, label = excluded.label, price_amount = excluded.price_amount,
    currency = excluded.currency, price_unit = excluded.price_unit, valid_from = excluded.valid_from,
    valid_to = excluded.valid_to, metadata = excluded.metadata, source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active, updated_at = now();

  insert into public.catalog_prices_v2 (
    product_id, source, source_table, source_id, label, price_amount, currency,
    price_unit, valid_from, valid_to, metadata, source_updated_at, is_active
  )
  select
    p.id, r.source, r.source_table, r.source_id,
    concat_ws(' / ', nullif(r.payload ->> 'room_type', ''), nullif(r.payload ->> 'room_name', '')),
    nullif(r.payload ->> 'base_price', '')::numeric, 'VND', 'per_room',
    nullif(r.payload ->> 'start_date', '')::date, nullif(r.payload ->> 'end_date', '')::date,
    jsonb_build_object('season_name', r.payload ->> 'season_name'), r.source_updated_at, true
  from public.platform_source_records r
  join public.catalog_products_v2 p
    on p.service_type = 'hotel' and p.source = r.source and p.source_key = r.payload ->> 'hotel_code'
  where r.source = 'sht-platform' and r.source_table = 'hotel_price'
  on conflict (source, source_table, source_id) do update set
    product_id = excluded.product_id, label = excluded.label, price_amount = excluded.price_amount,
    currency = excluded.currency, price_unit = excluded.price_unit, valid_from = excluded.valid_from,
    valid_to = excluded.valid_to, metadata = excluded.metadata, source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active, updated_at = now();

  insert into public.catalog_prices_v2 (
    product_id, source, source_table, source_id, price_amount, currency, price_unit,
    min_guests, max_guests, valid_from, valid_to, metadata, source_updated_at, is_active
  )
  select
    p.id, r.source, r.source_table, r.source_id,
    nullif(r.payload ->> 'price_per_person', '')::numeric, 'VND', 'per_person',
    nullif(r.payload ->> 'min_guests', '')::smallint, nullif(r.payload ->> 'max_guests', '')::smallint,
    nullif(r.payload ->> 'valid_from', '')::date, nullif(r.payload ->> 'valid_until', '')::date,
    jsonb_build_object('vehicle_type', r.payload ->> 'vehicle_type'), r.source_updated_at,
    coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  join public.catalog_products_v2 p
    on p.service_type = 'tour' and p.source = r.source and p.source_key = r.payload ->> 'tour_id'
  where r.source = 'sht-platform' and r.source_table = 'tour_pricing'
  on conflict (source, source_table, source_id) do update set
    product_id = excluded.product_id, price_amount = excluded.price_amount, currency = excluded.currency,
    price_unit = excluded.price_unit, min_guests = excluded.min_guests, max_guests = excluded.max_guests,
    valid_from = excluded.valid_from, valid_to = excluded.valid_to, metadata = excluded.metadata,
    source_updated_at = excluded.source_updated_at, is_active = excluded.is_active, updated_at = now();

  insert into public.catalog_prices_v2 (
    product_id, source, source_table, source_id, label, price_amount, currency,
    price_unit, max_guests, metadata, source_updated_at, is_active
  )
  select
    p.id, r.source, r.source_table, r.source_id, nullif(r.payload ->> 'route', ''),
    nullif(r.payload ->> 'price', '')::numeric, 'VND', 'per_vehicle',
    nullif(r.payload ->> 'capacity', '')::smallint,
    jsonb_build_object('route_from', r.payload ->> 'route_from', 'route_to', r.payload ->> 'route_to'),
    r.source_updated_at, coalesce((r.payload ->> 'is_active')::boolean, true)
  from public.platform_source_records r
  join public.catalog_products_v2 p
    on p.service_type = 'vehicle'
   and p.source = r.source
   and p.source_key = coalesce(nullif(r.payload ->> 'rent_code', ''), r.source_id)
  where r.source = 'sht-platform' and r.source_table = 'rentcar_price'
  on conflict (source, source_table, source_id) do update set
    product_id = excluded.product_id, label = excluded.label, price_amount = excluded.price_amount,
    currency = excluded.currency, price_unit = excluded.price_unit, max_guests = excluded.max_guests,
    metadata = excluded.metadata, source_updated_at = excluded.source_updated_at,
    is_active = excluded.is_active, updated_at = now();

  select count(*) into product_count from public.catalog_products_v2 where source = 'sht-platform';
  select count(*) into price_count from public.catalog_prices_v2 where source = 'sht-platform';
  return jsonb_build_object('products', product_count, 'prices', price_count);
end;
$$;

revoke all on function public.refresh_platform_catalog_v2() from public;
grant execute on function public.refresh_platform_catalog_v2() to service_role;

commit;
