-- Kashier payment integration: payment/order ledger + provider tracking.

-- 1. Add a `provider` column to the existing payment-shaped `subscriptions`
--    table so we can distinguish activated via Kashier (kashier) vs Paymob
--    (paymob) vs legacy (default null). The column already exists on some
--    deployments; use IF NOT EXISTS to stay idempotent.
alter table public.subscriptions
  add column if not exists provider text;

drop index if exists subscriptions_user_plan_idx;
create index if not exists subscriptions_user_plan_idx
  on public.subscriptions (user_id, plan_id, status);

-- 2. Payment ledger: one row per Kashier payment attempt. This is the source
--    of truth for the checkout<->webhook lifecycle so duplicate webhooks can
--    never activate a subscription twice (idempotency via unique order_ref).
create table if not exists public.kashier_payments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  plan_id text not null default 'pro',
  amount_paid numeric(12,2) not null default 0,
  currency text not null default 'EGP',
  status text not null default 'initiated',  -- initiated | success | failed | refunded | cancelled
  provider text not null default 'kashier',
  order_ref text not null unique,            -- our merchant order id (sub_<user>_<ts>)
  kashier_order_id text,                     -- Kashier session/order reference
  transaction_id text,                       -- Kashier transaction id
  transaction_response_code text,
  payment_status_detail text,                -- Kashier transaction status (SUCCESS/FAILURE/PENDING)
  method text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  expires_at timestamptz
);

create index if not exists kashier_payments_user_idx
  on public.kashier_payments (user_id);
create index if not exists kashier_payments_status_idx
  on public.kashier_payments (status);
create index if not exists kashier_payments_txn_idx
  on public.kashier_payments (transaction_id);

create index if not exists kashier_payments_order_ref_idx
  on public.kashier_payments (order_ref);
