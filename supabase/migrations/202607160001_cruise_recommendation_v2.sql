begin;

-- Non-destructive v2 schema for the recommendation service.
-- Legacy cruise_info / cruise_rate_card tables remain the source of truth until
-- price_basis, child policies, aliases, and migrated row counts are approved.

create table public.cruises_v2 (
  id uuid primary key default gen_random_uuid(),
  legacy_name text unique,
  slug text not null unique,
  code text not null unique,
  name_ko text not null,
  name_en text,
  description text,
  category text,
  star_rating numeric(2, 1) check (star_rating between 0 and 5),
  hero_image text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cruise_itineraries_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  schedule_type text not null check (schedule_type in ('DAY', '1N2D', '2N3D')),
  nights smallint not null check (nights between 0 and 2),
  description text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cruise_id, schedule_type),
  check (
    (schedule_type = 'DAY' and nights = 0)
    or (schedule_type = '1N2D' and nights = 1)
    or (schedule_type = '2N3D' and nights = 2)
  )
);

create table public.cabins_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  legacy_room_name text,
  name_ko text not null,
  name_en text,
  room_area_text text,
  bed_type text,
  max_adults smallint not null check (max_adults > 0),
  max_guests smallint not null check (max_guests > 0 and max_guests >= max_adults),
  has_balcony boolean not null default false,
  is_vip boolean not null default false,
  has_butler boolean not null default false,
  is_recommended boolean not null default false,
  connecting_available boolean not null default false,
  extra_bed_available boolean not null default false,
  facilities text,
  special_amenities text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cruise_id, name_ko)
);

create table public.rate_plans_v2 (
  id uuid primary key default gen_random_uuid(),
  source_rate_id uuid unique,
  cabin_id uuid not null references public.cabins_v2(id) on delete cascade,
  itinerary_id uuid not null references public.cruise_itineraries_v2(id) on delete cascade,
  valid_during daterange not null check (not isempty(valid_during)),
  price_basis text not null default 'unknown'
    check (price_basis in ('per_cabin', 'per_adult', 'per_person', 'unknown')),
  currency text not null default 'VND' check (currency = 'VND'),
  price_adult bigint check (price_adult >= 0),
  price_child bigint check (price_child >= 0),
  price_infant bigint check (price_infant >= 0),
  price_single bigint check (price_single >= 0),
  price_extra_bed bigint check (price_extra_bed >= 0),
  single_available boolean not null default false,
  extra_bed_available boolean not null default false,
  season_name text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cabin_id, itinerary_id, valid_during, price_basis),
  check (
    price_adult is not null
    or price_child is not null
    or price_infant is not null
    or price_single is not null
  )
);

create table public.child_policies_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid references public.cruises_v2(id) on delete cascade,
  rate_plan_id uuid references public.rate_plans_v2(id) on delete cascade,
  min_age smallint not null check (min_age between 0 and 17),
  max_age smallint not null check (max_age between 0 and 17 and max_age >= min_age),
  pricing_rule text not null check (pricing_rule in ('free', 'fixed', 'percentage', 'adult_rate', 'confirm')),
  rule_value numeric(12, 2) check (rule_value is null or rule_value >= 0),
  requires_extra_bed boolean not null default false,
  notes text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (cruise_id is not null and rate_plan_id is null)
    or (cruise_id is null and rate_plan_id is not null)
  )
);

