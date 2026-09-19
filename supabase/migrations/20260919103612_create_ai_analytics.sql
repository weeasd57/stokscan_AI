-- Internal chatbot telemetry. This table is written/read only by server-side
-- service-role clients and is intentionally unavailable to browser clients.
create table if not exists public.ai_analytics (
  id uuid primary key default gen_random_uuid(),
  session_id uuid null,
  user_id uuid null,
  intent text not null default 'unknown',
  symbols text[] not null default '{}',
  planner_model text,
  response_model text,
  planner_latency_ms integer,
  tools_latency_ms integer,
  response_latency_ms integer,
  total_latency_ms integer not null default 0,
  data_size_chars integer not null default 0,
  correlation_id text,
  error text,
  created_at timestamptz not null default now(),
  constraint ai_analytics_nonnegative_latencies check (
    (planner_latency_ms is null or planner_latency_ms >= 0)
    and (tools_latency_ms is null or tools_latency_ms >= 0)
    and (response_latency_ms is null or response_latency_ms >= 0)
    and total_latency_ms >= 0
    and data_size_chars >= 0
  )
);

create index if not exists ai_analytics_created_at_idx
  on public.ai_analytics (created_at desc);
create index if not exists ai_analytics_session_created_idx
  on public.ai_analytics (session_id, created_at desc);
create index if not exists ai_analytics_correlation_idx
  on public.ai_analytics (correlation_id)
  where correlation_id is not null;

alter table public.ai_analytics enable row level security;
revoke all on table public.ai_analytics from anon, authenticated;
grant select, insert on table public.ai_analytics to service_role;
