create table if not exists public.pro_telegram_invites (
  user_id uuid primary key references auth.users (id) on delete cascade,
  invite_link text not null,
  invite_expires_at timestamptz not null,
  vip_telegram_user_id bigint,
  updated_at timestamptz not null default now()
);

create index if not exists pro_telegram_invites_link_idx
  on public.pro_telegram_invites (invite_link);

create index if not exists pro_telegram_invites_vip_tg_idx
  on public.pro_telegram_invites (vip_telegram_user_id)
  where vip_telegram_user_id is not null;

alter table public.pro_telegram_invites enable row level security;
