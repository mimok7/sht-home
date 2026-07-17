begin;

-- 플랫폼 원본을 읽기 전용으로 유지하면서, 홈페이지 운영자가 고친 표현·공개
-- 값은 다음 동기화 뒤에도 홈페이지용 v2 카탈로그에 남도록 보관한다.
alter table public.catalog_products_v2
  add column if not exists manual_override jsonb not null default '{}'::jsonb,
  add constraint catalog_products_v2_manual_override_object
    check (jsonb_typeof(manual_override) = 'object');

alter table public.catalog_prices_v2
  add column if not exists manual_override jsonb not null default '{}'::jsonb,
  add constraint catalog_prices_v2_manual_override_object
    check (jsonb_typeof(manual_override) = 'object');

create or replace function private.apply_catalog_product_manual_overrides_v2()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.manual_override ? 'name_ko' then
    new.name_ko := new.manual_override ->> 'name_ko';
  end if;
  if new.manual_override ? 'description' then
    new.description := new.manual_override ->> 'description';
  end if;
  if new.manual_override ? 'category' then
    new.category := new.manual_override ->> 'category';
  end if;
  if new.manual_override ? 'image_url' then
    new.image_url := new.manual_override ->> 'image_url';
  end if;
  if new.manual_override ? 'is_active' then
    new.is_active := (new.manual_override ->> 'is_active')::boolean;
  end if;
  return new;
end;
$$;

create or replace function private.apply_catalog_price_manual_overrides_v2()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.manual_override ? 'label' then
    new.label := new.manual_override ->> 'label';
  end if;
  if new.manual_override ? 'price_amount' then
    new.price_amount := nullif(new.manual_override ->> 'price_amount', '')::numeric;
  end if;
  if new.manual_override ? 'currency' then
    new.currency := new.manual_override ->> 'currency';
  end if;
  if new.manual_override ? 'price_unit' then
    new.price_unit := new.manual_override ->> 'price_unit';
  end if;
  if new.manual_override ? 'min_guests' then
    new.min_guests := nullif(new.manual_override ->> 'min_guests', '')::smallint;
  end if;
  if new.manual_override ? 'max_guests' then
    new.max_guests := nullif(new.manual_override ->> 'max_guests', '')::smallint;
  end if;
  if new.manual_override ? 'valid_from' then
    new.valid_from := nullif(new.manual_override ->> 'valid_from', '')::date;
  end if;
  if new.manual_override ? 'valid_to' then
    new.valid_to := nullif(new.manual_override ->> 'valid_to', '')::date;
  end if;
  if new.manual_override ? 'is_active' then
    new.is_active := (new.manual_override ->> 'is_active')::boolean;
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_products_v2_apply_manual_overrides on public.catalog_products_v2;
create trigger catalog_products_v2_apply_manual_overrides
before insert or update on public.catalog_products_v2
for each row execute procedure private.apply_catalog_product_manual_overrides_v2();

drop trigger if exists catalog_prices_v2_apply_manual_overrides on public.catalog_prices_v2;
create trigger catalog_prices_v2_apply_manual_overrides
before insert or update on public.catalog_prices_v2
for each row execute procedure private.apply_catalog_price_manual_overrides_v2();

commit;
