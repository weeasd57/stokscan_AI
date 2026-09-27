-- Allow authenticated users to read their own chatbot limits for quota tracking
alter table if exists public.ai_chatbot_limits enable row level security;

drop policy if exists "Users can read own limits" on public.ai_chatbot_limits;
create policy "Users can read own limits"
  on public.ai_chatbot_limits
  for select
  to authenticated
  using (user_id = auth.uid());
