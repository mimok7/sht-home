begin;

-- 기존 호텔 전용 추천 기준을 공항·투어·차량에도 재사용한다.
do $$
begin
  if to_regclass('public.hotel_tags_v2') is not null and to_regclass('public.service_tags_v2') is null then
    alter table public.hotel_tags_v2 rename to service_tags_v2;
  end if;
end
$$;

create table if not exists public.service_tags_v2 (
  product_id uuid not null references public.catalog_products_v2(id) on delete cascade,
  tag text not null check (tag in ('family', 'couple', 'balcony', 'quiet', 'activity', 'value', 'luxury')),
  evidence text not null default '',
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (product_id, tag)
);

alter table public.service_tags_v2 enable row level security;
revoke all on public.service_tags_v2 from anon, authenticated;

commit;
