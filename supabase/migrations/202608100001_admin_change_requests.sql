begin;
insert into storage.buckets (id, name, public) values ('admin-change-request-images', 'admin-change-request-images', true) on conflict (id) do update set public = true;
create table if not exists public.admin_change_requests (
  id uuid primary key default gen_random_uuid(), category text not null check (category in ('content','product','design','bug','other')), title text not null check (char_length(title) <= 120), description text not null check (char_length(description) <= 5000), screenshot_paths jsonb not null default '[]'::jsonb, status text not null default 'open' check (status in ('open','in_progress','done')), created_by uuid not null, created_by_email text not null, created_at timestamptz not null default now()
);
create table if not exists public.admin_change_request_comments (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.admin_change_requests(id) on delete cascade, author_id uuid not null, author_email text not null, content text not null check (char_length(content) between 1 and 2000), created_at timestamptz not null default now()
);
create index if not exists admin_change_request_comments_request_idx on public.admin_change_request_comments(request_id, created_at);
alter table public.admin_change_requests enable row level security;
alter table public.admin_change_request_comments enable row level security;
commit;
