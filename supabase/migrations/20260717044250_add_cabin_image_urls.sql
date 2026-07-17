begin;

-- 객실별 대표 이미지는 크루즈 대표 이미지와 별도로 관리한다. 기존 RLS와
-- 관리자 권한 정책은 cabins_v2 테이블 단위로 적용되므로 새 컬럼에도 그대로
-- 적용된다.
alter table public.cabins_v2
  add column if not exists image_url text;

-- 공개 상세 페이지가 객실의 전용 이미지를 읽을 수 있도록 기존 공개 뷰에
-- cabin_image를 추가한다. security_invoker 및 기존 활성 상태 필터는 유지한다.
create or replace view public.public_cruise_recommendation_v2
with (security_invoker = true)
as
select
  c.id as cruise_id,
  c.slug,
  c.name_ko as cruise_name,
  c.name_en as cruise_name_en,
  c.description,
  c.category,
  c.star_rating,
  c.hero_image,
  i.id as itinerary_id,
  i.schedule_type,
  i.nights,
  ca.id as cabin_id,
  ca.name_ko as cabin_name,
  ca.name_en as cabin_name_en,
  ca.room_area_text,
  ca.bed_type,
  ca.max_adults,
  ca.max_guests,
  ca.has_balcony,
  ca.is_vip,
  ca.has_butler,
  ca.is_recommended,
  ca.connecting_available,
  ca.extra_bed_available,
  ca.facilities,
  ca.special_amenities,
  rp.id as rate_plan_id,
  lower(rp.valid_during) as valid_from,
  upper(rp.valid_during) - 1 as valid_to,
  rp.price_basis,
  rp.currency,
  rp.price_adult,
  rp.price_child,
  rp.price_infant,
  rp.price_single,
  rp.price_extra_bed,
  rp.single_available,
  array(
    select tag.tag
    from public.cruise_tags_v2 tag
    where tag.cruise_id = c.id and tag.is_active = true
    order by tag.tag
  ) as tags,
  ca.image_url as cabin_image
from public.cruises_v2 c
join public.cruise_itineraries_v2 i on i.cruise_id = c.id
join public.cabins_v2 ca on ca.cruise_id = c.id
join public.rate_plans_v2 rp on rp.cabin_id = ca.id and rp.itinerary_id = i.id
where c.is_active = true
  and i.is_active = true
  and ca.is_active = true
  and rp.is_active = true;

commit;
