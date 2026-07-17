begin;

-- 예약 플랫폼에서 전송한 상품 원본을 홈페이지 가공 데이터와 분리해 보관한다.
create table if not exists public.platform_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  catalog_counts jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table if not exists public.platform_source_records (
  source text not null,
  source_table text not null,
  source_id text not null,
  source_updated_at timestamptz,
  payload jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (source, source_table, source_id)
);

create index if not exists platform_source_records_table_synced_idx
  on public.platform_source_records (source_table, synced_at desc);

alter table public.platform_sync_runs enable row level security;
alter table public.platform_source_records enable row level security;

revoke all on public.platform_sync_runs from anon, authenticated;
revoke all on public.platform_source_records from anon, authenticated;

commit;
