alter table public.daily_social_reports
  add column if not exists image_url text,
  add column if not exists image_status text not null default 'pending'
    check (image_status in ('pending','ready','failed')),
  add column if not exists image_error text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-reports', 'social-reports', true, 5242880, array['image/png'])
on conflict (id) do nothing;
-- Public delivery only. No anon/authenticated write policies are added.
