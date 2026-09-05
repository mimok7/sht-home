begin;

-- Recommendation order is a homepage-owned editorial override. It is kept
-- separate from platform cruise, reservation, quote, and payment data.
create table public.cruise_recommendation_priority_scopes_v2 (
  criterion_tag text not null
    check (criterion_tag = 'default' or criterion_tag ~ '^[a-z][a-z0-9-]{0,39}$'),
  schedule_type text not null
    check (schedule_type in ('ALL', 'DAY', '1N2D', '2N3D')),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (criterion_tag, schedule_type)
);

create table public.cruise_recommendation_priorities_v2 (
  criterion_tag text not null,
  schedule_type text not null,
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  position smallint not null check (position between 1 and 999),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (criterion_tag, schedule_type, cruise_id),
  unique (criterion_tag, schedule_type, position),
  foreign key (criterion_tag, schedule_type)
    references public.cruise_recommendation_priority_scopes_v2(criterion_tag, schedule_type)
    on delete cascade
);

create index cruise_recommendation_priorities_v2_cruise_idx
  on public.cruise_recommendation_priorities_v2 (cruise_id);

alter table public.cruise_recommendation_priority_scopes_v2 enable row level security;
alter table public.cruise_recommendation_priorities_v2 enable row level security;

create policy "service role manages recommendation priority scopes"
  on public.cruise_recommendation_priority_scopes_v2
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages recommendation priorities"
  on public.cruise_recommendation_priorities_v2
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.cruise_recommendation_priority_scopes_v2 from public, anon, authenticated, service_role;
revoke all on table public.cruise_recommendation_priorities_v2 from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.cruise_recommendation_priority_scopes_v2 to service_role;
grant select, insert, update, delete on table public.cruise_recommendation_priorities_v2 to service_role;

-- The server calls this once with the complete order. One database function
-- keeps swaps atomic and uses a scope revision to reject lost updates.
create or replace function public.replace_cruise_recommendation_priorities_v2(
  p_criterion_tag text,
  p_schedule_type text,
  p_cruise_ids uuid[],
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
  normalized_schedule text := upper(btrim(coalesce(p_schedule_type, '')));
  current_revision bigint;
  cruise_count integer;
  distinct_cruise_count integer;
begin
  if normalized_criterion <> 'default'
    and normalized_criterion !~ '^[a-z][a-z0-9-]{0,39}$' then
    raise exception '추천 기준 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;

  if normalized_schedule not in ('ALL', 'DAY', '1N2D', '2N3D') then
    raise exception '일정 범위가 올바르지 않습니다.' using errcode = '22023';
  end if;

  cruise_count := coalesce(cardinality(p_cruise_ids), 0);
  if cruise_count > 100 then
    raise exception '한 번에 저장할 수 있는 크루즈는 100개 이하입니다.' using errcode = '22023';
  end if;

  select count(distinct cruise_id)::integer
    into distinct_cruise_count
    from unnest(coalesce(p_cruise_ids, array[]::uuid[])) as requested(cruise_id);

  if distinct_cruise_count <> cruise_count then
    raise exception '중복된 크루즈가 순위에 포함되어 있습니다.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_cruise_ids, array[]::uuid[])) as requested(cruise_id)
    left join public.cruises_v2 cruise on cruise.id = requested.cruise_id
    where cruise.id is null
  ) then
    raise exception '존재하지 않는 크루즈가 순위에 포함되어 있습니다.' using errcode = '22023';
  end if;

  insert into public.cruise_recommendation_priority_scopes_v2 (
    criterion_tag, schedule_type, revision, updated_by, updated_at
  ) values (
    normalized_criterion, normalized_schedule, 0, p_updated_by, now()
  )
  on conflict (criterion_tag, schedule_type) do nothing;

  select revision
    into current_revision
    from public.cruise_recommendation_priority_scopes_v2
    where criterion_tag = normalized_criterion
      and schedule_type = normalized_schedule
    for update;

  if p_expected_revision is not null and p_expected_revision <> current_revision then
    raise exception '다른 관리자가 추천순위를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  delete from public.cruise_recommendation_priorities_v2
    where criterion_tag = normalized_criterion
      and schedule_type = normalized_schedule;

  insert into public.cruise_recommendation_priorities_v2 (
    criterion_tag, schedule_type, cruise_id, position, updated_by, updated_at
  )
  select
    normalized_criterion,
    normalized_schedule,
    ordered.cruise_id,
    ordered.position::smallint,
    p_updated_by,
    now()
  from unnest(coalesce(p_cruise_ids, array[]::uuid[]))
    with ordinality as ordered(cruise_id, position);

  update public.cruise_recommendation_priority_scopes_v2
    set revision = revision + 1,
        updated_by = p_updated_by,
        updated_at = now()
    where criterion_tag = normalized_criterion
      and schedule_type = normalized_schedule
    returning revision into current_revision;

  return jsonb_build_object(
    'criterionTag', normalized_criterion,
    'scheduleType', normalized_schedule,
    'revision', current_revision,
    'updatedBy', p_updated_by,
    'updatedAt', now()
  );
end;
$$;

revoke all on function public.replace_cruise_recommendation_priorities_v2(text, text, uuid[], bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.replace_cruise_recommendation_priorities_v2(text, text, uuid[], bigint, uuid)
  to service_role;

commit;
