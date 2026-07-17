begin;

create table if not exists public.cruise_cafe_import_images_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  source_url text not null,
  source_image_url text not null,
  storage_bucket text not null,
  storage_path text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (cruise_id, storage_path)
);

create index if not exists cruise_cafe_import_images_v2_cruise_id_sort_order_idx
  on public.cruise_cafe_import_images_v2 (cruise_id, sort_order);

alter table public.cruise_cafe_import_images_v2 enable row level security;

commit;
