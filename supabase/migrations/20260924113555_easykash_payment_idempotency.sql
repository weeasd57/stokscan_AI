alter table public.subscriptions
  add column if not exists last_payment_order_id uuid;

create table if not exists public.payment_entitlement_events (
  payment_order_id uuid primary key references public.local_payment_orders(id) on delete cascade,
  user_id uuid not null,
  activated_at timestamptz not null default now()
);

alter table public.payment_entitlement_events enable row level security;

create index if not exists subscriptions_last_payment_order_id_idx
  on public.subscriptions (last_payment_order_id)
  where last_payment_order_id is not null;

create or replace function public.activate_easykash_subscription(
  p_user_id uuid,
  p_plan_id text,
  p_duration_days integer,
  p_provider text,
  p_payment_order_id uuid,
  p_price_monthly_cents integer
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_subscription public.subscriptions%rowtype;
  v_claimed_order_id uuid;
begin
  if p_plan_id <> 'pro' or p_duration_days not in (30, 180, 365) then
    raise exception 'Unsupported Pro plan';
  end if;

  -- Serialize separate successful checkouts for the same account.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Durable per-order ledger: protects retries even after later orders replace
  -- the subscription's last_payment_order_id marker.
  insert into public.payment_entitlement_events (payment_order_id, user_id)
  values (p_payment_order_id, p_user_id)
  on conflict (payment_order_id) do nothing
  returning payment_order_id into v_claimed_order_id;

  if not found then
    select current_period_end into v_end
    from public.subscriptions
    where user_id = p_user_id and plan_id = p_plan_id
    order by current_period_end desc nulls last
    limit 1;
    return v_end;
  end if;

  insert into public.pricing_plans (id, name, price_monthly_cents, is_active)
  values (p_plan_id, 'Pro', p_price_monthly_cents, true)
  on conflict (id) do update set
    name = excluded.name,
    price_monthly_cents = excluded.price_monthly_cents,
    is_active = true;

  select * into v_subscription
  from public.subscriptions
  where user_id = p_user_id and plan_id = p_plan_id
  order by current_period_end desc nulls last
  limit 1
  for update;

  if found and v_subscription.last_payment_order_id = p_payment_order_id then
    return v_subscription.current_period_end;
  end if;

  v_start := case
    when found and v_subscription.status = 'active' and v_subscription.current_period_end > v_now
      then v_subscription.current_period_end
    else v_now
  end;
  v_end := v_start + make_interval(days => p_duration_days);

  if v_subscription.id is not null then
    update public.subscriptions
    set status = 'active',
        provider = p_provider,
        current_period_start = v_start,
        current_period_end = v_end,
        last_payment_order_id = p_payment_order_id,
        updated_at = v_now
    where id = v_subscription.id;
  else
    insert into public.subscriptions (
      user_id, plan_id, status, provider, current_period_start,
      current_period_end, last_payment_order_id, created_at, updated_at
    ) values (
      p_user_id, p_plan_id, 'active', p_provider, v_start,
      v_end, p_payment_order_id, v_now, v_now
    );
  end if;

  update public.subscriptions
  set status = 'cancelled', updated_at = v_now
  where user_id = p_user_id and status = 'active' and plan_id <> p_plan_id;

  return v_end;
end;
$$;

revoke all on function public.activate_easykash_subscription(uuid, text, integer, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.activate_easykash_subscription(uuid, text, integer, text, uuid, integer) to service_role;

revoke all on table public.payment_entitlement_events from public, anon, authenticated;
grant select, insert on table public.payment_entitlement_events to service_role;
