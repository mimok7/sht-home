begin;

-- This record is a customer-facing reference quotation only. It is deliberately
-- separate from the operational quote/reservation and payment ledgers.
create table if not exists public.homepage_cart_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  platform_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_name text not null default '' check (char_length(recipient_name) <= 160),
  memo text not null default '' check (char_length(memo) <= 1000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  totals jsonb not null default '{}'::jsonb check (jsonb_typeof(totals) = 'object'),
  item_count integer not null default 0 check (item_count between 1 and 40),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists homepage_cart_quotes_owner_issued_at_idx
  on public.homepage_cart_quotes (platform_user_id, issued_at desc);

comment on table public.homepage_cart_quotes is 'Reference quotations created from homepage carts; not a reservation, operational quote, or payment ledger.';
comment on column public.homepage_cart_quotes.items is 'Normalized cart snapshot at issuance. Amounts are reference-only until reservation confirmation.';

alter table public.homepage_cart_quotes enable row level security;

-- The server verifies the platform bearer token, then accesses this table with
-- the service-role key. Customers never receive direct table access.
revoke all on table public.homepage_cart_quotes from anon, authenticated;
grant all on table public.homepage_cart_quotes to service_role;

commit;
