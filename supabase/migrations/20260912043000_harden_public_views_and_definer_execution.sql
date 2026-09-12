-- Keep public product catalog reads while making every public view evaluate RLS
-- as the requesting role, rather than as the view owner.
drop policy if exists legacy_cruise_info_public_read on public.cruise_info;
create policy legacy_cruise_info_public_read
  on public.cruise_info for select to anon, authenticated using (true);

alter view public.available_tours_by_date set (security_invoker = true);
alter view public.cruise_info_by_category set (security_invoker = true);
alter view public.cruise_info_view set (security_invoker = true);
alter view public.cruise_rooms_view set (security_invoker = true);
alter view public.dispatcher_users set (security_invoker = true);
alter view public.manager_reservations set (security_invoker = true);
alter view public.ticket_price_active_v set (security_invoker = true);
alter view public.tour_stats set (security_invoker = true);
alter view public.v_airport_reservation_status set (security_invoker = true);
alter view public.v_customer_requests_stats set (security_invoker = true);
alter view public.v_notification_stats set (security_invoker = true);

create or replace function public.create_reservation_notification(p_reservation_id uuid, p_user_id uuid)
returns uuid language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  reservation_rec record; user_rec record; quote_rec record; notification_id uuid;
  title_text text; message_text text; service_name text;
  v_actor uuid := auth.uid(); v_is_staff boolean;
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  v_is_staff := private.has_any_role(array['manager', 'admin']);
  select re_id, re_user_id, re_quote_id, re_type, re_status, total_amount into reservation_rec
  from public.reservation where re_id = p_reservation_id;
  if not found then raise exception 'reservation_not_found'; end if;
  if not v_is_staff and reservation_rec.re_user_id is distinct from v_actor then raise exception 'not_authorized'; end if;
  if not v_is_staff and p_user_id is not null and p_user_id is distinct from reservation_rec.re_user_id then raise exception 'not_authorized'; end if;
  select name, email, phone_number into user_rec from public.users where id = coalesce(p_user_id, reservation_rec.re_user_id);
  if reservation_rec.re_quote_id is not null then select title into quote_rec from public.quote where id = reservation_rec.re_quote_id; end if;
  service_name := case reservation_rec.re_type
    when 'cruise' then '크루즈' when 'airport' then '공항 서비스' when 'hotel' then '호텔'
    when 'tour' then '투어' when 'rentcar' then '렌터카' when 'golf' then '골프'
    when 'car' then '차량' when 'car_sht' then '스하차량' when 'vehicle' then '차량'
    else reservation_rec.re_type end;
  title_text := '신규 ' || service_name || ' 예약: ' || coalesce(user_rec.name, '고객명없음');
  message_text := format(
    '고객명: %s\n이메일: %s\n연락처: %s\n서비스: %s\n견적명: %s\n예약 금액: %s원\n예약 상태: %s\n\n확인 및 처리 부탁드립니다.',
    coalesce(user_rec.name, '이름없음'), coalesce(user_rec.email, '이메일없음'), coalesce(user_rec.phone_number, '연락처없음'),
    service_name, coalesce(quote_rec.title, '연결된 견적 없음'), coalesce(reservation_rec.total_amount::text, '0'),
    case reservation_rec.re_status when 'pending' then '대기중' when 'confirmed' then '확정됨' when 'processing' then '처리중' else reservation_rec.re_status end
  );
  select public.create_business_notification(
    '예약', '신규신청', title_text, message_text, '높음', user_rec.name, user_rec.email, user_rec.phone_number,
    'reservation', reservation_rec.re_id::text,
    jsonb_build_object('reservation_id', reservation_rec.re_id, 'user_id', reservation_rec.re_user_id, 'service_type', reservation_rec.re_type, 'total_amount', reservation_rec.total_amount)
  ) into notification_id;
  return notification_id;
end;
$function$;

