create table if not exists public.shared_chat_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  question text not null,
  answer text not null,
  title text not null default 'تحليل من EGX Bots',
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists shared_chat_posts_published_idx
  on public.shared_chat_posts(is_published, created_at desc);

alter table public.shared_chat_posts enable row level security;

drop policy if exists "Public can read published shared chats" on public.shared_chat_posts;
create policy "Public can read published shared chats"
  on public.shared_chat_posts for select
  using (is_published = true);

drop policy if exists "Admins can insert shared chats" on public.shared_chat_posts;
create policy "Admins can insert shared chats"
  on public.shared_chat_posts for insert
  with check (
    auth.uid() = created_by
    and lower(coalesce(auth.jwt()->>'email', '')) in (
      'user@gmail.com',
      'weeessd57@gmail.com'
    )
  );
