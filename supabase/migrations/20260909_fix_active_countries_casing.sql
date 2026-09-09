-- Fix get_active_countries to return canonical country casing.
--
-- The old implementation lowercased country names (`lower(data->>'country')`),
-- returning e.g. "egypt" instead of "Egypt". Every downstream lookup is
-- case-sensitive (stock_fundamentals JSONB filters, market_cache keys like
-- symbols_Egypt, get_active_symbols p_country), so the lowercase names
-- produced empty symbol lists in the admin Data Manager and public scanner.
--
-- Dedup remains case-insensitive, but the canonical stored casing is returned.

create or replace function public.get_active_countries()
returns table(country text)
language sql
security definer
as $$
  select min(raw_country) as country
  from (
    select trim(both ' ' from data->>'country') as raw_country
    from public.stock_fundamentals
    where data->>'country' is not null
      and trim(both ' ' from data->>'country') <> ''
  ) t
  group by lower(raw_country)
  order by country asc;
$$;
