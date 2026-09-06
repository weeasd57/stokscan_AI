-- Migration for Chatbot Analytics & Data Source Features
-- Fixes missing tables and columns for chatbot enhancements
-- Run in Supabase SQL Editor

-- 1. Create stock_bars_intraday table if not exists
-- This table is used for real-time stock data and chatbot analysis
create table if not exists public.stock_bars_intraday (
  id bigserial primary key,
  symbol text not null,
  exchange text not null default 'EGX',
  price double precision,
  close_price double precision,
  open_price double precision,
  high_price double precision,
  low_price double precision,
  volume bigint,
  rsi double precision,
  macd double precision,
  volume_ratio double precision,
  accumulation_score double precision,
  distribution_score double precision,
  support double precision,
  resistance double precision,
  date timestamptz default now(),
  name text,
  data_source text default 'supabase',
  created_at timestamptz default now()
);
create index if not exists stock_bars_intraday_symbol_date_idx on public.stock_bars_intraday(symbol, date desc);
create index if not exists stock_bars_intraday_exchange_date_idx on public.stock_bars_intraday(exchange, date desc);

-- 2. Add missing columns to stock_bars_intraday if they don't exist
do $$
begin
  -- Add date column if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'date'
  ) then
    alter table public.stock_bars_intraday add column date timestamptz default now();
  end if;
  
  -- Add price column if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'price'
  ) then
    alter table public.stock_bars_intraday add column price double precision;
  end if;
  
  -- Add close_price column if missing (alias for price)
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'close_price'
  ) then
    alter table public.stock_bars_intraday add column close_price double precision;
  end if;
  
  -- Add other essential columns if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'rsi'
  ) then
    alter table public.stock_bars_intraday add column rsi double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'macd'
  ) then
    alter table public.stock_bars_intraday add column macd double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'volume_ratio'
  ) then
    alter table public.stock_bars_intraday add column volume_ratio double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'accumulation_score'
  ) then
    alter table public.stock_bars_intraday add column accumulation_score double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'distribution_score'
  ) then
    alter table public.stock_bars_intraday add column distribution_score double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'support'
  ) then
    alter table public.stock_bars_intraday add column support double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'resistance'
  ) then
    alter table public.stock_bars_intraday add column resistance double precision;
  end if;
  
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'stock_bars_intraday' 
    and column_name = 'name'
  ) then
    alter table public.stock_bars_intraday add column name text;
  end if;
end $$;

-- 3. Create bot_states table if not exists
-- This table stores live bot performance data for analytics
create table if not exists public.bot_states (
  id bigserial primary key,
  bot_id text not null,
  state jsonb not null,
  saved_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists bot_states_bot_id_idx on public.bot_states(bot_id, saved_at desc);
create index if not exists bot_states_saved_at_idx on public.bot_states(saved_at desc);

-- 4. Add missing columns to bot_states if they don't exist
do $$
begin
  -- Add saved_at column if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'bot_states' 
    and column_name = 'saved_at'
  ) then
    alter table public.bot_states add column saved_at timestamptz default now();
  end if;
end $$;

-- 5. Update backtests table with additional analytics columns if missing
do $$
begin
  -- Add pre_council_trades if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'pre_council_trades'
  ) then
    alter table public.backtests add column pre_council_trades integer;
  end if;
  
  -- Add pre_council_win_rate if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'pre_council_win_rate'
  ) then
    alter table public.backtests add column pre_council_win_rate double precision;
  end if;
  
  -- Add pre_council_profit_pct if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'pre_council_profit_pct'
  ) then
    alter table public.backtests add column pre_council_profit_pct double precision;
  end if;
  
  -- Add post_council_trades if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'post_council_trades'
  ) then
    alter table public.backtests add column post_council_trades integer;
  end if;
  
  -- Add post_council_win_rate if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'post_council_win_rate'
  ) then
    alter table public.backtests add column post_council_win_rate double precision;
  end if;
  
  -- Add post_council_profit_pct if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'post_council_profit_pct'
  ) then
    alter table public.backtests add column post_council_profit_pct double precision;
  end if;
  
  -- Add profit_pct if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'profit_pct'
  ) then
    alter table public.backtests add column profit_pct double precision;
  end if;
  
  -- Add rejected_profitable_trades if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'rejected_profitable_trades'
  ) then
    alter table public.backtests add column rejected_profitable_trades integer default 0;
  end if;
  
  -- Add total_trades if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'total_trades'
  ) then
    alter table public.backtests add column total_trades integer;
  end if;
  
  -- Add win_rate if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'win_rate'
  ) then
    alter table public.backtests add column win_rate double precision;
  end if;
  
  -- Add net_profit if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'net_profit'
  ) then
    alter table public.backtests add column net_profit double precision;
  end if;
  
  -- Add avg_return_per_trade if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'avg_return_per_trade'
  ) then
    alter table public.backtests add column avg_return_per_trade double precision;
  end if;
  
  -- Add model_name if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'model_name'
  ) then
    alter table public.backtests add column model_name text;
  end if;
  
  -- Add start_date if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'start_date'
  ) then
    alter table public.backtests add column start_date date;
  end if;
  
  -- Add end_date if missing
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'backtests' 
    and column_name = 'end_date'
  ) then
    alter table public.backtests add column end_date date;
  end if;
end $$;

-- 6. Create market_indices table if not exists
-- Used for market overview (EGX30, USD rate, etc.)
create table if not exists public.market_indices (
  id bigserial primary key,
  symbol text not null,
  close double precision,
  date timestamptz default now(),
  created_at timestamptz default now(),
  unique(symbol, date)
);
create index if not exists market_indices_symbol_date_idx on public.market_indices(symbol, date desc);

-- 7. Create currency_rates table if not exists
-- Used for USD/EGP rate tracking
create table if not exists public.currency_rates (
  id bigserial primary key,
  currency text not null,
  rate double precision,
  date timestamptz default now(),
  created_at timestamptz default now(),
  unique(currency, date)
);
create index if not exists currency_rates_currency_date_idx on public.currency_rates(currency, date desc);

-- 8. Create market_cache table if not exists
-- Used for market status caching
create table if not exists public.market_cache (
  id bigserial primary key,
  cache_key text not null,
  country text not null,
  payload jsonb not null,
  computed_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(cache_key, country)
);
create index if not exists market_cache_key_country_idx on public.market_cache(cache_key, country);

-- Grant necessary permissions
grant select on public.stock_bars_intraday to anon;
grant select on public.stock_bars_intraday to authenticated;
grant select on public.bot_states to anon;
grant select on public.bot_states to authenticated;
grant select on public.backtests to anon;
grant select on public.backtests to authenticated;
grant select on public.market_indices to anon;
grant select on public.market_indices to authenticated;
grant select on public.currency_rates to anon;
grant select on public.currency_rates to authenticated;
grant select on public.market_cache to anon;
grant select on public.market_cache to authenticated;
