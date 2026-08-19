-- 기존 크루즈 대표 이미지와 갤러리 대표 상태를 일치시킨다.
begin;

with hero_image_matches as (
  select image.id,
    row_number() over (partition by image.cruise_id order by image.sort_order, image.created_at) as row_number
  from public.cruise_cafe_import_images_v2 as image
  join public.cruises_v2 as cruise on cruise.id = image.cruise_id
  where image.cabin_id is null
    and cruise.hero_image like '%' || image.storage_path
    and not exists (
      select 1
      from public.cruise_cafe_import_images_v2 as existing
      where existing.cruise_id = image.cruise_id
        and existing.cabin_id is null
        and existing.is_primary = true
    )
)
update public.cruise_cafe_import_images_v2 as image
set is_primary = true
from hero_image_matches as match
where image.id = match.id
  and match.row_number = 1;

commit;
