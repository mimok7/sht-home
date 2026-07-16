begin;

-- Execute this migration as one complete file so the transaction can roll back
-- all backfill writes together if a validation check fails.
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.cruise_info') is null
    or to_regclass('public.cruise_rate_card') is null then
    raise exception 'Legacy cruise tables are missing';
  end if;

  if to_regclass('public.cruises_v2') is null
    or to_regclass('public.public_cruise_recommendation_v2') is null then
    raise exception 'Run 202607160001_cruise_recommendation_v2.sql first';
  end if;
end $$;

-- One cruise_info row represents one cabin, so cruise-level values are picked
-- deterministically from the first populated row. The hash suffix prevents
-- collisions such as the two legacy products named "Ambassador Cruise".
with cruise_source as (
  select
    cruise_name,
    (array_agg(name order by display_order nulls last, id) filter (where nullif(btrim(name), '') is not null))[1] as name_en,
    (array_agg(description order by display_order nulls last, id) filter (where nullif(btrim(description), '') is not null))[1] as description,
    (array_agg(category order by display_order nulls last, id) filter (where nullif(btrim(category), '') is not null))[1] as category,
    (array_agg(star_rating order by display_order nulls last, id) filter (where nullif(btrim(star_rating), '') is not null))[1] as rating_text,
    (array_agg(cruise_image order by display_order nulls last, id) filter (where nullif(btrim(cruise_image), '') is not null))[1] as hero_image
  from public.cruise_info
  where nullif(btrim(cruise_name), '') is not null
  group by cruise_name
), prepared as (
  select
    *,
    nullif(regexp_replace(coalesce(rating_text, ''), '[^0-9.]', '', 'g'), '') as rating_number,
    coalesce(
      nullif(trim(both '-' from lower(regexp_replace(coalesce(name_en, ''), '[^a-zA-Z0-9]+', '-', 'g'))), ''),
      'cruise'
    ) || '-' || substr(md5(cruise_name), 1, 8) as generated_slug,
    'LEGACY-' || upper(substr(md5(cruise_name), 1, 12)) as generated_code
  from cruise_source
)
insert into public.cruises_v2 (
  legacy_name,
  slug,
  code,
  name_ko,
  name_en,
  description,
  category,
  star_rating,
  hero_image,
  is_active
)
select
  cruise_name,
  generated_slug,
  generated_code,
  cruise_name,
  name_en,
  description,
  category,
  case
    when rating_number ~ '^[0-9]+([.][0-9]+)?$'
      and rating_number::numeric between 0 and 5
      then rating_number::numeric(2, 1)
    else null
  end,
  hero_image,
  true
from prepared
on conflict (legacy_name) do update set
  name_ko = excluded.name_ko,
  name_en = excluded.name_en,
  description = excluded.description,
  category = excluded.category,
  star_rating = excluded.star_rating,
  hero_image = excluded.hero_image,
  is_active = excluded.is_active,
  updated_at = now();

-- Korean source names are authoritative aliases.
insert into public.cruise_aliases_v2 (alias, cruise_id)
select c.legacy_name, c.id
from public.cruises_v2 c
where c.legacy_name is not null
on conflict (alias) do update set cruise_id = excluded.cruise_id;

-- Only globally unique English names can be safe aliases.
with unique_english_names as (
  select name
  from public.cruise_info
  where nullif(btrim(name), '') is not null
  group by name
  having count(distinct cruise_name) = 1
)
insert into public.cruise_aliases_v2 (alias, cruise_id)
select distinct i.name, c.id
from public.cruise_info i
join unique_english_names u on u.name = i.name
join public.cruises_v2 c on c.legacy_name = i.cruise_name
on conflict (alias) do update set cruise_id = excluded.cruise_id;

-- Legacy cruise_code values identify cabin rows, but are still useful lookup
-- aliases for resolving the parent cruise.
insert into public.cruise_aliases_v2 (alias, cruise_id)
select distinct i.cruise_code, c.id
from public.cruise_info i
join public.cruises_v2 c on c.legacy_name = i.cruise_name
where nullif(btrim(i.cruise_code), '') is not null
on conflict (alias) do update set cruise_id = excluded.cruise_id;

