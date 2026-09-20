alter table public.local_payment_orders
  add column if not exists telegram_invite_link text,
  add column if not exists telegram_invite_expires_at timestamptz;
