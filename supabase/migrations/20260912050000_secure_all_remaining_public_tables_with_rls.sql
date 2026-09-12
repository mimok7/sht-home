-- All public tables must have RLS. Service-role/server access remains unchanged;
-- client roles receive only the policies declared below.
do $block$
declare
  tbl record;
begin
  for tbl in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table %I.%I enable row level security', tbl.nspname, tbl.relname);
  end loop;
end;
$block$;

-- Public product, pricing, and policy records remain read-only to customers.
do $block$
declare
  tbl text;
  catalog_tables text[] := array[
    'airport_name', 'cruise_tour_options', 'hotel_info', 'hotel_price',
    'package_items', 'package_master', 'payment_info', 'ticket_price',
    'tour_cancellation_policy', 'tour_cruise_integration',
    'tour_important_info', 'tour_payment_pricing'
  ];
begin
  foreach tbl in array catalog_tables loop
    execute format('create policy public_catalog_read on public.%I for select to anon, authenticated using (true)', tbl);
    execute format(
      'create policy catalog_staff_manage on public.%I for all to authenticated using ((select private.has_any_role(array[''manager'', ''admin'']))) with check ((select private.has_any_role(array[''manager'', ''admin''])))',
      tbl
    );
  end loop;
end;
$block$;

-- Old backups, legacy booking staging data, and synchronized sheets are staff-only.
do $block$
declare
  tbl text;
  internal_tables text[] := array[
    '_archive_reservation_no_quote_airport_backup_20260426',
    '_archive_reservation_no_quote_backup_20260426',
    '_archive_reservation_no_quote_cruise_backup_20260426',
    '_archive_reservation_no_quote_tour_backup_20260426',
    '_backup_122_rollback_target_hotel_price_20260705',
    '_backup_pg_indexes_20260426', '_backup_pg_policies_20260426',
    'backup_reservation_car_sht', 'car', 'reservation_no_quote_backup',
    'reservation_no_quote_reservation_airport_backup',
    'reservation_no_quote_reservation_cruise_backup',
    'reservation_no_quote_reservation_tour_backup', 'room',
    'sh_c', 'sh_cc', 'sh_h', 'sh_m', 'sh_p', 'sh_r', 'sh_rc', 'sh_t'
  ];
begin
  foreach tbl in array internal_tables loop
    execute format(
      'create policy internal_staff_only on public.%I for all to authenticated using ((select private.has_any_role(array[''manager'', ''admin'']))) with check ((select private.has_any_role(array[''manager'', ''admin''])))',
      tbl
    );
  end loop;
end;
$block$;

-- Reservation detail rows are visible to the owner and manageable by staff.
do $block$
declare
  tbl text;
  reservation_detail_tables text[] := array[
    'reservation_hotel', 'reservation_tour', 'reservation_airport_fasttrack'
  ];
begin
  foreach tbl in array reservation_detail_tables loop
    execute format(
      'create policy reservation_detail_owner_read on public.%I for select to authenticated using (exists (select 1 from public.reservation r where r.re_id = %I.reservation_id and r.re_user_id = (select auth.uid())))',
      tbl, tbl
    );
    execute format(
      'create policy reservation_detail_staff_manage on public.%I for all to authenticated using ((select private.has_any_role(array[''manager'', ''admin'']))) with check ((select private.has_any_role(array[''manager'', ''admin''])))',
      tbl
    );
  end loop;
end;
$block$;

-- Payment and confirmation records contain transaction or contact information.
create policy reservation_payment_owner_read
  on public.reservation_payment for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.reservation r
      where r.re_id = reservation_payment.reservation_id
        and r.re_user_id = (select auth.uid())
    )
  );
create policy reservation_payment_staff_manage
  on public.reservation_payment for all to authenticated
  using ((select private.has_any_role(array['manager', 'admin'])))
  with check ((select private.has_any_role(array['manager', 'admin'])));

create policy confirmation_status_owner_read
  on public.confirmation_status for select to authenticated
  using (
    exists (
      select 1 from public.reservation r
      where r.re_id = confirmation_status.reservation_id
        and r.re_user_id = (select auth.uid())
    ) or exists (
      select 1 from public.quote q
      where q.id = confirmation_status.quote_id
        and q.user_id = (select auth.uid())
    )
  );
create policy confirmation_status_staff_manage
  on public.confirmation_status for all to authenticated
  using ((select private.has_any_role(array['manager', 'admin'])))
  with check ((select private.has_any_role(array['manager', 'admin'])));

create policy reservation_confirmation_owner_read
  on public.reservation_confirmation for select to authenticated
  using (
    exists (
      select 1 from public.reservation r
      where r.re_id = reservation_confirmation.reservation_id
        and r.re_user_id = (select auth.uid())
    ) or exists (
      select 1 from public.quote q
      where q.id = reservation_confirmation.quote_id
        and q.user_id = (select auth.uid())
    )
  );
create policy reservation_confirmation_staff_manage
  on public.reservation_confirmation for all to authenticated
  using ((select private.has_any_role(array['manager', 'admin'])))
  with check ((select private.has_any_role(array['manager', 'admin'])));

-- Keep customer idempotency records private and prevent cross-account quote use.
create policy direct_booking_request_owner_read
  on public.direct_booking_submit_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy direct_booking_request_owner_insert
  on public.direct_booking_submit_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      quote_id is null
      or exists (
        select 1 from public.quote q
        where q.id = direct_booking_submit_requests.quote_id
          and q.user_id = (select auth.uid())
      )
    )
  );
create policy direct_booking_request_staff_manage
  on public.direct_booking_submit_requests for all to authenticated
  using ((select private.has_any_role(array['manager', 'admin'])))
  with check ((select private.has_any_role(array['manager', 'admin'])));