-- One obvious legacy spelling variant has complete detail under the longer name.
insert into public.cruise_aliases_v2 (alias, cruise_id)
select '아테나 프리미엄', id
from public.cruises_v2
where legacy_name = '아테나 프리미엄 크루즈'
on conflict (alias) do update set cruise_id = excluded.cruise_id;

insert into public.cruise_itineraries_v2 (
  cruise_id,
  schedule_type,
  nights,
  is_active
)
select
  ca.cruise_id,
  r.schedule_type,
  case r.schedule_type when 'DAY' then 0 when '1N2D' then 1 else 2 end,
  bool_or(coalesce(r.is_active, false))
from public.cruise_rate_card r
join public.cruise_aliases_v2 ca on ca.alias = r.cruise_name
where r.schedule_type in ('DAY', '1N2D', '2N3D')
group by ca.cruise_id, r.schedule_type
on conflict (cruise_id, schedule_type) do update set
  nights = excluded.nights,
  is_active = excluded.is_active,
  updated_at = now();

with cabin_source as (
  select
    c.id as cruise_id,
    i.room_name,
    (array_agg(i.room_area order by i.display_order nulls last, i.id) filter (where nullif(btrim(i.room_area), '') is not null))[1] as room_area_text,
    (array_agg(i.bed_type order by i.display_order nulls last, i.id) filter (where nullif(btrim(i.bed_type), '') is not null))[1] as bed_type,
    greatest(max(i.max_adults), 1)::smallint as max_adults,
    greatest(max(i.max_guests), max(i.max_adults), 1)::smallint as max_guests,
    coalesce(bool_or(i.has_balcony), false) as has_balcony,
    coalesce(bool_or(i.is_vip), false) as is_vip,
    coalesce(bool_or(i.has_butler), false) as has_butler,
    coalesce(bool_or(i.is_recommended), false) as is_recommended,
    coalesce(bool_or(i.connecting_available), false) as connecting_available,
    coalesce(bool_or(i.extra_bed_available), false) as extra_bed_available,
    (array_agg(i.facilities order by i.display_order nulls last, i.id) filter (where nullif(btrim(i.facilities), '') is not null))[1] as facilities,
    (array_agg(i.special_amenities order by i.display_order nulls last, i.id) filter (where nullif(btrim(i.special_amenities), '') is not null))[1] as special_amenities
  from public.cruise_info i
  join public.cruises_v2 c on c.legacy_name = i.cruise_name
  where nullif(btrim(i.room_name), '') is not null
    and coalesce(i.max_adults, 0) > 0
  group by c.id, i.room_name
)
insert into public.cabins_v2 (
  cruise_id,
  legacy_room_name,
  name_ko,
  room_area_text,
  bed_type,
  max_adults,
  max_guests,
  has_balcony,
  is_vip,
  has_butler,
  is_recommended,
  connecting_available,
  extra_bed_available,
  facilities,
  special_amenities,
  is_active
)
select
  cruise_id,
  room_name,
  room_name,
  room_area_text,
  bed_type,
  max_adults,
  max_guests,
  has_balcony,
  is_vip,
  has_butler,
  is_recommended,
  connecting_available,
  extra_bed_available,
  facilities,
  special_amenities,
  true
from cabin_source
on conflict (cruise_id, name_ko) do update set
  legacy_room_name = excluded.legacy_room_name,
  room_area_text = excluded.room_area_text,
  bed_type = excluded.bed_type,
  max_adults = excluded.max_adults,
  max_guests = excluded.max_guests,
  has_balcony = excluded.has_balcony,
  is_vip = excluded.is_vip,
  has_butler = excluded.has_butler,
  is_recommended = excluded.is_recommended,
  connecting_available = excluded.connecting_available,
  extra_bed_available = excluded.extra_bed_available,
  facilities = excluded.facilities,
  special_amenities = excluded.special_amenities,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.cabin_aliases_v2 (cruise_id, alias, cabin_id)
