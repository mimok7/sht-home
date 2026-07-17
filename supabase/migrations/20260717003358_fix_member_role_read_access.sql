begin;

-- Role names and their UI capability labels are not personal data. Allow every
-- signed-in user to read this small lookup table so the admin bootstrap does
-- not depend on a policy that itself needs the role lookup. Changes remain
-- limited to administrators by the existing update policy.
grant select on public.member_roles to authenticated;

drop policy if exists "admins read member roles" on public.member_roles;
drop policy if exists "authenticated read member roles" on public.member_roles;
create policy "authenticated read member roles" on public.member_roles
  for select to authenticated
  using (true);

commit;
