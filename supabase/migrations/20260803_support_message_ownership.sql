alter table public.support_messages add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists support_messages_user_session_idx on public.support_messages(user_id, session_id, created_at);
