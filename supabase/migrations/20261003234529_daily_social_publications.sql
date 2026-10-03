create table if not exists public.daily_social_publications (
  session_date date not null,
  platform text not null check(platform in ('facebook','tiktok')),
  kind text not null,
  state text not null check(state in ('claimed','scheduled','published','failed','ambiguous')),
  post_id text,
  planner_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(session_date,platform),
  foreign key(session_date,kind) references public.daily_social_reports(session_date,kind)
);
alter table public.daily_social_publications enable row level security;
revoke all on public.daily_social_publications from anon,authenticated;
grant select,insert,update on public.daily_social_publications to service_role;
