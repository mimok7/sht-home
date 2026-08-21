begin;

-- hotel_gallery_images_v2가 이미 생성됐어도 PostgREST가 이전 스키마 캐시를
-- 유지하면 REST 조회가 PGRST205로 실패한다. 트랜잭션 커밋 후 캐시를 갱신한다.
notify pgrst, 'reload schema';

commit;
