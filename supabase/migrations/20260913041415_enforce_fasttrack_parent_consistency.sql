-- 패스트트랙 신청이 같은 예약의 공항 이동 행만 참조하도록 제한한다.

drop policy if exists "reservation_detail_owner_or_staff_manage"
  on public.reservation_airport_fasttrack;

create policy "reservation_detail_owner_or_staff_manage"
on public.reservation_airport_fasttrack
for all
to authenticated
using (
  (select private.has_any_role(array['manager', 'admin']))
  or (
    exists (
      select 1
      from public.reservation r
      where r.re_id = reservation_airport_fasttrack.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.reservation_airport a
      where a.id = reservation_airport_fasttrack.reservation_airport_id
        and a.reservation_id = reservation_airport_fasttrack.reservation_id
    )
  )
)
with check (
  (select private.has_any_role(array['manager', 'admin']))
  or (
    exists (
      select 1
      from public.reservation r
      where r.re_id = reservation_airport_fasttrack.reservation_id
        and r.re_user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.reservation_airport a
      where a.id = reservation_airport_fasttrack.reservation_airport_id
        and a.reservation_id = reservation_airport_fasttrack.reservation_id
    )
  )
);
