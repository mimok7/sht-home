begin;

-- 서비스 역할로만 호출되는 동기화 함수의 API 실행 권한을 명시적으로 제한한다.
revoke all on function public.refresh_platform_catalog_v2() from public, anon, authenticated;
revoke all on function public.refresh_platform_catalog_full_v2() from public, anon, authenticated;
revoke all on function public.platform_catalog_v2_status() from public, anon, authenticated;

grant execute on function public.refresh_platform_catalog_v2() to service_role;
grant execute on function public.refresh_platform_catalog_full_v2() to service_role;
grant execute on function public.platform_catalog_v2_status() to service_role;

commit;
