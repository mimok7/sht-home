-- 크루즈 기본 정보 갤러리의 대표 이미지 상태를 보관한다.
begin;

alter table public.cruise_cafe_import_images_v2
  add column if not exists is_primary boolean not null default false;

create index if not exists cruise_cafe_import_images_v2_cruise_primary_sort_idx
  on public.cruise_cafe_import_images_v2 (cruise_id, cabin_id, is_primary desc, sort_order);

commit;
