alter table public.daily_social_reports
  add column if not exists social_title text,
  add column if not exists social_hashtags jsonb not null default '[]'::jsonb,
  add column if not exists social_caption text;
