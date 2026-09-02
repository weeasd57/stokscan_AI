-- Migration: corporate actions storage (rights issues, splits, dividends,
-- bonus shares, capital changes, buybacks, M&A, earnings).
-- Filled by:
--   1. api/corporate_actions_engine.py (daily scheduler, Google News RSS)
--   2. web chatbot pipeline on-demand (keyless web search cached back into
--      this table with origin = 'chat_cache')
-- Safe to run multiple times.

create table if not exists public.corporate_actions (
  id bigserial primary key,
  symbol text not null,
  exchange text not null default 'EGX',
  action_type text not null,
  title text not null,
  action_date date,
  published_at timestamptz,
  url text,
  source text,
  sentiment_score double precision,
  sentiment_label text,
  details jsonb,
  confidence double precision default 0.5,
  origin text default 'scheduler',
  dedupe_key text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists corporate_actions_dedupe_idx
  on public.corporate_actions (dedupe_key);

create index if not exists corporate_actions_symbol_published_idx
  on public.corporate_actions (symbol, exchange, published_at desc);

create index if not exists corporate_actions_type_published_idx
  on public.corporate_actions (action_type, published_at desc);

-- Only the service role (Python backend + Next.js route handlers) reads and
-- writes this table; anonymous/authenticated clients get no access.
alter table public.corporate_actions enable row level security;
