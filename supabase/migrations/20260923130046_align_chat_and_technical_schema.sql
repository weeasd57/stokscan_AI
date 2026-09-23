-- Keep application queries and the published-chat sitemap aligned with the
-- production schema. These timestamps are server-managed by the application.
alter table public.shared_chat_posts
  add column if not exists updated_at timestamptz;

update public.shared_chat_posts
set updated_at = created_at
where updated_at is null;

alter table public.shared_chat_posts
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists shared_chat_posts_published_updated_idx
  on public.shared_chat_posts (is_published, updated_at desc);

alter table public.ai_chat_facts
  add column if not exists updated_at timestamptz;

update public.ai_chat_facts
set updated_at = created_at
where updated_at is null;

alter table public.ai_chat_facts
  alter column updated_at set default now(),
  alter column updated_at set not null;
