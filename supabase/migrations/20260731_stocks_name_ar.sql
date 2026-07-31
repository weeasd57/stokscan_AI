-- Migration: add Arabic display names to stocks and populate where available
-- Safe to run multiple times; populates from the existing `name` column when it
-- contains Arabic characters and `name_ar` is still empty.

alter table if exists public.stocks add column if not exists name_ar text;
create index if not exists stocks_name_ar_idx on public.stocks (name_ar);

-- Populate name_ar from name when name already contains Arabic characters.
update public.stocks
   set name_ar = name
 where (name is not null and name ~ '[\u0600-\u06FF]')
   and (name_ar is null or name_ar = '');
