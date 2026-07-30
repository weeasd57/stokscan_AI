-- Add state and summary_state columns to ai_chat_sessions
alter table if exists public.ai_chat_sessions
  add column if not exists state jsonb default '{}'::jsonb,
  add column if not exists summary_state jsonb default '{}'::jsonb;

-- Create ai_chat_facts table for storing session-specific fact snapshots
create table if not exists public.ai_chat_facts (
  id bigserial primary key,
  user_id text not null,
  session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  context_id text not null default '',
  source text not null default '',
  symbols text[] not null default '{}',
  as_of text not null default '',
  facts jsonb not null default '{}'::jsonb,
  data_type text not null default 'live',
  created_at timestamptz default now()
);

create index if not exists ai_chat_facts_user_session_symbols_idx
  on public.ai_chat_facts(user_id, session_id)
  where symbols is not null;

create index if not exists ai_chat_facts_context_id_idx
  on public.ai_chat_facts(context_id);

-- Enable Row Level Security on ai_chat_facts
alter table public.ai_chat_facts enable row level security;

-- Allow users to read only their own facts
create policy "Users can read own facts"
  on public.ai_chat_facts
  for select
  using (auth.uid()::text = user_id);

-- Allow service role to insert (app calls are service role)
create policy "Service role can insert facts"
  on public.ai_chat_facts
  for insert
  with check (true);

-- Allow service role to read all (for memory retrieval)
create policy "Service role can read all facts"
  on public.ai_chat_facts
  for select
  using (true);