-- Run this in the *booking platform* Supabase project's SQL Editor
-- (project ref: jkhookaflhibrcafmlxn), not the homepage project.
--
-- Both auth users must already exist. It marks the supplied accounts as
-- email-confirmed, resets their passwords to the requested values, and then
-- assigns the platform operator role.

begin;

do $$
declare
  target_emails constant text[] := array[
    'stayhalong@stayhalong.com',
    'kys@hyojacho.es.kr'
  ];
  auth_count integer;
  profile_count integer;
begin
  select count(*)
    into auth_count
  from auth.users
  where lower(email) = any(target_emails);

  if auth_count <> array_length(target_emails, 1) then
    raise exception 'Expected % auth users but found %; create the missing account before assigning admin access.',
      array_length(target_emails, 1), auth_count;
  end if;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      encrypted_password = case lower(email)
        when 'stayhalong@stayhalong.com' then extensions.crypt('stayhalong68!', extensions.gen_salt('bf'))
        when 'kys@hyojacho.es.kr' then extensions.crypt('saintt8922!', extensions.gen_salt('bf'))
      end,
      updated_at = now()
  where lower(email) = any(target_emails);

  select count(*)
    into profile_count
  from public.users
  where lower(email) = any(target_emails);

  if profile_count <> array_length(target_emails, 1) then
    raise exception 'Expected % public.users profiles but found %; ensure the platform signup/profile trigger has completed before retrying.',
      array_length(target_emails, 1), profile_count;
  end if;

  update public.users
  set role = 'admin'
  where lower(email) = any(target_emails);
end;
$$;

commit;

-- Verification (run after the transaction):
select email, role
from public.users
where lower(email) in ('stayhalong@stayhalong.com', 'kys@hyojacho.es.kr')
order by email;