create or replace function public.claim_cruise_promotion_usage(
  p_promotion_code text, p_quote_id uuid default null, p_reservation_id uuid default null,
  p_reservation_cruise_id uuid default null, p_user_id uuid default auth.uid(), p_metadata jsonb default '{}'::jsonb
)
returns table(claimed boolean, promotion_id uuid, quota_total integer, used_count integer, remaining_count integer, reason text)
language plpgsql security definer set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_promotion public.cruise_promotion%rowtype; v_existing public.cruise_promotion_usage%rowtype;
  v_used_count integer; v_actor uuid := auth.uid(); v_is_staff boolean;
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  v_is_staff := private.has_any_role(array['manager', 'admin']); p_user_id := coalesce(p_user_id, v_actor);
  if not v_is_staff and p_user_id is distinct from v_actor then raise exception 'not_authorized'; end if;
  if p_quote_id is not null and not v_is_staff and not exists (select 1 from public.quote q where q.id = p_quote_id and q.user_id = v_actor) then raise exception 'not_authorized'; end if;
  if p_reservation_id is not null and not v_is_staff and not exists (select 1 from public.reservation r where r.re_id = p_reservation_id and r.re_user_id = v_actor) then raise exception 'not_authorized'; end if;
  if p_reservation_cruise_id is not null and not exists (
    select 1 from public.reservation_cruise rc join public.reservation r on r.re_id = rc.reservation_id
    where rc.id = p_reservation_cruise_id and (p_reservation_id is null or rc.reservation_id = p_reservation_id) and (v_is_staff or r.re_user_id = v_actor)
  ) then raise exception 'not_authorized'; end if;
  select * into v_promotion from public.cruise_promotion where code = p_promotion_code and is_active = true for update;
  if not found then return query select false, null::uuid, 0, 0, 0, 'promotion_not_found'; return; end if;
  if p_quote_id is not null then
    select * into v_existing from public.cruise_promotion_usage where promotion_id = v_promotion.id and quote_id = p_quote_id and status in ('reserved', 'confirmed') limit 1;
    if found then
      if p_reservation_id is not null and v_existing.reservation_id is null then
        update public.cruise_promotion_usage set reservation_id = p_reservation_id, reservation_cruise_id = coalesce(p_reservation_cruise_id, reservation_cruise_id), status = 'confirmed', metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb), updated_at = now() where id = v_existing.id;
      end if;
      select count(*)::integer into v_used_count from public.cruise_promotion_usage where promotion_id = v_promotion.id and status in ('reserved', 'confirmed');
      return query select true, v_promotion.id, v_promotion.quota_total, v_used_count, greatest(v_promotion.quota_total - v_used_count, 0), case when p_reservation_id is not null then 'confirmed_existing_claim' else 'already_claimed' end; return;
    end if;
  end if;
  if p_reservation_id is not null then
    select * into v_existing from public.cruise_promotion_usage where promotion_id = v_promotion.id and reservation_id = p_reservation_id and status in ('reserved', 'confirmed') limit 1;
    if found then
      select count(*)::integer into v_used_count from public.cruise_promotion_usage where promotion_id = v_promotion.id and status in ('reserved', 'confirmed');
      return query select true, v_promotion.id, v_promotion.quota_total, v_used_count, greatest(v_promotion.quota_total - v_used_count, 0), 'already_claimed'; return;
    end if;
  end if;
  select count(*)::integer into v_used_count from public.cruise_promotion_usage where promotion_id = v_promotion.id and status in ('reserved', 'confirmed');
  if v_used_count >= v_promotion.quota_total then return query select false, v_promotion.id, v_promotion.quota_total, v_used_count, 0, 'quota_exhausted'; return; end if;
  insert into public.cruise_promotion_usage (promotion_id, quote_id, reservation_id, reservation_cruise_id, user_id, status, metadata)
  values (v_promotion.id, p_quote_id, p_reservation_id, p_reservation_cruise_id, p_user_id, case when p_reservation_id is not null then 'confirmed' else 'reserved' end, coalesce(p_metadata, '{}'::jsonb));
  v_used_count := v_used_count + 1;
  return query select true, v_promotion.id, v_promotion.quota_total, v_used_count, greatest(v_promotion.quota_total - v_used_count, 0), 'claimed';
end;
$function$;

create or replace function public.recompute_reservation_total(p_reservation_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare v_total numeric(14,2) := 0; v_re_type text;
begin
  if auth.uid() is null or not private.has_any_role(array['manager', 'admin']) then raise exception 'not_authorized'; end if;
  select re_type into v_re_type from public.reservation where re_id = p_reservation_id;
  if v_re_type = 'package' then raise notice '예약 % 은 패키지 예약이므로 자동 재계산을 스킵합니다.', p_reservation_id; return; end if;
  select
      coalesce((select sum(case when coalesce(room_total_price, 0) > 0 then room_total_price else coalesce(unit_price, 0) * coalesce(guest_count, 1) end) from public.reservation_cruise where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(car_total_price, 0)) from public.reservation_cruise_car where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(case when coalesce(total_price, 0) > 0 then total_price else coalesce(unit_price, 0) * coalesce(ra_car_count, 1) end) from public.reservation_airport where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(total_price, 0)) from public.reservation_hotel where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(total_price, 0)) from public.reservation_tour where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(case when coalesce(total_price, 0) > 0 then total_price else coalesce(unit_price, 0) * coalesce(car_count, 1) end) from public.reservation_rentcar where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(car_total_price, 0)) from public.reservation_car_sht where reservation_id = p_reservation_id), 0)
  into v_total;
  update public.reservation set total_amount = coalesce(v_total, 0) where re_id = p_reservation_id;
  raise notice '예약 % 총금액이 %동으로 업데이트됨', p_reservation_id, v_total;
end;
$function$;

create or replace function public.recompute_all_reservation_totals()
returns table(reservation_id uuid, total_amount numeric) language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare r record; v_count integer := 0;
begin
  if auth.uid() is null or not private.has_any_role(array['manager', 'admin']) then raise exception 'not_authorized'; end if;
  for r in select re_id from public.reservation loop perform public.recompute_reservation_total(r.re_id); v_count := v_count + 1; end loop;
  raise notice '총 %개 예약의 총금액이 재계산되었습니다.', v_count;
  return query select re_id, public.reservation.total_amount from public.reservation order by total_amount desc;
end;
$function$;

do $block$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', fn.signature);
  end loop;
end;
$block$;

grant execute on function public.get_applicable_cruise_rate_cards(text, date, text, text, date) to anon, authenticated;
grant execute on function public.claim_cruise_promotion_usage(text, uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_reservation_notification(uuid, uuid) to authenticated;
grant execute on function public.admin_get_push_subscription_app_counts() to authenticated;
grant execute on function public.delete_manager_notification_presence(text, text) to authenticated;
grant execute on function public.upsert_manager_notification_presence(text, text, text, text, boolean) to authenticated;
grant execute on function public.recompute_reservation_total(uuid) to authenticated;
grant execute on function public.recompute_all_reservation_totals() to authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;
