-- Migration: RLS policies for ai_chat_sessions, ai_chat_messages
-- + idempotency table + analytics column
-- NOTE: user_id is uuid type in all tables — auth.uid() returns uuid directly.

alter table if exists public.ai_chat_sessions enable row level security;
alter table if exists public.ai_chat_messages enable row level security;

drop policy if exists "chat sessions owner read" on public.ai_chat_sessions;
create policy "chat sessions owner read" on public.ai_chat_sessions for select using (user_id = auth.uid());
drop policy if exists "chat sessions owner write" on public.ai_chat_sessions;
create policy "chat sessions owner write" on public.ai_chat_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "chat messages owner read" on public.ai_chat_messages;
create policy "chat messages owner read" on public.ai_chat_messages for select using (user_id = auth.uid());
drop policy if exists "chat messages owner write" on public.ai_chat_messages;
create policy "chat messages owner write" on public.ai_chat_messages for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.ai_chat_sessions s where s.id = session_id and s.user_id = auth.uid()
  ));

alter table if exists public.ai_chat_messages add column if not exists client_message_id text;
create unique index if not exists ai_chat_messages_client_message_uidx
  on public.ai_chat_messages(user_id, client_message_id) where client_message_id is not null;

create table if not exists public.ai_chat_idempotency (
  user_id uuid not null,
  client_message_id text not null,
  status text not null default 'processing',
  response text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, client_message_id)
);

alter table public.ai_chat_idempotency enable row level security;
drop policy if exists "idempotency owner" on public.ai_chat_idempotency;
create policy "idempotency owner" on public.ai_chat_idempotency for select using (user_id = auth.uid());

alter table if exists public.ai_analytics add column if not exists correlation_id text;
