-- Migration: persist end-to-end reply latency on assistant chat messages so the
-- deployed chat history and the admin SUPPORT & AI tab can show per-reply time.
-- The app code is tolerant: until this migration is applied, inserts/selects
-- automatically retry without the column.

alter table if exists public.ai_chat_messages add column if not exists latency_ms integer;
