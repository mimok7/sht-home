begin;

-- 카페에서 추출한 비정형 요금/규정은 객실·일정·적용기간 검토 전에는
-- rate_plans_v2 등에 자동 반영하지 않고, 검토 대기 블록으로 보관한다.
create table if not exists public.cruise_import_review_blocks_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  source_url text not null,
  content_type text not null check (content_type in ('rate', 'policy')),
  target_tables text[] not null,
  raw_text text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists cruise_import_review_blocks_v2_cruise_status_idx
  on public.cruise_import_review_blocks_v2 (cruise_id, status, created_at desc);

alter table public.cruise_import_review_blocks_v2 enable row level security;
revoke all on public.cruise_import_review_blocks_v2 from anon, authenticated;

commit;
