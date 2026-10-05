-- Every reservation consumes a publication slot, including ambiguous/failed sends.
-- Slots are never released automatically: retry the same reservation after reconciliation.
alter table public.daily_social_publications add column publication_at timestamptz;
update public.daily_social_publications set publication_at = created_at;
alter table public.daily_social_publications alter column publication_at set not null;

create table public.social_publication_monthly_quota (
  month date primary key check (extract(day from month) = 1),
  used integer not null check (used between 0 and 20)
);
alter table public.social_publication_monthly_quota enable row level security;
revoke all on public.social_publication_monthly_quota from public, anon, authenticated;
grant select, insert, update on public.social_publication_monthly_quota to service_role;
insert into public.social_publication_monthly_quota(month, used)
select date_trunc('month', publication_at at time zone 'Africa/Cairo')::date, count(*)
from public.daily_social_publications group by 1;

create function public.guard_social_publication_slot() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare local_at timestamp; month_start date; claimed integer;
begin
  if TG_OP = 'UPDATE' then
    if (new.session_date, new.platform, new.kind, new.publication_at)
       is distinct from (old.session_date, old.platform, old.kind, old.publication_at) then
      raise exception 'Publication identity/time is immutable; reconcile the original reservation';
    end if;
    return new;
  end if;
  local_at := new.publication_at at time zone 'Africa/Cairo';
  if new.publication_at is null or new.publication_at <= now()
     or new.session_date <> (now() at time zone 'Africa/Cairo')::date
     or extract(isodow from new.session_date) not in (1,3)
     or (new.platform = 'tiktok' and (local_at::date <> new.session_date or local_at::time < time '18:45'))
     or (new.platform = 'facebook' and local_at <> new.session_date + interval '1 day 10 hours') then
    raise exception 'Use current Mon/Wed session: TikTok >=18:45, Facebook next day 10:00 Cairo';
  end if;
  month_start := date_trunc('month', local_at)::date;
  insert into public.social_publication_monthly_quota(month, used)
    values(month_start, 0) on conflict(month) do nothing;
  -- Row update serializes concurrent claims and enforces the cap without count races.
  update public.social_publication_monthly_quota set used = used + 1
    where month = month_start and used < 20 returning used into claimed;
  if claimed is null then raise exception 'Monthly publication limit (20) reached'; end if;
  return new;
end $$;
revoke all on function public.guard_social_publication_slot() from public, anon, authenticated;
grant execute on function public.guard_social_publication_slot() to service_role;
create trigger guard_social_publication_slot before insert or update
on public.daily_social_publications for each row execute function public.guard_social_publication_slot();

create function public.reserve_daily_social_publications(
  p_session_date date, p_kind text, p_tiktok_at timestamptz
) returns setof public.daily_social_publications
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.daily_social_publications where session_date = p_session_date) then
    raise exception 'Session already reserved; reconcile existing records, never resend';
  end if;
  if not exists (
    select 1 from public.daily_social_reports r join public.daily_job_runs j on j.id = r.job_run_id
    where r.session_date = p_session_date and r.kind = p_kind and r.status = 'ready'
      and r.image_status = 'ready' and r.image_url like '%-v4-%'
      and (r.validation->>'ok')::boolean is true
      and coalesce(r.social_caption,'') <> '' and coalesce(r.social_title,'') <> ''
      and j.job_type = 'daily_bot' and j.status = 'completed'
      and (j.completed_at at time zone 'Africa/Cairo')::date = p_session_date
  ) then raise exception 'No verified report from completed current-session job'; end if;
  -- Both rows and quota increments commit together, including across month boundaries.
  return query insert into public.daily_social_publications
    (session_date, platform, kind, state, publication_at)
  values (p_session_date, 'tiktok', p_kind, 'claimed', p_tiktok_at),
         (p_session_date, 'facebook', p_kind, 'claimed',
          (p_session_date + interval '1 day 10 hours') at time zone 'Africa/Cairo')
  returning *;
end $$;
revoke all on function public.reserve_daily_social_publications(date,text,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_daily_social_publications(date,text,timestamptz) to service_role;
comment on table public.social_publication_monthly_quota is 'Conservative Metricool free-plan cap: reservations count per Cairo publication month; do not auto-release uncertain sends.';
