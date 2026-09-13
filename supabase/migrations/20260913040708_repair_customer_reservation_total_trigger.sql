-- 서비스 상세 변경 트리거가 고객 요청에서도 예약 합계를 안전하게 갱신한다.

create or replace function private.recompute_reservation_total_internal(
  p_reservation_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_total numeric(14,2) := 0;
  v_re_type text;
begin
  select re_type into v_re_type
  from public.reservation
  where re_id = p_reservation_id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if v_re_type = 'package' then
    select coalesce(total_amount, 0) into v_total
    from public.reservation
    where re_id = p_reservation_id;
    return v_total;
  end if;

  select
      coalesce((select sum(case when coalesce(room_total_price, 0) > 0 then room_total_price else coalesce(unit_price, 0) * coalesce(guest_count, 1) end) from public.reservation_cruise where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(car_total_price, 0)) from public.reservation_cruise_car where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(case when coalesce(total_price, 0) > 0 then total_price else coalesce(unit_price, 0) * coalesce(ra_car_count, 1) end) from public.reservation_airport where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(total_price, 0)) from public.reservation_hotel where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(total_price, 0)) from public.reservation_tour where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(case when coalesce(total_price, 0) > 0 then total_price else coalesce(unit_price, 0) * coalesce(car_count, 1) end) from public.reservation_rentcar where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(coalesce(car_total_price, 0)) from public.reservation_car_sht where reservation_id = p_reservation_id), 0)
  into v_total;

  update public.reservation
  set total_amount = coalesce(v_total, 0)
  where re_id = p_reservation_id;

  return coalesce(v_total, 0);
end;
$function$;

revoke all on function private.recompute_reservation_total_internal(uuid)
  from public, anon, authenticated;

create or replace function public.recompute_reservation_total(
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.uid() is null
     or not private.has_any_role(array['manager', 'admin']) then
    raise exception 'not_authorized';
  end if;

  perform private.recompute_reservation_total_internal(p_reservation_id);
end;
$function$;

revoke all on function public.recompute_reservation_total(uuid)
  from public, anon;
grant execute on function public.recompute_reservation_total(uuid)
  to authenticated;

create or replace function public.trg_after_service_change_update_total()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_reservation_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_reservation_id := new.reservation_id;
  else
    v_reservation_id := old.reservation_id;
  end if;

  perform private.recompute_reservation_total_internal(v_reservation_id);
  return coalesce(new, old);
end;
$function$;

revoke all on function public.trg_after_service_change_update_total()
  from public, anon, authenticated;
