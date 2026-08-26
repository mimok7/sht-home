begin;

-- Expose the booking platform's cruise_rate_card.id at the end of the public
-- read model. The platform must still re-read this ID and calculate the final
-- price; homepage prices are display-only.
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
  ca.image_url as cabin_image,
  rp.source_rate_id as platform_rate_card_id
from public.cruises_v2 c
join public.cruise_itineraries_v2 i on i.cruise_id = c.id
join public.cabins_v2 ca on ca.cruise_id = c.id
join public.rate_plans_v2 rp on rp.cabin_id = ca.id and rp.itinerary_id = i.id
where c.is_active = true
  and i.is_active = true
  and ca.is_active = true
  and rp.is_active = true;

grant select on public.public_cruise_recommendation_v2 to anon, authenticated;

commit;
