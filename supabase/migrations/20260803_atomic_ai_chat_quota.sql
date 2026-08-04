create table if not exists public.ai_chatbot_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  chat_count integer not null default 0,
  primary key (user_id, date)
);

create or replace function public.consume_ai_chat_quota(p_user_id uuid, p_date date, p_limit integer)
returns table(allowed boolean, chat_count integer)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_chatbot_limits(user_id, date, chat_count)
  values (p_user_id, p_date, 1)
  on conflict (user_id, date) do update
    set chat_count = public.ai_chatbot_limits.chat_count + 1
    where public.ai_chatbot_limits.chat_count < p_limit
  returning true, public.ai_chatbot_limits.chat_count into allowed, chat_count;
  if not found then
    select false, l.chat_count into allowed, chat_count
    from public.ai_chatbot_limits l where l.user_id = p_user_id and l.date = p_date;
  end if;
  return next;
end; $$;

revoke all on function public.consume_ai_chat_quota(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_chat_quota(uuid, date, integer) to service_role;
