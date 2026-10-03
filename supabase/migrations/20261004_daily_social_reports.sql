create table if not exists public.daily_social_reports (
  session_date date not null,
  kind text not null check (kind in ('stock','accumulation','market','follow_up')),
  job_run_id uuid not null,
  symbol text,
  status text not null check (status in ('generating','ready','failed','skipped')),
  question text,
  content text,
  evidence jsonb not null default '[]'::jsonb,
  validation jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_date, kind)
);
alter table public.daily_social_reports enable row level security;
revoke all on public.daily_social_reports from anon, authenticated;
grant select, insert, update on public.daily_social_reports to service_role;
