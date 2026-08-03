-- Retire direct BINANCE, FOREX, and LSE market data.
-- CRYPTO is intentionally excluded because it can contain non-Binance sources.
do $$
declare
  target_exchanges text[] := array['BINANCE', 'FOREX', 'LSE'];
begin
  if to_regclass('public.market_heatmap') is not null then
    delete from public.market_heatmap where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.stock_news_sentiment') is not null then
    delete from public.stock_news_sentiment where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.stock_bars_intraday') is not null then
    delete from public.stock_bars_intraday where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.scan_results') is not null then
    delete from public.scan_results where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.stock_technical_indicators') is not null then
    delete from public.stock_technical_indicators where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.stock_prices') is not null then
    delete from public.stock_prices where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.stock_fundamentals') is not null then
    delete from public.stock_fundamentals where upper(exchange) = any(target_exchanges);
  end if;
  if to_regclass('public.stocks') is not null then
    delete from public.stocks where upper(exchange) = any(target_exchanges);
  end if;
end $$;
