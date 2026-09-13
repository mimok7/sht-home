-- 어제 강화된 RLS 이후 고객 예약 생성과 서비스별 상세 저장을 복구한다.

-- 고객은 본인 소유의 대기 예약만 생성·수정할 수 있고 상태를 직접 승인하거나
-- 예약 원장을 삭제할 수 없다. 매니저·관리자 정책은 기존 정책으로 유지한다.
drop policy if exists reservation_user_policy on public.reservation;
drop policy if exists "Allow members to create reservations" on public.reservation;
drop policy if exists reservation_owner_insert on public.reservation;
drop policy if exists reservation_owner_update_pending on public.reservation;

create policy reservation_owner_insert
  on public.reservation for insert to authenticated
  with check (
    re_user_id = (select auth.uid())
    and re_status = 'pending'
  );

create policy reservation_owner_update_pending
  on public.reservation for update to authenticated
  using (
    re_user_id = (select auth.uid())
    and re_status = 'pending'
  )
  with check (
    re_user_id = (select auth.uid())
    and re_status = 'pending'
  );

-- 자동 결제 행은 고객의 직접 쓰기가 아니라 예약 트리거 내부에서만 생성한다.
-- 공개 스키마의 기존 트리거 함수를 제거하고 실행 권한이 없는 private 함수로
-- 옮겨 RLS를 우회하는 범위를 이 자동 동기화 작업으로 제한한다.
drop trigger if exists trg_sync_payment_confirmation_on_reservation_approved
  on public.reservation;
drop function if exists public.fn_sync_payment_and_confirmation_on_reservation_approved();

create or replace function private.sync_payment_and_confirmation_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor uuid := auth.uid();
  v_is_staff boolean := false;
  v_is_service boolean := false;
  v_target_payment_status text;
begin
  v_is_service := coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'postgres';
  if v_actor is not null then
    v_is_staff := private.has_any_role(array['manager', 'admin']);
  end if;

  if tg_op = 'INSERT' then
    if not v_is_service and not v_is_staff and new.re_user_id is distinct from v_actor then
      raise exception 'not_authorized';
    end if;
    if not v_is_service and not v_is_staff and new.re_status is distinct from 'pending' then
      raise exception 'not_authorized';
    end if;
  elsif old.re_status is not distinct from new.re_status then
    return new;
  elsif not v_is_service and not v_is_staff then
    raise exception 'not_authorized';
  end if;

  v_target_payment_status := case
    when new.re_status = 'pending' then 'pending'
    when new.re_status in ('approved', 'confirmed', 'completed') then 'completed'
    when new.re_status = 'cancelled' then 'cancelled'
    else null
  end;

  if v_target_payment_status is null then
    return new;
  end if;

  update public.reservation_payment
  set payment_status = v_target_payment_status,
      updated_at = now()
  where reservation_id = new.re_id
    and coalesce(payment_status, 'pending') is distinct from v_target_payment_status;

  if not exists (
    select 1
    from public.reservation_payment rp
    where rp.reservation_id = new.re_id
  ) then
    insert into public.reservation_payment (
      reservation_id,
      quote_id,
      user_id,
      amount,
      payment_method,
      payment_status,
      memo,
      created_at,
      updated_at
    ) values (
      new.re_id,
      new.re_quote_id,
      new.re_user_id,
      coalesce(new.total_amount, 0),
      'BANK',
      v_target_payment_status,
      'AUTO: reservation status sync -> payment status',
      now(),
      now()
    );
  end if;

  if v_target_payment_status = 'completed'
     and to_regclass('public.confirmation_status') is not null then
    insert into public.confirmation_status (
      reservation_id,
      quote_id,
      status,
      created_at,
      updated_at
    ) values (
      new.re_id,
      new.re_quote_id,
      'waiting',
      now(),
      now()
    )
    on conflict (reservation_id)
    do update
      set quote_id = coalesce(excluded.quote_id, confirmation_status.quote_id),
          status = case
            when confirmation_status.status = 'sent' then confirmation_status.status
            else 'waiting'
          end,
          updated_at = now();
  end if;

  return new;
end;
$function$;

revoke all on function private.sync_payment_and_confirmation_from_reservation()
  from public, anon, authenticated;

create trigger trg_sync_payment_confirmation_on_reservation_approved
after insert or update of re_status on public.reservation
for each row
execute function private.sync_payment_and_confirmation_from_reservation();

-- 각 서비스 상세는 예약 소유자와 운영 담당자만 읽고 쓸 수 있다.
do $block$
declare
  tbl text;
  detail_tables text[] := array[
    'reservation_hotel',
    'reservation_tour',
    'reservation_airport_fasttrack'
  ];
begin
  foreach tbl in array detail_tables loop
    execute format('drop policy if exists reservation_detail_owner_read on public.%I', tbl);
    execute format('drop policy if exists reservation_detail_staff_manage on public.%I', tbl);
    execute format('drop policy if exists reservation_detail_owner_or_staff_manage on public.%I', tbl);
    execute format(
      'create policy reservation_detail_owner_or_staff_manage on public.%I for all to authenticated using (exists (select 1 from public.reservation r where r.re_id = %I.reservation_id and r.re_user_id = (select auth.uid())) or (select private.has_any_role(array[''manager'', ''admin'']))) with check (exists (select 1 from public.reservation r where r.re_id = %I.reservation_id and r.re_user_id = (select auth.uid())) or (select private.has_any_role(array[''manager'', ''admin''])))',
      tbl, tbl, tbl
    );
  end loop;
end;
$block$;

drop policy if exists reservation_car_sht_member_policy on public.reservation_car_sht;
drop policy if exists reservation_car_sht_owner_manage on public.reservation_car_sht;
create policy reservation_car_sht_owner_manage
  on public.reservation_car_sht for all to authenticated
  using (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_car_sht.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    or (select private.has_any_role(array['manager', 'admin']))
  )
  with check (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_car_sht.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    or (select private.has_any_role(array['manager', 'admin']))
  );

drop policy if exists reservation_rentcar_member_policy_select on public.reservation_rentcar;
drop policy if exists reservation_rentcar_owner_manage on public.reservation_rentcar;
create policy reservation_rentcar_owner_manage
  on public.reservation_rentcar for all to authenticated
  using (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_rentcar.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    or (select private.has_any_role(array['manager', 'admin']))
  )
  with check (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_rentcar.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    or (select private.has_any_role(array['manager', 'admin']))
  );

-- 패키지 상세의 기존 정책은 모든 인증 사용자가 다른 고객 예약에도 붙일 수 있어
-- 동일한 예약 소유권 조건으로 교체한다.
drop policy if exists "Authenticated users can insert reservation packages" on public.reservation_package;
drop policy if exists "Users can update own reservation packages" on public.reservation_package;
drop policy if exists "Users can view own reservation packages" on public.reservation_package;
drop policy if exists reservation_package_owner_or_staff_manage on public.reservation_package;
create policy reservation_package_owner_or_staff_manage
  on public.reservation_package for all to authenticated
  using (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_package.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    or (select private.has_any_role(array['manager', 'admin']))
  )
  with check (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_package.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    or (select private.has_any_role(array['manager', 'admin']))
  );
