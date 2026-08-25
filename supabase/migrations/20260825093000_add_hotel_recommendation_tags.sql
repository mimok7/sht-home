begin;

-- 호텔도 크루즈와 같은 추천 기준 관리 화면을 사용한다.
create table if not exists public.hotel_tags_v2 (
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  tag text not null check (tag in ('family', 'couple', 'balcony', 'quiet', 'activity', 'value', 'luxury')),
  evidence text not null default '',
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (product_id, tag)
);

alter table public.hotel_tags_v2 enable row level security;
revoke all on public.hotel_tags_v2 from anon, authenticated;

commit;