create table public.cruise_transfers_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  itinerary_id uuid references public.cruise_itineraries_v2(id) on delete cascade,
  origin text not null check (origin in ('hanoi', 'airport', 'halong')),
  vehicle_type text,
  is_round_trip boolean not null default true,
  price_basis text not null default 'confirm'
    check (price_basis in ('per_person', 'per_vehicle', 'included', 'confirm')),
  price bigint check (price is null or price >= 0),
  currency text not null default 'VND' check (currency = 'VND'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cruise_tags_v2 (
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  tag text not null check (tag in ('family', 'couple', 'balcony', 'quiet', 'activity', 'value', 'luxury')),
  evidence text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (cruise_id, tag)
);

create table public.cruise_aliases_v2 (
  alias text primary key,
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.cabin_aliases_v2 (
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  alias text not null,
  cabin_id uuid not null references public.cabins_v2(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cruise_id, alias)
);

create index if not exists cruises_v2_active_idx
  on public.cruises_v2 (is_active, name_ko);
create index if not exists cruise_itineraries_v2_lookup_idx
  on public.cruise_itineraries_v2 (cruise_id, schedule_type)
  where is_active = true;
create index if not exists cabins_v2_cruise_idx
  on public.cabins_v2 (cruise_id)
  where is_active = true;
create index if not exists rate_plans_v2_lookup_idx
  on public.rate_plans_v2 (itinerary_id, cabin_id)
  where is_active = true;
create index if not exists rate_plans_v2_valid_during_idx
  on public.rate_plans_v2 using gist (valid_during);
create index if not exists child_policies_v2_cruise_idx
  on public.child_policies_v2 (cruise_id, min_age, max_age)
  where is_active = true;
create index if not exists cruise_transfers_v2_lookup_idx
  on public.cruise_transfers_v2 (cruise_id, origin)
  where is_active = true;

alter table public.cruises_v2 enable row level security;
alter table public.cruise_itineraries_v2 enable row level security;
alter table public.cabins_v2 enable row level security;
alter table public.rate_plans_v2 enable row level security;
alter table public.child_policies_v2 enable row level security;
alter table public.cruise_transfers_v2 enable row level security;
alter table public.cruise_tags_v2 enable row level security;
alter table public.cruise_aliases_v2 enable row level security;
alter table public.cabin_aliases_v2 enable row level security;

drop policy if exists "public reads active cruises v2" on public.cruises_v2;
create policy "public reads active cruises v2" on public.cruises_v2
  for select to anon, authenticated using (is_active = true);
drop policy if exists "public reads active itineraries v2" on public.cruise_itineraries_v2;
create policy "public reads active itineraries v2" on public.cruise_itineraries_v2
  for select to anon, authenticated using (is_active = true);
drop policy if exists "public reads active cabins v2" on public.cabins_v2;
create policy "public reads active cabins v2" on public.cabins_v2
  for select to anon, authenticated using (is_active = true);
drop policy if exists "public reads active rates v2" on public.rate_plans_v2;
create policy "public reads active rates v2" on public.rate_plans_v2
  for select to anon, authenticated using (is_active = true);
drop policy if exists "public reads active tags v2" on public.cruise_tags_v2;
create policy "public reads active tags v2" on public.cruise_tags_v2
  for select to anon, authenticated using (is_active = true);

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
  ) as tags
from public.cruises_v2 c
join public.cruise_itineraries_v2 i on i.cruise_id = c.id
join public.cabins_v2 ca on ca.cruise_id = c.id
join public.rate_plans_v2 rp on rp.cabin_id = ca.id and rp.itinerary_id = i.id
where c.is_active = true
  and i.is_active = true
  and ca.is_active = true
  and rp.is_active = true;

revoke all on public.cruises_v2 from anon, authenticated;
revoke all on public.cruise_itineraries_v2 from anon, authenticated;
revoke all on public.cabins_v2 from anon, authenticated;
revoke all on public.rate_plans_v2 from anon, authenticated;
revoke all on public.child_policies_v2 from anon, authenticated;
revoke all on public.cruise_transfers_v2 from anon, authenticated;
revoke all on public.cruise_tags_v2 from anon, authenticated;
revoke all on public.cruise_aliases_v2 from anon, authenticated;
revoke all on public.cabin_aliases_v2 from anon, authenticated;

-- security_invoker views require the caller to have SELECT privileges on the
-- referenced tables; RLS still limits rows to active public records.
grant select on public.cruises_v2 to anon, authenticated;
grant select on public.cruise_itineraries_v2 to anon, authenticated;
grant select on public.cabins_v2 to anon, authenticated;
grant select on public.rate_plans_v2 to anon, authenticated;
grant select on public.cruise_tags_v2 to anon, authenticated;
grant select on public.public_cruise_recommendation_v2 to anon, authenticated;

commit;
