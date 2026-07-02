-- stokscan_ai schema
-- Generated for migration from FastAPI/HuggingFace to Supabase
-- Run in Supabase SQL Editor

-- 0. Extensions
create extension if not exists pgcrypto;

-- 1. stocks
create table if not exists public.stocks (
  id bigserial primary key,
  symbol text not null,
  exchange text not null,
  country text not null,
  sector text,
  currency text default 'EGP',
  name text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(symbol, exchange)
);
create index if not exists stocks_symbol_exchange_idx on public.stocks(symbol, exchange);

-- 2. stock_prices
create table if not exists public.stock_prices (
  id bigserial primary key,
  stock_id bigint not null references public.stocks(id) on delete cascade,
  symbol text,
  exchange text,
  date date not null,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume bigint,
  source text,
  created_at timestamptz default now(),
  unique(stock_id, date, source)
);
create index if not exists stock_prices_stock_date_idx on public.stock_prices(stock_id, date desc);
create index if not exists stock_prices_symbol_exchange_date_idx on public.stock_prices(symbol, exchange, date desc);

-- 3. technical_indicators
create table if not exists public.technical_indicators (
  id bigserial primary key,
  stock_id bigint not null references public.stocks(id) on delete cascade,
  date date not null,
  rsi14 double precision,
  macd double precision,
  macd_signal double precision,
  macd_hist double precision,
  ema20 double precision,
  ema50 double precision,
  sma20 double precision,
  sma50 double precision,
  atr14 double precision,
  volume_ratio double precision,
  boll_upper double precision,
  boll_lower double precision,
  created_at timestamptz default now(),
  unique(stock_id, date)
);
create index if not exists technical_indicators_stock_date_idx on public.technical_indicators(stock_id, date desc);

-- 3b. Route-compatible technical snapshot table
create table if not exists public.stock_technical_indicators (
  id bigserial primary key,
  symbol text not null,
  exchange text not null,
  close double precision,
  rsi_14 double precision,
  ema_50 double precision,
  ema_200 double precision,
  momentum_10 double precision,
  atr_14 double precision,
  adx_14 double precision,
  stoch_k double precision,
  stoch_d double precision,
  cci_20 double precision,
  vwap_20 double precision,
  roc_12 double precision,
  volume double precision,
  volume_sma_20 double precision,
  change_pct double precision,
  updated_at timestamptz default now(),
  unique(symbol, exchange)
);
create index if not exists stock_technical_indicators_symbol_exchange_idx on public.stock_technical_indicators(symbol, exchange);

-- 4. ai_scores
create table if not exists public.ai_scores (
  id bigserial primary key,
  stock_id bigint not null references public.stocks(id) on delete cascade,
  model_name text not null,
  score double precision not null,
  direction text not null,
  confidence double precision,
  predicted_at timestamptz default now(),
  for_date date,
  details jsonb,
  unique(stock_id, model_name, for_date)
);
create index if not exists ai_scores_stock_model_date_idx on public.ai_scores(stock_id, model_name, for_date);

-- 5. historical_similarity
create table if not exists public.historical_similarity (
  id bigserial primary key,
  stock_id bigint not null references public.stocks(id) on delete cascade,
  scanned_at timestamptz default now(),
  similar_patterns jsonb not null,
  stats jsonb
);
create index if not exists historical_similarity_stock_idx on public.historical_similarity(stock_id, scanned_at desc);

-- 6. backtests
create table if not exists public.backtests (
  id text primary key,
  exchange text not null,
  model text not null,
  status text default 'running',
  params jsonb,
  summary jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists backtests_exchange_idx on public.backtests(exchange);

-- 7. backtest_trades
create table if not exists public.backtest_trades (
  id bigserial primary key,
  backtest_id text not null references public.backtests(id) on delete cascade,
  stock_id bigint references public.stocks(id),
  entry_date date,
  exit_date date,
  direction text,
  pnl double precision,
  return_pct double precision,
  metadata jsonb,
  created_at timestamptz default now()
);
create index if not exists backtest_trades_backtest_idx on public.backtest_trades(backtest_id);

-- 8. market_heatmap
create table if not exists public.market_heatmap (
  id bigserial primary key,
  exchange text not null,
  sector text,
  symbol text not null,
  change_pct double precision,
  volume double precision,
  cap double precision,
  source text,
  captured_at timestamptz default now(),
  unique(exchange, symbol, captured_at)
);
create index if not exists market_heatmap_exchange_sector_idx on public.market_heatmap(exchange, sector, captured_at desc);

-- 9. market_sectors_timeline
create table if not exists public.market_sectors_timeline (
  id bigserial primary key,
  exchange text not null,
  sector text not null,
  date date not null,
  avg_return double precision,
  advance_count integer,
  decline_count integer,
  source text,
  unique(exchange, sector, date)
);

-- 10. news
create table if not exists public.news (
  id bigserial primary key,
  stock_id bigint references public.stocks(id) on delete cascade,
  title text not null,
  url text,
  source text,
  published_at timestamptz,
  sentiment_score double precision,
  sentiment_label text,
  created_at timestamptz default now()
);
create index if not exists news_stock_published_idx on public.news(stock_id, published_at desc);

-- 11. scan_alerts
create table if not exists public.scan_alerts (
  id bigserial primary key,
  user_id text,
  symbol text not null,
  exchange text not null,
  condition jsonb not null,
  is_active boolean default true,
  last_triggered_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists scan_alerts_user_idx on public.scan_alerts(user_id);

-- 12. scan_results
create table if not exists public.scan_results (
  id bigserial primary key,
  symbol text not null,
  exchange text not null,
  name text,
  last_close double precision,
  precision double precision,
  signal text,
  top_reasons jsonb,
  council_score double precision,
  consensus_ratio text,
  updated_at timestamptz default now(),
  unique(symbol, exchange)
);
create index if not exists scan_results_symbol_exchange_idx on public.scan_results(symbol, exchange);

-- 12. subscriptions
create table if not exists public.subscriptions (
  id bigserial primary key,
  user_id text not null,
  symbol text not null,
  exchange text not null,
  meta jsonb,
  created_at timestamptz default now(),
  unique(user_id, symbol, exchange)
);

-- 13. model_metadata
create table if not exists public.model_metadata (
  id bigserial primary key,
  name text primary key,
  exchange text,
  accuracy double precision,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb
);

-- 14. daily_job_logs
create table if not exists public.daily_job_logs (
  id bigserial primary key,
  exchange text not null,
  model text not null,
  status text not null,
  started_at timestamptz default now(),
  finished_at timestamptz,
  summary jsonb
);
create index if not exists daily_job_logs_exchange_idx on public.daily_job_logs(exchange, started_at desc);

-- 15. Fundamentals compatibility table and helpers
create table if not exists public.stock_fundamentals (
  id bigserial primary key,
  symbol text not null,
  exchange text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(symbol, exchange)
);

create or replace function public.get_active_countries()
returns table(country text)
language sql
security definer
as $$
  with uniq_countries as (
    select distinct trim(both ' ' from lower(data->>'country')) as country
    from public.stock_fundamentals
    where data->>'country' is not null
      and trim(both ' ' from data->>'country') <> ''
  )
  select country
  from uniq_countries
  where country is not null
  order by country asc;
$$;

grant execute on function public.get_active_countries() to anon;
grant execute on function public.get_active_countries() to authenticated;