select cruise_id, legacy_room_name, id
from public.cabins_v2
where legacy_room_name is not null
on conflict (cruise_id, alias) do update set cabin_id = excluded.cabin_id;

-- Manual aliases cover known legacy marketing/payment labels that cannot be
-- inferred safely from substring matching. Unlisted products without cabin
-- detail are deliberately excluded from the first recommendation release.
with manual_room_alias (cruise_alias, rate_alias, cabin_name) as (
values
  ('그랜드 파이어니스 크루즈', 'Ocean Suite Room', 'Ocean Suite'),
  ('그랜드 파이어니스 크루즈', 'The Ornus Suite 2pax', 'The Owns Suite'),
  ('그랜드 파이어니스 크루즈', 'The Ornus Suite 3pax', 'The Owns Suite'),
  ('그랜드 파이어니스 크루즈', 'The Ornus Suite 4pax', 'The Owns Suite'),
  ('사퀼라 요트 크루즈', 'Saquila Yacht One-Day Tour', '성인'),
  ('아테나 프리미엄', 'Athena Ocean View', '아테나 오션뷰'),
  ('아테나 프리미엄', 'Executive Balcony', '이그제큐티브 발코니'),
  ('아테나 프리미엄', 'Triple Balcony', '트리플 발코니'),
  ('아테나 프리미엄', 'Connecting Balcony', '커넥팅 발코니'),
  ('아테나 프리미엄', 'Premium Balcony', '프리미엄 발코니'),
  ('아테나 프리미엄', 'Captain View Suite', '캡틴 뷰 스위트'),
  ('아테나 프리미엄', 'Elite Suite', '엘리트 스위트'),
  ('엠바사더 당일 크루즈', 'Ambassador One-Day Tour', '크루즈 티켓 (이동차량 제외)'),
  ('엠바사더 당일 크루즈', 'Ambassador One-Day Tour + Limousine', '엠바사더 리무진 패키지 (차량 포함)'),
  ('엠바사더 당일 크루즈', 'Ambassador One-Day Tour (Limousine Package)', '엠바사더 리무진 패키지 (차량 포함)'),
  ('엠바사더 시그니처', 'Balcony A Promo', '발코니'),
  ('엠바사더 시그니처', 'Balcony B Promo', '발코니'),
  ('엠바사더 오버나이트', 'Deluxe A Promo', '디럭스룸'),
  ('엠바사더 오버나이트', 'Deluxe B Promo', '디럭스룸'),
  ('인도차이나 그랜드 크루즈', 'Suite', '스위트룸'),
  ('인도차이나 그랜드 크루즈', 'Executive Suite', '이그제큐티브 스위트룸'),
  ('인도차이나 그랜드 크루즈', 'President Suite', '프레지던트룸'),
  ('파라다이스 레거시 크루즈', '디럭스 A', '디럭스 발코니'),
  ('파라다이스 레거시 크루즈', '디럭스 B', '디럭스 발코니'),
  ('파라다이스 레거시 크루즈', '디럭스 C', '디럭스 발코니'),
  ('파라다이스 레거시 크루즈', '이그제큐티브 A', '이그제큐티브 발코니'),
  ('파라다이스 레거시 크루즈', '이그제큐티브 B', '이그제큐티브 발코니'),
  ('파라다이스 레거시 크루즈', '이그제큐티브 C', '이그제큐티브 발코니'),
  ('파라다이스 레거시 크루즈', '레거시 스위트 A', '레거시 스위트'),
  ('파라다이스 레거시 크루즈', '레거시 스위트 B', '레거시 스위트'),
  ('파라다이스 레거시 크루즈', '레거시 스위트 C', '레거시 스위트'),
  ('할로라 크루즈', 'Deluxe Room', '디럭스 발코니 오션뷰'),
  ('할로라 크루즈', 'Premium Room', '프리미엄 발코니 오션뷰'),
  ('할로라 크루즈', 'Premium Triple Room', '프리미엄 발코니 오션뷰'),
  ('할로라 크루즈', 'Suite Room', '할로라 스위트')
), rate_source as (
  select
    r.*,
    ca.cruise_id,
    i.id as itinerary_id,
    lower(regexp_replace(regexp_replace(coalesce(r.room_type, ''), '\([^)]*\)', '', 'g'), '[^a-zA-Z0-9가-힣]', '', 'g')) as room_ko_norm,
    lower(regexp_replace(regexp_replace(coalesce(r.room_type_en, ''), '\([^)]*\)', '', 'g'), '[^a-zA-Z0-9가-힣]', '', 'g')) as room_en_norm
  from public.cruise_rate_card r
  join public.cruise_aliases_v2 ca on ca.alias = r.cruise_name
  join public.cruise_itineraries_v2 i
    on i.cruise_id = ca.cruise_id
   and i.schedule_type = r.schedule_type
  where r.schedule_type in ('DAY', '1N2D', '2N3D')
    and r.valid_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and r.valid_to ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and r.valid_from::date <= r.valid_to::date
), cabin_source as (
  select
    c.*,
    lower(regexp_replace(regexp_replace(coalesce(c.legacy_room_name, c.name_ko, ''), '\([^)]*\)', '', 'g'), '[^a-zA-Z0-9가-힣]', '', 'g')) as cabin_norm
  from public.cabins_v2 c
), manual_match as (
  select distinct on (r.id)
    r.id as source_rate_id,
    c.id as cabin_id,
    r.itinerary_id
  from rate_source r
  join manual_room_alias m on m.cruise_alias = r.cruise_name
  join cabin_source c
    on c.cruise_id = r.cruise_id
   and c.name_ko = m.cabin_name
  where lower(regexp_replace(regexp_replace(m.rate_alias, '\([^)]*\)', '', 'g'), '[^a-zA-Z0-9가-힣]', '', 'g'))
    in (r.room_ko_norm, r.room_en_norm)
  order by r.id, c.id
), auto_candidates as (
  select
    r.id as source_rate_id,
    c.id as cabin_id,
    r.itinerary_id,
    case
      when c.cabin_norm in (r.room_ko_norm, r.room_en_norm) then 100
      when r.room_ko_norm <> '' and (c.cabin_norm like '%' || r.room_ko_norm || '%' or r.room_ko_norm like '%' || c.cabin_norm || '%')
        then 80 - least(30, abs(length(c.cabin_norm) - length(r.room_ko_norm)))
      when r.room_en_norm <> '' and (c.cabin_norm like '%' || r.room_en_norm || '%' or r.room_en_norm like '%' || c.cabin_norm || '%')
        then 80 - least(30, abs(length(c.cabin_norm) - length(r.room_en_norm)))
      else 0
    end as score
  from rate_source r
  join cabin_source c on c.cruise_id = r.cruise_id
  where c.cabin_norm <> ''
    and (
      c.cabin_norm in (r.room_ko_norm, r.room_en_norm)
      or (r.room_ko_norm <> '' and (c.cabin_norm like '%' || r.room_ko_norm || '%' or r.room_ko_norm like '%' || c.cabin_norm || '%'))
      or (r.room_en_norm <> '' and (c.cabin_norm like '%' || r.room_en_norm || '%' or r.room_en_norm like '%' || c.cabin_norm || '%'))
    )
), auto_ranked as (
  select
    *,
    row_number() over (partition by source_rate_id order by score desc, cabin_id) as candidate_rank,
    lead(score) over (partition by source_rate_id order by score desc, cabin_id) as next_score
  from auto_candidates
), auto_match as (
  select source_rate_id, cabin_id, itinerary_id
  from auto_ranked
  where candidate_rank = 1
    and (next_score is null or score > next_score)
), mapped_rates as (
  select source_rate_id, cabin_id, itinerary_id from manual_match
  union all
  select a.source_rate_id, a.cabin_id, a.itinerary_id
  from auto_match a
  where not exists (
    select 1 from manual_match m where m.source_rate_id = a.source_rate_id
  )
), deduped_rates as (
  select
    r.*,
    m.cabin_id,
    m.itinerary_id,
    daterange(r.valid_from::date, r.valid_to::date + 1, '[)') as valid_during,
    row_number() over (
      partition by m.cabin_id, m.itinerary_id, r.valid_from, r.valid_to
      order by
        coalesce(r.is_active, false) desc,
        r.price_adult asc nulls last,
        r.updated_at desc nulls last,
        r.id
    ) as duplicate_rank
  from public.cruise_rate_card r
  join mapped_rates m on m.source_rate_id = r.id
  where r.valid_from::date <= r.valid_to::date
    and (
      r.price_adult is not null
      or r.price_child is not null
      or r.price_infant is not null
      or r.price_single is not null
    )
)
insert into public.rate_plans_v2 (
  source_rate_id,
  cabin_id,
  itinerary_id,
  valid_during,
  price_basis,
  currency,
  price_adult,
  price_child,
  price_infant,
  price_single,
  price_extra_bed,
  single_available,
  extra_bed_available,
  season_name,
  is_active
)
select
  id,
  cabin_id,
  itinerary_id,
  valid_during,
  'unknown',
  'VND',
  price_adult,
  price_child,
  price_infant,
  price_single,
  price_extra_bed,
  coalesce(single_available, false),
  coalesce(extra_bed_available, false),
  season_name,
  coalesce(is_active, false)
