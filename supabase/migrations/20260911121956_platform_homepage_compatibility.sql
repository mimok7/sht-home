begin;

-- Homepage editorial tags. These are deliberately separate from booking,
-- reservation and payment data owned by the platform.
create table if not exists public.service_tags_v2 (
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  tag text not null check (tag = 'default' or tag ~ '^[a-z][a-z0-9-]{0,39}$'),
  evidence text not null default '',
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (product_id, tag)
);
alter table public.service_tags_v2 enable row level security;
revoke all on public.service_tags_v2 from anon, authenticated;
grant select, insert, update, delete on public.service_tags_v2 to service_role;
drop policy if exists "public reads active service tags v2" on public.service_tags_v2;
create policy "public reads active service tags v2"
  on public.service_tags_v2 for select to anon, authenticated
  using (is_active and exists (
    select 1 from public.catalog_products_v2 product
    where product.id = service_tags_v2.product_id and product.is_active
  ));
grant select on public.service_tags_v2 to anon, authenticated;

create table if not exists public.hotel_recommendation_priority_scopes_v2 (
  criterion_tag text primary key check (criterion_tag = 'default' or criterion_tag ~ '^[a-z][a-z0-9-]{0,39}$'),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.hotel_recommendation_priorities_v2 (
  criterion_tag text not null references public.hotel_recommendation_priority_scopes_v2(criterion_tag) on delete cascade,
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  position integer not null check (position between 1 and 1000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (criterion_tag, product_id),
  unique (criterion_tag, position)
);
create index if not exists hotel_recommendation_priorities_v2_product_idx on public.hotel_recommendation_priorities_v2(product_id);
alter table public.hotel_recommendation_priority_scopes_v2 enable row level security;
alter table public.hotel_recommendation_priorities_v2 enable row level security;
revoke all on public.hotel_recommendation_priority_scopes_v2, public.hotel_recommendation_priorities_v2 from anon, authenticated;
grant select, insert, update, delete on public.hotel_recommendation_priority_scopes_v2, public.hotel_recommendation_priorities_v2 to service_role;

create table if not exists public.cruise_recommendation_priority_scopes_v2 (
  criterion_tag text not null check (criterion_tag = 'default' or criterion_tag ~ '^[a-z][a-z0-9-]{0,39}$'),
  schedule_type text not null check (schedule_type in ('ALL', 'DAY', '1N2D', '2N3D')),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (criterion_tag, schedule_type)
);
create table if not exists public.cruise_recommendation_priorities_v2 (
  criterion_tag text not null,
  schedule_type text not null,
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  position smallint not null check (position between 1 and 999),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (criterion_tag, schedule_type, cruise_id),
  unique (criterion_tag, schedule_type, position),
  foreign key (criterion_tag, schedule_type) references public.cruise_recommendation_priority_scopes_v2(criterion_tag, schedule_type) on delete cascade
);
create index if not exists cruise_recommendation_priorities_v2_cruise_idx on public.cruise_recommendation_priorities_v2(cruise_id);
alter table public.cruise_recommendation_priority_scopes_v2 enable row level security;
alter table public.cruise_recommendation_priorities_v2 enable row level security;
revoke all on public.cruise_recommendation_priority_scopes_v2, public.cruise_recommendation_priorities_v2 from anon, authenticated;
grant select, insert, update, delete on public.cruise_recommendation_priority_scopes_v2, public.cruise_recommendation_priorities_v2 to service_role;

create or replace function public.replace_hotel_recommendation_priorities_v2(p_criterion_tag text, p_product_ids uuid[], p_expected_revision bigint, p_updated_by uuid)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
declare normalized_criterion text := lower(btrim(coalesce(p_criterion_tag, ''))); current_revision bigint; product_count integer; distinct_product_count integer;
begin
  if normalized_criterion <> 'default' and normalized_criterion !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception '추천 기준 형식이 올바르지 않습니다.' using errcode = '22023'; end if;
  product_count := coalesce(cardinality(p_product_ids), 0);
  if product_count > 1000 then raise exception '한 번에 저장할 수 있는 호텔은 1,000개 이하입니다.' using errcode = '22023'; end if;
  select count(distinct product_id)::integer into distinct_product_count from unnest(coalesce(p_product_ids, array[]::uuid[])) as requested(product_id);
  if distinct_product_count <> product_count then raise exception '중복된 호텔이 순위에 포함되어 있습니다.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_product_ids, array[]::uuid[])) as requested(product_id) left join public.catalog_products_v2 product on product.id = requested.product_id where product.id is null) then raise exception '존재하지 않는 호텔이 순위에 포함되어 있습니다.' using errcode = '22023'; end if;
  insert into public.hotel_recommendation_priority_scopes_v2 (criterion_tag, revision, updated_by, updated_at) values (normalized_criterion, 0, p_updated_by, now()) on conflict (criterion_tag) do nothing;
  select revision into current_revision from public.hotel_recommendation_priority_scopes_v2 where criterion_tag = normalized_criterion for update;
  if p_expected_revision is not null and p_expected_revision <> current_revision then raise exception '다른 운영자가 추천순위를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.' using errcode = '40001'; end if;
  delete from public.hotel_recommendation_priorities_v2 where criterion_tag = normalized_criterion;
  insert into public.hotel_recommendation_priorities_v2 (criterion_tag, product_id, position, updated_by, updated_at) select normalized_criterion, ordered.product_id, ordered.position::integer, p_updated_by, now() from unnest(coalesce(p_product_ids, array[]::uuid[])) with ordinality as ordered(product_id, position);
  update public.hotel_recommendation_priority_scopes_v2 set revision = revision + 1, updated_by = p_updated_by, updated_at = now() where criterion_tag = normalized_criterion returning revision into current_revision;
  return jsonb_build_object('criterionTag', normalized_criterion, 'revision', current_revision, 'updatedBy', p_updated_by, 'updatedAt', now());
end; $$;
revoke all on function public.replace_hotel_recommendation_priorities_v2(text, uuid[], bigint, uuid) from public, anon, authenticated;
grant execute on function public.replace_hotel_recommendation_priorities_v2(text, uuid[], bigint, uuid) to service_role;

create or replace function public.replace_cruise_recommendation_priorities_v2(p_criterion_tag text, p_schedule_type text, p_cruise_ids uuid[], p_expected_revision bigint, p_updated_by uuid)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
declare normalized_criterion text := lower(btrim(coalesce(p_criterion_tag, ''))); normalized_schedule text := upper(btrim(coalesce(p_schedule_type, ''))); current_revision bigint; cruise_count integer; distinct_cruise_count integer;
begin
  if normalized_criterion <> 'default' and normalized_criterion !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception '추천 기준 형식이 올바르지 않습니다.' using errcode = '22023'; end if;
  if normalized_schedule not in ('ALL', 'DAY', '1N2D', '2N3D') then raise exception '일정 범위가 올바르지 않습니다.' using errcode = '22023'; end if;
  cruise_count := coalesce(cardinality(p_cruise_ids), 0);
  if cruise_count > 100 then raise exception '한 번에 저장할 수 있는 크루즈는 100개 이하입니다.' using errcode = '22023'; end if;
  select count(distinct cruise_id)::integer into distinct_cruise_count from unnest(coalesce(p_cruise_ids, array[]::uuid[])) as requested(cruise_id);
  if distinct_cruise_count <> cruise_count then raise exception '중복된 크루즈가 순위에 포함되어 있습니다.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_cruise_ids, array[]::uuid[])) as requested(cruise_id) left join public.cruises_v2 cruise on cruise.id = requested.cruise_id where cruise.id is null) then raise exception '존재하지 않는 크루즈가 순위에 포함되어 있습니다.' using errcode = '22023'; end if;
  insert into public.cruise_recommendation_priority_scopes_v2 (criterion_tag, schedule_type, revision, updated_by, updated_at) values (normalized_criterion, normalized_schedule, 0, p_updated_by, now()) on conflict (criterion_tag, schedule_type) do nothing;
  select revision into current_revision from public.cruise_recommendation_priority_scopes_v2 where criterion_tag = normalized_criterion and schedule_type = normalized_schedule for update;
  if p_expected_revision is not null and p_expected_revision <> current_revision then raise exception '다른 관리자가 추천순위를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.' using errcode = '40001'; end if;
  delete from public.cruise_recommendation_priorities_v2 where criterion_tag = normalized_criterion and schedule_type = normalized_schedule;
  insert into public.cruise_recommendation_priorities_v2 (criterion_tag, schedule_type, cruise_id, position, updated_by, updated_at) select normalized_criterion, normalized_schedule, ordered.cruise_id, ordered.position::smallint, p_updated_by, now() from unnest(coalesce(p_cruise_ids, array[]::uuid[])) with ordinality as ordered(cruise_id, position);
  update public.cruise_recommendation_priority_scopes_v2 set revision = revision + 1, updated_by = p_updated_by, updated_at = now() where criterion_tag = normalized_criterion and schedule_type = normalized_schedule returning revision into current_revision;
  return jsonb_build_object('criterionTag', normalized_criterion, 'scheduleType', normalized_schedule, 'revision', current_revision, 'updatedBy', p_updated_by, 'updatedAt', now());
end; $$;
revoke all on function public.replace_cruise_recommendation_priorities_v2(text, text, uuid[], bigint, uuid) from public, anon, authenticated;
grant execute on function public.replace_cruise_recommendation_priorities_v2(text, text, uuid[], bigint, uuid) to service_role;

insert into storage.buckets (id, name, public) values ('admin-change-request-images', 'admin-change-request-images', false) on conflict (id) do update set public = false;
create table if not exists public.admin_change_requests (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('content','product','design','bug','other')),
  title text not null check (char_length(title) <= 120),
  description text not null check (char_length(description) <= 5000),
  screenshot_paths jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','in_progress','done')),
  created_by uuid not null, created_by_email text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.admin_change_request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.admin_change_requests(id) on delete cascade,
  author_id uuid not null, author_email text not null,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists admin_change_request_comments_request_idx on public.admin_change_request_comments(request_id, created_at);
alter table public.admin_change_requests enable row level security;
alter table public.admin_change_request_comments enable row level security;
revoke all on public.admin_change_requests, public.admin_change_request_comments from anon, authenticated;
grant select, insert, update, delete on public.admin_change_requests, public.admin_change_request_comments to service_role;

commit;
