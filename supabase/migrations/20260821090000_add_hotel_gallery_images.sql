begin;

-- 플랫폼에서 가져온 호텔 대표·객실 갤러리 메타데이터를 홈페이지에서 보관한다.
create table if not exists public.hotel_gallery_images_v2 (
  id uuid primary key,
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  hotel_price_code text,
  collection text not null check (collection in ('hotel_import', 'hotel_gallery', 'room_gallery')),
  source_url text,
  source_image_url text,
  image_name text,
  image_url text not null,
  storage_bucket text not null,
  storage_path text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (collection = 'room_gallery' and hotel_price_code is not null)
    or (collection in ('hotel_import', 'hotel_gallery') and hotel_price_code is null)
  ),
  unique (product_id, storage_path)
);

create index if not exists hotel_gallery_images_v2_product_sort_idx
  on public.hotel_gallery_images_v2 (product_id, hotel_price_code, is_primary desc, sort_order);

alter table public.hotel_gallery_images_v2 enable row level security;
revoke all on public.hotel_gallery_images_v2 from anon, authenticated;
grant select on public.hotel_gallery_images_v2 to anon, authenticated;

drop policy if exists "Public can view active hotel galleries" on public.hotel_gallery_images_v2;
create policy "Public can view active hotel galleries"
  on public.hotel_gallery_images_v2 for select to anon, authenticated
  using (exists (
    select 1 from public.catalog_products_v2 product
    where product.id = hotel_gallery_images_v2.product_id
      and product.is_active = true
  ));

commit;
