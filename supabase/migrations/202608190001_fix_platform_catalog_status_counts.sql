-- 홈페이지 카탈로그 변환 현황에서 보조자료를 미변환 경고와 분리한다.
begin;

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
  ), supplemental_counts as (
    select source_table, count(*)::integer as row_count
    from public.platform_source_records
    where source = 'sht-platform'
      and source_table in (
        'airport_name',
        'homepage_cruise_content', 'homepage_cruise_itineraries', 'homepage_cruise_tags',
        'homepage_cruise_images', 'homepage_cruise_cabin_overrides',
        'homepage_catalog_product_overrides', 'homepage_catalog_price_overrides'
      )
    group by source_table
  ), missing_prices as (
    select r.source_table, count(*)::integer as row_count
    from public.platform_source_records r
    left join public.catalog_prices_v2 p
      on p.source = r.source
     and p.source_table = r.source_table
     and p.source_id = r.source_id
    where r.source = 'sht-platform'
      and r.source_table in ('cruise_rate_card', 'hotel_price', 'tour_pricing', 'rentcar_price', 'airport_price')
      and p.id is null
    group by r.source_table
  ), missing_sources as (
    select r.source_table, count(*)::integer as row_count
    from public.platform_source_records r
    left join public.catalog_product_details_v2 d
      on d.source = r.source
     and d.source_table = r.source_table
     and d.source_id = r.source_id
    left join public.catalog_reference_data_v2 f
      on f.source = r.source
     and f.source_table = r.source_table
     and f.source_id = r.source_id
    where r.source = 'sht-platform'
      and r.source_table in (
        'cruise_info', 'cruise_rate_card', 'cruise_rate_card_inclusions', 'cruise_location',
        'cruise_promotion', 'cruise_promotion_rate', 'cruise_holiday_surcharge', 'cruise_tour_options',
        'cruise_info_by_category', 'cruise_info_view', 'cruise_rooms_view',
        'hotel_info', 'hotel_price', 'airport_price',
        'tour', 'tour_pricing', 'tour_schedule', 'tour_inclusions', 'tour_exclusions',
        'tour_important_info', 'tour_addon_options', 'tour_payment_pricing',
        'tour_cancellation_policy', 'tour_cruise_integration', 'rentcar_price'
      )
      and d.product_id is null
      and f.source_id is null
    group by r.source_table
  )
  select jsonb_build_object(
    'rawCounts', coalesce((select jsonb_object_agg(source_table, row_count) from raw_counts), '{}'::jsonb),
    'priceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from price_counts), '{}'::jsonb),
    'productCounts', coalesce((select jsonb_object_agg(service_type, row_count) from product_counts), '{}'::jsonb),
    'detailCounts', coalesce((select jsonb_object_agg(source_table, row_count) from detail_counts), '{}'::jsonb),
    'referenceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from reference_counts), '{}'::jsonb),
    'supplementalCounts', coalesce((select jsonb_object_agg(source_table, row_count) from supplemental_counts), '{}'::jsonb),
    'unconvertedPriceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from missing_prices), '{}'::jsonb),
    'unconvertedSourceCounts', coalesce((select jsonb_object_agg(source_table, row_count) from missing_sources), '{}'::jsonb),
    'latestSourceSyncAt', (select max(synced_at) from public.platform_source_records where source = 'sht-platform'),
    'latestRunAt', (select max(received_at) from public.platform_sync_runs where source = 'sht-platform')
  );
$$;

revoke all on function public.platform_catalog_v2_status() from public, anon, authenticated;
grant execute on function public.platform_catalog_v2_status() to service_role;

commit;