from deduped_rates
where duplicate_rank = 1
on conflict (source_rate_id) do update set
  cabin_id = excluded.cabin_id,
  itinerary_id = excluded.itinerary_id,
  valid_during = excluded.valid_during,
  price_adult = excluded.price_adult,
  price_child = excluded.price_child,
  price_infant = excluded.price_infant,
  price_single = excluded.price_single,
  price_extra_bed = excluded.price_extra_bed,
  single_available = excluded.single_available,
  extra_bed_available = excluded.extra_bed_available,
  season_name = excluded.season_name,
  is_active = excluded.is_active,
  updated_at = now();

-- Preserve every accepted legacy room label as a scoped cabin alias.
with mapped_aliases as (
  select rp.cabin_id, c.cruise_id, r.room_type as alias
  from public.rate_plans_v2 rp
  join public.cruise_rate_card r on r.id = rp.source_rate_id
  join public.cabins_v2 c on c.id = rp.cabin_id
  union
  select rp.cabin_id, c.cruise_id, r.room_type_en as alias
  from public.rate_plans_v2 rp
  join public.cruise_rate_card r on r.id = rp.source_rate_id
  join public.cabins_v2 c on c.id = rp.cabin_id
)
insert into public.cabin_aliases_v2 (cruise_id, alias, cabin_id)
select distinct on (cruise_id, alias) cruise_id, alias, cabin_id
from mapped_aliases
where nullif(btrim(alias), '') is not null
order by cruise_id, alias, cabin_id
on conflict (cruise_id, alias) do update set cabin_id = excluded.cabin_id;

