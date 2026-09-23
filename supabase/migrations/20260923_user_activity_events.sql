-- First-party product usage telemetry for authenticated users.
-- This is intentionally server-readable only: it contains user-level usage data.
create table if not exists public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id text,
  event_name text not null,
  path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_activity_events_created_idx
  on public.user_activity_events(created_at desc);
create index if not exists user_activity_events_user_created_idx
  on public.user_activity_events(user_id, created_at desc);
create index if not exists user_activity_events_name_path_idx
  on public.user_activity_events(event_name, path, created_at desc);

alter table public.user_activity_events enable row level security;
revoke all on table public.user_activity_events from anon, authenticated;
grant select, insert on table public.user_activity_events to service_role;
