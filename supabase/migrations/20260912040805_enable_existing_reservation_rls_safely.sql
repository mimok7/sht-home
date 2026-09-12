-- Applied to the platform project on 2026-09-12 via the approved Supabase
-- migration path. This copy keeps the repository's migration history aligned.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.has_any_role(allowed_roles text[])
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.users
      where id = (select auth.uid()) and role = any (allowed_roles)
    );
$$;
revoke all on function private.has_any_role(text[]) from public;
grant execute on function private.has_any_role(text[]) to authenticated;

create or replace function private.guard_user_profile_write()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception '사용자 식별자는 변경할 수 없습니다.';
  end if;
  if (select private.has_any_role(array['admin'])) then return new; end if;
  if (select private.has_any_role(array['manager'])) then
    if tg_op = 'INSERT' and new.role not in ('member', 'guest') then
      new.role := 'member';
    elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
      new.role := old.role;
    end if;
    return new;
  end if;
  if new.id <> (select auth.uid()) then
    raise exception '다른 사용자의 정보를 변경할 수 없습니다.';
  end if;
  if tg_op = 'INSERT' then new.role := 'member';
  elsif new.role is distinct from old.role then new.role := old.role;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_user_profile_write() from public;

drop trigger if exists guard_user_profile_write on public.users;
create trigger guard_user_profile_write before insert or update on public.users
for each row execute function private.guard_user_profile_write();

drop policy if exists "Allow users to view own profile or admin view all" on public.users;
drop policy if exists "Only admins can delete users" on public.users;
drop policy if exists "Service role full access to users" on public.users;
drop policy if exists manager_can_select_users_with_reservations on public.users;
drop policy if exists users_dispatcher_read_policy on public.users;
drop policy if exists users_self_policy on public.users;

create policy users_self_select on public.users for select to authenticated
using (id = (select auth.uid()));
create policy users_staff_select on public.users for select to authenticated
using ((select private.has_any_role(array['manager', 'admin'])));
create policy users_dispatcher_select on public.users for select to authenticated
using ((select private.has_any_role(array['dispatcher'])));
create policy users_self_or_staff_insert on public.users for insert to authenticated
with check (id = (select auth.uid()) or (select private.has_any_role(array['manager', 'admin'])));
create policy users_self_or_staff_update on public.users for update to authenticated
using (id = (select auth.uid()) or (select private.has_any_role(array['manager', 'admin'])))
with check (id = (select auth.uid()) or (select private.has_any_role(array['manager', 'admin'])));
create policy users_admin_delete on public.users for delete to authenticated
using ((select private.has_any_role(array['admin'])));

alter table public.business_notifications enable row level security;
alter table public.cruise_document enable row level security;
alter table public.customer_notifications enable row level security;
alter table public.customer_requests enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.notifications enable row level security;
alter table public.partner enable row level security;
alter table public.payment_notifications enable row level security;
alter table public.quote enable row level security;
alter table public.quote_item enable row level security;
alter table public.reservation enable row level security;
alter table public.reservation_airport enable row level security;
alter table public.reservation_car_sht enable row level security;
alter table public.reservation_cruise enable row level security;
alter table public.reservation_cruise_car enable row level security;
alter table public.reservation_package enable row level security;
alter table public.reservation_payments enable row level security;
alter table public.reservation_rentcar enable row level security;
alter table public.users enable row level security;