-- The legacy age field is incomplete free text. Preserve it for consultation,
-- but do not activate an invented automatic child-pricing rule.
insert into public.child_policies_v2 (
  rate_plan_id,
  min_age,
  max_age,
  pricing_rule,
  notes,
  is_active
)
select
  rp.id,
  0,
  17,
  'confirm',
  concat_ws(
    ' | ',
    nullif(r.child_age_range, ''),
    nullif(r.infant_policy, ''),
    'legacy source: cruise_rate_card/' || r.id::text
  ),
  false
from public.rate_plans_v2 rp
join public.cruise_rate_card r on r.id = rp.source_rate_id
where (
    nullif(r.child_age_range, '') is not null
    or nullif(r.infant_policy, '') is not null
    or r.price_child is not null
    or r.price_infant is not null
  )
  and not exists (
    select 1
    from public.child_policies_v2 cp
    where cp.rate_plan_id = rp.id
  );

-- Recommendation tags are derived only from explicit cabin facts.
insert into public.cruise_tags_v2 (cruise_id, tag, evidence, is_active)
select cruise_id, 'family', '3인 이상 또는 커넥팅/엑스트라베드 객실 정보', true
from public.cabins_v2
where max_guests >= 3 or connecting_available or extra_bed_available
group by cruise_id
on conflict (cruise_id, tag) do update set
  evidence = excluded.evidence,
  is_active = excluded.is_active;

