begin;

-- 서비스별 관리자 입력값을 metadata에 반영해 공개 조회에서 사용하고,
-- 플랫폼 재동기화 뒤에도 manual_override 값을 다시 적용한다.
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
  if jsonb_typeof(new.manual_override -> 'service_details') = 'object' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || (new.manual_override -> 'service_details');
  end if;
  return new;
end;
$$;

commit;
