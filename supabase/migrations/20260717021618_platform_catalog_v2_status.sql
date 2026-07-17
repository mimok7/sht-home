begin;

-- 플랫폼 원본과 홈페이지 v2 카탈로그의 변환 현황을 관리자 서버에 제공한다.
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
  ), missing_prices as (
    select r.source_table, count(*)::integer as row_count
    from public.platform_source_records r
    left join public.catalog_prices_v2 p
      on p.source = r.source
     and p.source_table = r.source_table
     and p.source_id = r.source_id
    where r.source = 'sht-platform'
      and r.source_table in ('cruise_rate_card', 'hotel_price', 'tour_pricing', 'rentcar_price')
      and p.id is null
    group by r.source_table
  )
  select jsonb_build_object(
    'rawCounts', coalesce((select jsonb_object_agg(source_table, row_count) from raw_counts), '{}'::jsonb),
    'priceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from price_counts), '{}'::jsonb),
    'productCounts', coalesce((select jsonb_object_agg(service_type, row_count) from product_counts), '{}'::jsonb),
    'unconvertedPriceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from missing_prices), '{}'::jsonb),
    'latestSourceSyncAt', (select max(synced_at) from public.platform_source_records where source = 'sht-platform'),
    'latestRunAt', (select max(received_at) from public.platform_sync_runs where source = 'sht-platform')
  );
$$;

revoke all on function public.platform_catalog_v2_status() from public;
grant execute on function public.platform_catalog_v2_status() to service_role;

commit;
