-- Migration: persist data provenance (data source + data date) on assistant
-- chat messages so the admin AI Chatbot tab can show whether each LLM reply was
-- built from real-time market data or from the Supabase database, and which
-- data date the model based its decision on.
-- The app code is tolerant: until this migration is applied, inserts/selects
-- automatically retry without the column.

alter table if exists public.ai_chat_messages add column if not exists metadata jsonb default null;

create index if not exists ai_chat_messages_metadata_idx on public.ai_chat_messages using gin (metadata);
