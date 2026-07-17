begin;

-- 객실 하나에 여러 장의 사진을 순서와 대표 여부까지 포함해 관리한다.
-- 실제 파일은 Storage API가 관리하고, DB에는 Storage 객체 경로만 보관한다.
create table public.cabin_images_v2 (
  id uuid primary key default gen_random_uuid(),
  cabin_id uuid not null references public.cabins_v2(id) on delete cascade,
  storage_bucket text not null default 'homepage-images',
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index cabin_images_v2_cabin_order_idx
  on public.cabin_images_v2 (cabin_id, sort_order, created_at);

create unique index cabin_images_v2_one_primary_idx
  on public.cabin_images_v2 (cabin_id)
  where is_primary;

alter table public.cabin_images_v2 enable row level security;

-- 이미지 목록은 관리자 API의 service_role만 사용한다. Data API를 통해
-- 직접 수정할 권한은 부여하지 않는다.
revoke all on public.cabin_images_v2 from anon, authenticated;

commit;
