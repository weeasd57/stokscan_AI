-- Manual Vodafone Cash payment orders reviewed through the support Telegram bot.
create table if not exists public.local_payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  plan_id text not null default 'pro',
  amount_egp numeric(12,2) not null default 300,
  provider text not null default 'vodafone_cash',
  status text not null default 'pending', -- pending | submitted | approved | rejected | expired
  customer_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists local_payment_orders_user_idx
  on public.local_payment_orders (user_id, created_at desc);
create index if not exists local_payment_orders_status_idx
  on public.local_payment_orders (status, created_at desc);
