begin;

-- 공개 상태인 크루즈의 갤러리 메타데이터만 홈페이지에서 읽을 수 있다.
-- 쓰기 권한은 부여하지 않으므로 등록·수정·삭제는 계속 관리자 API만 수행한다.
grant select on public.cruise_cafe_import_images_v2 to anon, authenticated;
grant select on public.cabin_images_v2 to anon, authenticated;

drop policy if exists "Public can view active cruise import galleries"
  on public.cruise_cafe_import_images_v2;
create policy "Public can view active cruise import galleries"
  on public.cruise_cafe_import_images_v2
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.cruises_v2 as cruise
      where cruise.id = cruise_cafe_import_images_v2.cruise_id
        and cruise.is_active = true
    )
  );

drop policy if exists "Public can view active cabin galleries"
  on public.cabin_images_v2;
create policy "Public can view active cabin galleries"
  on public.cabin_images_v2
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.cabins_v2 as cabin
      join public.cruises_v2 as cruise on cruise.id = cabin.cruise_id
      where cabin.id = cabin_images_v2.cabin_id
        and cruise.is_active = true
    )
  );

commit;
