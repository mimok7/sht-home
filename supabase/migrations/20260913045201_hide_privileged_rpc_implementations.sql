-- 공개 카탈로그 조회는 RLS/GRANT만으로 동일 결과를 내므로 invoker로 전환한다.
alter function public.get_applicable_cruise_rate_cards(text, date, text, text, date)
  security invoker;

-- RLS를 넘어 전체 집계·원자적 갱신이 필요한 구현은 비노출 private 스키마로
-- 이동한다. 공개 RPC 이름은 invoker 래퍼로 유지해 기존 앱 호출 계약을 보존한다.
alter function public.admin_get_push_subscription_app_counts() set schema private;
alter function public.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb) set schema private;
alter function public.create_reservation_notification(uuid, uuid) set schema private;
alter function public.delete_manager_notification_presence(text, text) set schema private;
alter function public.recompute_all_reservation_totals() set schema private;
alter function public.recompute_reservation_total(uuid) set schema private;
alter function public.upsert_manager_notification_presence(text, text, text, text, boolean) set schema private;

alter function private.admin_get_push_subscription_app_counts()
  set search_path = pg_catalog, public, private;
alter function private.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb)
  set search_path = pg_catalog, public, private;
alter function private.create_reservation_notification(uuid, uuid)
  set search_path = pg_catalog, public, private;
alter function private.delete_manager_notification_presence(text, text)
  set search_path = pg_catalog, public, private;
alter function private.recompute_all_reservation_totals()
  set search_path = pg_catalog, public, private;
alter function private.recompute_reservation_total(uuid)
  set search_path = pg_catalog, public, private;
alter function private.upsert_manager_notification_presence(text, text, text, text, boolean)
  set search_path = pg_catalog, public, private;

revoke all on function private.admin_get_push_subscription_app_counts()
  from public, anon, authenticated;
revoke all on function private.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function private.create_reservation_notification(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.delete_manager_notification_presence(text, text)
  from public, anon, authenticated;
revoke all on function private.recompute_all_reservation_totals()
  from public, anon, authenticated;
revoke all on function private.recompute_reservation_total(uuid)
  from public, anon, authenticated;
revoke all on function private.upsert_manager_notification_presence(text, text, text, text, boolean)
  from public, anon, authenticated;

grant usage on schema private to authenticated, service_role;
grant execute on function private.admin_get_push_subscription_app_counts()
  to authenticated, service_role;
grant execute on function private.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb)
  to authenticated, service_role;
grant execute on function private.create_reservation_notification(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.delete_manager_notification_presence(text, text)
  to authenticated, service_role;
grant execute on function private.recompute_all_reservation_totals()
  to authenticated, service_role;
grant execute on function private.recompute_reservation_total(uuid)
  to authenticated, service_role;
grant execute on function private.upsert_manager_notification_presence(text, text, text, text, boolean)
  to authenticated, service_role;

create function public.admin_get_push_subscription_app_counts()
returns table(app_name text, total_count bigint, active_count bigint)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.admin_get_push_subscription_app_counts();
$function$;

create function public.claim_cruise_promotion_usage(
  p_promotion_code text,
  p_quote_id uuid default null,
  p_reservation_id uuid default null,
  p_reservation_cruise_id uuid default null,
  p_user_id uuid default auth.uid(),
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  claimed boolean,
  promotion_id uuid,
  quota_total integer,
  used_count integer,
  remaining_count integer,
  reason text
)
language sql
security invoker
set search_path = ''
as $function$
  select *
  from private.claim_cruise_promotion_usage(
    p_promotion_code,
    p_quote_id,
    p_reservation_id,
    p_reservation_cruise_id,
    p_user_id,
    p_metadata
  );
$function$;

create function public.create_reservation_notification(
  p_reservation_id uuid,
  p_user_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.create_reservation_notification(p_reservation_id, p_user_id);
$function$;

create function public.delete_manager_notification_presence(
  p_app_name text,
  p_tab_id text
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.delete_manager_notification_presence(p_app_name, p_tab_id);
$function$;

create function public.recompute_all_reservation_totals()
returns table(reservation_id uuid, total_amount numeric)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.recompute_all_reservation_totals();
$function$;

create function public.recompute_reservation_total(
  p_reservation_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.recompute_reservation_total(p_reservation_id);
$function$;

create function public.upsert_manager_notification_presence(
  p_app_name text,
  p_tab_id text,
  p_device_id text,
  p_device_label text,
  p_is_leader boolean
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.upsert_manager_notification_presence(
    p_app_name,
    p_tab_id,
    p_device_id,
    p_device_label,
    p_is_leader
  );
$function$;

revoke all on function public.admin_get_push_subscription_app_counts()
  from public, anon, authenticated;
revoke all on function public.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_reservation_notification(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_manager_notification_presence(text, text)
  from public, anon, authenticated;
revoke all on function public.recompute_all_reservation_totals()
  from public, anon, authenticated;
revoke all on function public.recompute_reservation_total(uuid)
  from public, anon, authenticated;
revoke all on function public.upsert_manager_notification_presence(text, text, text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.admin_get_push_subscription_app_counts()
  to authenticated, service_role;
grant execute on function public.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.create_reservation_notification(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.delete_manager_notification_presence(text, text)
  to authenticated, service_role;
grant execute on function public.recompute_all_reservation_totals()
  to authenticated, service_role;
grant execute on function public.recompute_reservation_total(uuid)
  to authenticated, service_role;
grant execute on function public.upsert_manager_notification_presence(text, text, text, text, boolean)
  to authenticated, service_role;

revoke execute on function public.get_applicable_cruise_rate_cards(text, date, text, text, date)
  from public;
grant execute on function public.get_applicable_cruise_rate_cards(text, date, text, text, date)
  to anon, authenticated, service_role;
