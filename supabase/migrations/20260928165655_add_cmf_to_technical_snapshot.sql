alter table public.stock_technical_indicators
  add column if not exists cmf_20 double precision;

alter table public.market_heatmap
  add column if not exists cmf_20 double precision;
