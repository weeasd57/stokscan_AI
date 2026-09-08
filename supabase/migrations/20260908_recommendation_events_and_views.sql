-- Single source of truth for recommendation lifecycle events and public views.
create table if not exists public.recommendation_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id bigint not null references public.scan_results(id) on delete cascade,
  event_type text not null,
  idempotency_key text not null unique,
  old_values jsonb,
  new_values jsonb,
  price_at_event numeric,
  source text not null default 'daily_bot',
  telegram_status text not null default 'pending',
  telegram_message_id text,
  telegram_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing deployments may have applied an earlier draft with UUID IDs while
-- scan_results.id is bigint. Preserve any legacy data, then expose the typed
-- bigint column used by the application.
do $$
declare
  col_type text;
  row_count bigint;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'recommendation_events'
  and column_name = 'recommendation_id';
  if col_type = 'uuid' then
    alter table public.recommendation_events
      drop constraint if exists recommendation_events_recommendation_id_fkey;
    execute 'select count(*) from public.recommendation_events' into row_count;
    if row_count > 0 then
      alter table public.recommendation_events rename column recommendation_id to recommendation_id_legacy_uuid;
    else
      alter table public.recommendation_events drop column recommendation_id;
    end if;
    alter table public.recommendation_events add column recommendation_id bigint;
  end if;
end $$;

drop index if exists public.recommendation_events_rec_idx;
create index if not exists recommendation_events_recommendation_created_idx
  on public.recommendation_events(recommendation_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recommendation_events_recommendation_id_bigint_fkey'
  ) then
    alter table public.recommendation_events
      add constraint recommendation_events_recommendation_id_bigint_fkey
      foreign key (recommendation_id) references public.scan_results(id) on delete cascade;
  end if;
end $$;

update public.recommendation_events
set telegram_status = 'cancelled',
    last_error = coalesce(last_error, 'Legacy event could not be mapped to scan_results bigint id')
where recommendation_id is null;

create index if not exists recommendation_events_retry_idx
  on public.recommendation_events(telegram_status, created_at);

create or replace view public.current_public_recommendations as
select distinct on (upper(symbol), upper(exchange))
  id, batch_id, symbol, exchange, name, model_name, country, last_close,
  precision, signal, is_public, status, entry_price, target_price, stop_loss,
  exit_price, profit_loss_pct, created_at, updated_at, adjustments, rich_details
from public.scan_results
where is_public = true
order by upper(symbol), upper(exchange),
  case when status = 'open' then 0 else 1 end,
  updated_at desc nulls last,
  created_at desc;

create or replace view public.reconciliation_conflicts as
select upper(symbol) as symbol, upper(exchange) as exchange,
  count(*) as record_count,
  count(*) filter (where status = 'open') as open_count,
  count(*) filter (where status in ('win','loss','stale','closed_manual')) as closed_count,
  min(created_at) as first_created_at,
  max(updated_at) as last_updated_at,
  array_agg(distinct status) as statuses,
  array_agg(distinct entry_price) as entry_prices,
  array_agg(distinct target_price) as target_prices,
  array_agg(distinct exit_price) filter (where exit_price is not null) as exit_prices
from public.scan_results
where is_public = true
group by upper(symbol), upper(exchange)
having count(*) > 1
    or (count(*) filter (where status = 'open') > 0
        and count(*) filter (where status <> 'open') > 0);

alter table public.recommendation_events enable row level security;
create policy recommendation_events_admin_read on public.recommendation_events
  for select using (auth.role() = 'service_role');
create policy recommendation_events_service_write on public.recommendation_events
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
