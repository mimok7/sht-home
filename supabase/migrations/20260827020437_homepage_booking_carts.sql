begin;

-- Customer cart selections are owned by the homepage project. They are not
-- reservations, quotes, or payment records, and no platform table references
-- this table. The platform user UUID is verified server-side before every read
-- and write because platform and homepage Auth are separate projects.
create table public.homepage_booking_carts (
  id uuid primary key default gen_random_uuid(),
  platform_user_id uuid not null unique,
  status text not null default 'active' check (status in ('active', 'checkout_requested', 'abandoned')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  item_count integer not null default 0 check (item_count between 0 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.homepage_booking_carts is 'Homepage-only customer cart. Platform reservations and payments are never stored here.';
comment on column public.homepage_booking_carts.platform_user_id is 'UUID from the separate booking-platform Auth project; intentionally no cross-database foreign key.';
comment on column public.homepage_booking_carts.items is 'Normalized customer product selections. Prices are reference-only until platform confirmation.';

alter table public.homepage_booking_carts enable row level security;

-- Cross-project platform JWTs cannot satisfy homepage Auth RLS. All access is
-- therefore restricted to the server route using the homepage service role,
-- after it verifies the platform bearer token and matches platform_user_id.
revoke all on table public.homepage_booking_carts from anon, authenticated;
grant all on table public.homepage_booking_carts to service_role;

commit;
