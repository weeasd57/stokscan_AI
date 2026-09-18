-- Retire Supabase intraday storage. Daily OHLCV remains in stock_prices and
-- crypto intraday bars remain in the application's local crypto storage.
-- Deliberately avoid CASCADE: the migration must fail rather than silently
-- remove an unexpected view, function, or policy dependency.
drop table if exists public.stock_bars_intraday;
