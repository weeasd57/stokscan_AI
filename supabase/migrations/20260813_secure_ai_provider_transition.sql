update public.ai_chatbot_settings
set api_url = 'https://api.deepseek.com',
    model = 'deepseek-chat',
    updated_at = now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_chatbot_settings' and column_name = 'api_key'
  ) then
    execute 'update public.ai_chatbot_settings set api_key = null where api_key is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'openrouter_api_key'
  ) then
    execute 'update public.profiles set openrouter_api_key = null where openrouter_api_key is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'gemini_api_key'
  ) then
    execute 'update public.profiles set gemini_api_key = null where gemini_api_key is not null';
  end if;
end $$;
