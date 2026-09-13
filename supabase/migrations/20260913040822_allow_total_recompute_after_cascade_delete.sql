-- 예약 삭제의 연쇄 상세 삭제 중에는 이미 사라진 부모 합계 재계산을 건너뛴다.

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
    return 0;
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
