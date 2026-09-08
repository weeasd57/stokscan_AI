-- Recommendation reconciliation and safe retry hardening.
-- Apply after 20260908_recommendation_events_and_views.sql.

do $$
begin
  if to_regclass('public.bot_states') is not null then
    alter table public.bot_states
      add column if not exists recommendation_id bigint references public.scan_results(id) on delete set null;
    create index if not exists bot_states_recommendation_idx
      on public.bot_states(recommendation_id);
  end if;
end $$;

-- Add a manual close status only when the enum exists and the value is absent.
-- Status values are deployment-specific and are intentionally not altered here.
-- The evaluator writes only values already used by scan_results.

-- The event table already has retry metadata; keep its timestamp fresh whenever
-- a delivery attempt changes state.
do $$
begin
  if to_regclass('public.recommendation_events') is not null then
    alter table public.recommendation_events
            add column if not exists retry_claimed_at timestamptz,
            add column if not exists retry_claim_token uuid,
      add column if not exists next_retry_at timestamptz;
    create index if not exists recommendation_events_failed_idx
      on public.recommendation_events(telegram_status, telegram_attempts, created_at)
      where telegram_status in ('pending', 'failed');
  end if;
end $$;

-- Best-effort backfill for bot state rows whose symbol/date identify one open
-- scan result. Ambiguous rows remain NULL and are reported by reconciliation.
do $$
begin
  if to_regclass('public.bot_states') is not null and to_regclass('public.scan_results') is not null then
    update public.bot_states b
    set recommendation_id = matches.id
    from lateral (
      select min(s.id) as id
      from public.scan_results s
      where upper(s.symbol) = upper(coalesce(
        b.state->>'symbol',
        case when jsonb_object_length(coalesce(b.state->'pos_state', '{}'::jsonb)) = 1
          then (select key from jsonb_object_keys(b.state->'pos_state') as keys(key) limit 1)
          else null end,
        ''
      ))
        and upper(coalesce(s.exchange, 'EGX')) = upper(coalesce(b.state->>'exchange', 'EGX'))
        and s.status = 'open'
        and s.created_at <= coalesce(b.saved_at, b.created_at, now())
        and not exists (
          select 1
          from public.scan_results s2
          where upper(s2.symbol) = upper(coalesce(
            b.state->>'symbol',
            case when jsonb_object_length(coalesce(b.state->'pos_state', '{}'::jsonb)) = 1
              then (select key from jsonb_object_keys(b.state->'pos_state') as keys(key) limit 1)
              else null end,
            ''
          ))
            and upper(coalesce(s2.exchange, 'EGX')) = upper(coalesce(b.state->>'exchange', 'EGX'))
            and s2.status = 'open'
            and s2.created_at <= coalesce(b.saved_at, b.created_at, now())
            and s2.id <> s.id
        )
    ) matches
    where b.recommendation_id is null
      and matches.id is not null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.bot_states') is not null then
    execute 'create or replace view public.reconciliation_orphans as
      select b.id, b.bot_id, b.recommendation_id, b.state, b.saved_at, b.created_at
      from public.bot_states b
      where b.recommendation_id is null';
  end if;
end $$;

create or replace function public.claim_recommendation_telegram_events(p_limit integer default 10, p_token uuid default gen_random_uuid())
returns setof public.recommendation_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  if p_token is null then
    raise exception 'p_token is required';
  end if;
  return query
  update public.recommendation_events
  set retry_claimed_at = now(),
      retry_claim_token = p_token,
      telegram_attempts = telegram_attempts + 1,
      updated_at = now()
  where id in (
    select id from public.recommendation_events
    where telegram_status in ('pending', 'failed')
      and telegram_attempts < 3
      and (next_retry_at is null or next_retry_at <= now())
      and (retry_claimed_at is null or retry_claimed_at < now() - interval '5 minutes')
    order by created_at
    for update skip locked
    limit p_limit
  )
  returning *;
end;
$$;

revoke all on function public.claim_recommendation_telegram_events(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_recommendation_telegram_events(integer, uuid) to service_role;
