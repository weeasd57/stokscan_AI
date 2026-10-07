-- Internal recovery/outbox data includes unmasked PRO signals and Telegram text.
-- HF uses service_role; no public/client access is permitted.
create table public.short_swing_checkpoints (
    checkpoint_key text primary key,
    payload jsonb not null,
    computed_at timestamptz not null default now()
);
alter table public.short_swing_checkpoints enable row level security;
revoke all on public.short_swing_checkpoints from public, anon, authenticated;
grant select, insert, update on public.short_swing_checkpoints to service_role;
comment on table public.short_swing_checkpoints is
    'Internal short-swing phase completion and per-signal/channel delivery claims. Ambiguous sends require reconciliation.';
