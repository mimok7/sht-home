-- 크루즈 등급을 6성급까지 허용한다.
alter table public.cruises_v2
  drop constraint if exists cruises_v2_star_rating_check;

alter table public.cruises_v2
  add constraint cruises_v2_star_rating_check
  check (star_rating between 0 and 6);
