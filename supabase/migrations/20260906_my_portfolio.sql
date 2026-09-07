-- Migration: "My Portfolio" (محفظتى) — user-managed stock holdings + cash,
-- editable from the profile page and managed conversationally through the AI
-- chatbot (add/remove/sell stocks, update quantities, query cash balance).
--
-- Reuses the existing `positions` table (already has user_id, symbol,
-- entry_price, status) and adds a quantity column plus a per-user cash
-- balance on profiles. The chat pipeline reads/writes these rows so the
-- chatbot always knows the user's holdings, quantities, and cash.
--
-- App code is tolerant: profile page and chat tools check for the new
-- columns and degrade gracefully if this migration has not been applied yet.

-- 1. Quantity of shares held in each position (NULL = quantity unknown/NA)
alter table if exists public.positions
  add column if not exists quantity double precision default null;

-- 1b. Extend the positions.source enum with chatbot origins.
-- (ALTER TYPE ... ADD VALUE cannot run inside a transaction with other
-- statements on old Postgres versions — Supabase SQL Editor handles it.)
alter type public.symbol_source add value if not exists 'chatbot';
alter type public.symbol_source add value if not exists 'chatbot_image';

-- 2. Free cash available in the user's portfolio (EGP)
alter table if exists public.profiles
  add column if not exists cash_balance double precision default 0;

-- 3. Portfolio-confirmed flag on chat facts so the bot can ask the user
--    whether an uploaded portfolio screenshot belongs to them before saving.
alter table if exists public.ai_chat_facts
  add column if not exists confirmed boolean default null;

-- Index for fast portfolio lookups
create index if not exists positions_user_status_idx
  on public.positions(user_id, status);
