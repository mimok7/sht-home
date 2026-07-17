begin;

-- Member records are separate from auth.users so operational fields and role
-- assignments can be managed without exposing the Auth schema through Data API.
create schema if not exists private;

create table if not exists public.member_roles (
  id text primary key,
  label text not null,
  description text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.member_roles (id, label, description, permissions)
values
  ('admin', '관리자', '회원·상품·권한 전체 관리', '{"manage_members": true, "manage_cruises": true}'::jsonb),
  ('manager', '운영자', '운영 데이터와 예약 관리', '{"manage_members": false, "manage_cruises": true}'::jsonb),
  ('editor', '편집자', '크루즈 설명과 추천 기준 편집', '{"manage_members": false, "manage_cruises": true}'::jsonb),
  ('viewer', '조회자', '관리 화면 조회만 가능', '{"manage_members": false, "manage_cruises": false}'::jsonb)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  permissions = excluded.permissions;

create table if not exists public.member_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  phone text,
  role_id text not null references public.member_roles(id) default 'viewer',
  status text not null default 'active' check (status in ('active', 'suspended')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_profiles_role_idx on public.member_profiles (role_id, status);

-- This trigger runs only inside Postgres and copies safe signup fields into the
-- profile table. Authorization never relies on raw_user_meta_data.
create or replace function private.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  insert into public.member_profiles (id, email, display_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_member on auth.users;
create trigger on_auth_user_created_member
  after insert on auth.users
  for each row execute procedure private.handle_new_member();

-- The function is kept in the private schema and explicitly checks auth.uid().
-- It allows role changes from the admin screen to take effect on the next RLS
-- check without trusting user-editable JWT metadata.
create or replace function private.has_member_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.member_profiles p
    join public.member_roles r on r.id = p.role_id
    where p.id = (select auth.uid())
      and p.status = 'active'
      and coalesce(r.permissions ->> permission_key, 'false') = 'true'
  );
$$;

revoke all on function private.has_member_permission(text) from public;
grant execute on function private.has_member_permission(text) to authenticated;

create or replace function public.is_cruise_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or (select private.has_member_permission('manage_members'));
$$;

alter table public.member_roles enable row level security;
alter table public.member_profiles enable row level security;

drop policy if exists "members read own profile" on public.member_profiles;
create policy "members read own profile" on public.member_profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "admins manage member profiles" on public.member_profiles;
create policy "admins manage member profiles" on public.member_profiles
  for all to authenticated
  using ((select public.is_cruise_admin()))
  with check ((select public.is_cruise_admin()));

drop policy if exists "admins read member roles" on public.member_roles;
create policy "admins read member roles" on public.member_roles
  for select to authenticated
  using ((select public.is_cruise_admin()));

drop policy if exists "admins update member roles" on public.member_roles;
create policy "admins update member roles" on public.member_roles
  for update to authenticated
  using ((select public.is_cruise_admin()))
  with check ((select public.is_cruise_admin()));

grant select, update on public.member_roles to authenticated;
grant select, update on public.member_profiles to authenticated;

commit;