insert into public.cruise_tags_v2 (cruise_id, tag, evidence, is_active)
select cruise_id, 'balcony', '발코니 객실 정보', true
from public.cabins_v2
where has_balcony
group by cruise_id
on conflict (cruise_id, tag) do update set
  evidence = excluded.evidence,
  is_active = excluded.is_active;

insert into public.cruise_tags_v2 (cruise_id, tag, evidence, is_active)
select cruise_id, 'couple', '발코니 또는 VIP 객실 정보', true
from public.cabins_v2
where has_balcony or is_vip
group by cruise_id
on conflict (cruise_id, tag) do update set
  evidence = excluded.evidence,
  is_active = excluded.is_active;

insert into public.cruise_tags_v2 (cruise_id, tag, evidence, is_active)
select cruise_id, 'luxury', 'VIP 또는 버틀러 서비스 객실 정보', true
from public.cabins_v2
where is_vip or has_butler
group by cruise_id
on conflict (cruise_id, tag) do update set
  evidence = excluded.evidence,
  is_active = excluded.is_active;

insert into public.cruise_tags_v2 (cruise_id, tag, evidence, is_active)
select cruise_id, 'activity', '시설 또는 특별 어메니티 정보', true
from public.cabins_v2
where nullif(btrim(facilities), '') is not null
   or nullif(btrim(special_amenities), '') is not null
group by cruise_id
on conflict (cruise_id, tag) do update set
  evidence = excluded.evidence,
  is_active = excluded.is_active;

-- cruise_tour_options contains upgrades/add-ons, not transfer inventory, so it
-- is intentionally not copied into cruise_transfers_v2.

do $$
declare
  expected_cruises integer;
  migrated_cruises integer;
  expected_cabins integer;
  migrated_cabins integer;
  eligible_legacy_rates integer;
  mapped_legacy_rates integer;
  migrated_rates integer;
  public_rows integer;
begin
  select count(distinct cruise_name)
  into expected_cruises
  from public.cruise_info
  where nullif(btrim(cruise_name), '') is not null;

  select count(*)
  into migrated_cruises
  from public.cruises_v2
  where legacy_name in (select distinct cruise_name from public.cruise_info);

  select count(*)
  into expected_cabins
  from (
    select cruise_name, room_name
    from public.cruise_info
    where nullif(btrim(room_name), '') is not null
      and coalesce(max_adults, 0) > 0
    group by cruise_name, room_name
  ) source_cabins;

  select count(*)
  into migrated_cabins
  from public.cabins_v2 c
  join public.cruises_v2 cr on cr.id = c.cruise_id
  where cr.legacy_name in (select distinct cruise_name from public.cruise_info);

  select count(*)
  into eligible_legacy_rates
  from public.cruise_rate_card r
  join public.cruise_aliases_v2 ca on ca.alias = r.cruise_name
  where r.schedule_type in ('DAY', '1N2D', '2N3D');

  select count(*)
  into mapped_legacy_rates
  from public.rate_plans_v2 rp
  join public.cruise_rate_card r on r.id = rp.source_rate_id;
  select count(*) into migrated_rates from public.rate_plans_v2;
  select count(*) into public_rows from public.public_cruise_recommendation_v2;

  if migrated_cruises <> expected_cruises then
    raise exception 'Cruise backfill mismatch: expected %, migrated %', expected_cruises, migrated_cruises;
  end if;

  if migrated_cabins <> expected_cabins then
    raise exception 'Cabin backfill mismatch: expected %, migrated %', expected_cabins, migrated_cabins;
  end if;

  if migrated_rates = 0 or public_rows = 0 then
    raise exception 'Rate backfill produced no public recommendation rows';
  end if;

  raise notice 'v2 backfill complete: cruises=%, cabins=%, mapped_legacy_rates=%/%, retained_rate_plans=%, public_rows=%',
    migrated_cruises, migrated_cabins, mapped_legacy_rates, eligible_legacy_rates, migrated_rates, public_rows;
end $$;

commit;
