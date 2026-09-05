begin;

-- 호텔 추천 순위는 홈페이지 전용 편집 데이터다. 플랫폼 상품·예약·결제 원본과 분리한다.
create table public.hotel_recommendation_priority_scopes_v2 (
  criterion_tag text primary key
    check (criterion_tag = 'default' or criterion_tag ~ '^[a-z][a-z0-9-]{0,39}$'),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.hotel_recommendation_priorities_v2 (
  criterion_tag text not null references public.hotel_recommendation_priority_scopes_v2(criterion_tag) on delete cascade,
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  position integer not null check (position between 1 and 1000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (criterion_tag, product_id),
  unique (criterion_tag, position)
);

create index hotel_recommendation_priorities_v2_product_idx
  on public.hotel_recommendation_priorities_v2 (product_id);

alter table public.hotel_recommendation_priority_scopes_v2 enable row level security;
alter table public.hotel_recommendation_priorities_v2 enable row level security;

create policy "service role manages hotel recommendation priority scopes"
  on public.hotel_recommendation_priority_scopes_v2
  for all to service_role using (true) with check (true);

create policy "service role manages hotel recommendation priorities"
  on public.hotel_recommendation_priorities_v2
  for all to service_role using (true) with check (true);

revoke all on table public.hotel_recommendation_priority_scopes_v2 from public, anon, authenticated, service_role;
revoke all on table public.hotel_recommendation_priorities_v2 from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.hotel_recommendation_priority_scopes_v2 to service_role;
grant select, insert, update, delete on table public.hotel_recommendation_priorities_v2 to service_role;

-- 전체 순서를 한 번에 교체하고 버전으로 동시 수정 충돌을 막는다.
create or replace function public.replace_hotel_recommendation_priorities_v2(
  p_criterion_tag text,
  p_product_ids uuid[],
  p_expected_revision bigint,
  p_updated_by uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_criterion text := lower(btrim(coalesce(p_criterion_tag, '')));
  current_revision bigint;
  product_count integer;
  distinct_product_count integer;
begin
  if normalized_criterion <> 'default'
    and normalized_criterion !~ '^[a-z][a-z0-9-]{0,39}$' then
    raise exception '추천 기준 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;

  product_count := coalesce(cardinality(p_product_ids), 0);
  if product_count > 1000 then
    raise exception '한 번에 저장할 수 있는 호텔은 1,000개 이하입니다.' using errcode = '22023';
  end if;

  select count(distinct product_id)::integer
    into distinct_product_count
    from unnest(coalesce(p_product_ids, array[]::uuid[])) as requested(product_id);

  if distinct_product_count <> product_count then
    raise exception '중복된 호텔이 순위에 포함되어 있습니다.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_product_ids, array[]::uuid[])) as requested(product_id)
    left join public.catalog_products_v2 product on product.id = requested.product_id
    where product.id is null
  ) then
    raise exception '존재하지 않는 호텔이 순위에 포함되어 있습니다.' using errcode = '22023';
  end if;

  insert into public.hotel_recommendation_priority_scopes_v2 (criterion_tag, revision, updated_by, updated_at)
  values (normalized_criterion, 0, p_updated_by, now())
  on conflict (criterion_tag) do nothing;

  select revision into current_revision
  from public.hotel_recommendation_priority_scopes_v2
  where criterion_tag = normalized_criterion
  for update;

  if p_expected_revision is not null and p_expected_revision <> current_revision then
    raise exception '다른 운영자가 추천순위를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  delete from public.hotel_recommendation_priorities_v2
  where criterion_tag = normalized_criterion;

  insert into public.hotel_recommendation_priorities_v2 (
    criterion_tag, product_id, position, updated_by, updated_at
  )
  select normalized_criterion, ordered.product_id, ordered.position::integer, p_updated_by, now()
  from unnest(coalesce(p_product_ids, array[]::uuid[]))
    with ordinality as ordered(product_id, position);

  update public.hotel_recommendation_priority_scopes_v2
  set revision = revision + 1, updated_by = p_updated_by, updated_at = now()
  where criterion_tag = normalized_criterion
  returning revision into current_revision;

  return jsonb_build_object(
    'criterionTag', normalized_criterion,
    'revision', current_revision,
    'updatedBy', p_updated_by,
    'updatedAt', now()
  );
end;
$$;

revoke all on function public.replace_hotel_recommendation_priorities_v2(text, uuid[], bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.replace_hotel_recommendation_priorities_v2(text, uuid[], bigint, uuid)
  to service_role;

commit;
