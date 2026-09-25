-- Keep successful VIP removals durable across HF restarts. A later renewal
-- extends subscription_end, making the member eligible for a new check.
create table if not exists public.pro_telegram_revocations (
  user_id uuid not null references auth.users (id) on delete cascade,
  telegram_user_id bigint not null,
  subscription_end timestamptz not null,
  revoked_at timestamptz not null default now(),
  primary key (user_id, telegram_user_id)
);

alter table public.pro_telegram_revocations enable row level security;
revoke all on public.pro_telegram_revocations from anon, authenticated;
grant select, insert, update, delete on public.pro_telegram_revocations to service_role;
