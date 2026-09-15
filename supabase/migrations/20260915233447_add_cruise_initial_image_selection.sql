-- 목록 첫 화면에만 쓰는 이미지를 상세 페이지의 대표 이미지와 분리한다.
-- 값은 기존 갤러리 행만 가리키며, 이미지 삭제 시 선택값도 안전하게 비운다.
begin;

alter table public.cruises_v2
  add column if not exists initial_image_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cruises_v2_initial_image_id_fkey'
      and conrelid = 'public.cruises_v2'::regclass
  ) then
    alter table public.cruises_v2
      add constraint cruises_v2_initial_image_id_fkey
      foreign key (initial_image_id)
      references public.cruise_cafe_import_images_v2(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists cruises_v2_initial_image_id_idx
  on public.cruises_v2 (initial_image_id)
  where initial_image_id is not null;

commit;
