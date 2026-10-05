-- Transactional smoke test. Run only on an unreserved Mon/Wed session.
-- No provider calls; every fixture and quota mutation is rolled back.
begin;
do $$
declare d date := (now() at time zone 'Africa/Cairo')::date;
  m date := date_trunc('month', d)::date;
  tt timestamptz := (d + interval '23 hours 59 minutes') at time zone 'Africa/Cairo';
  baseline integer;
begin
  if extract(isodow from d) not in (1,3)
     or date_trunc('month', d + interval '1 day')::date <> m or exists
     (select 1 from public.daily_social_publications where session_date=d) then
    raise exception 'Test requires an unreserved Mon/Wed session within one month';
  end if;
  -- A fixture copied from an existing report, not a regenerated analysis.
  insert into public.daily_social_reports
  select (jsonb_populate_record(null::public.daily_social_reports,
            to_jsonb(r) || jsonb_build_object('session_date', d))).*
  from public.daily_social_reports r where r.kind='stock' and r.session_date < d
  order by r.session_date desc limit 1 on conflict(session_date,kind) do nothing;

  -- Wrong/missing planned time cannot acquire a claim (old heartbeat protocol).
  begin
    insert into public.daily_social_publications(session_date,platform,kind,state)
    values(d,'tiktok','stock','claimed');
    raise exception 'Old claim protocol unexpectedly accepted';
  exception when raise_exception then
    if SQLERRM not like 'Use current Mon/Wed%' then raise; end if;
  end;

  insert into public.social_publication_monthly_quota(month,used) values(m,19)
    on conflict(month) do update set used=19;
  begin
    insert into public.daily_social_publications(session_date,platform,kind,state,publication_at)
    values(d,'tiktok','stock','claimed',tt),
          (d,'facebook','stock','claimed',(d+interval '1 day 10 hours') at time zone 'Africa/Cairo');
    raise exception 'Pair unexpectedly accepted with only one free slot';
  exception when raise_exception then
    if SQLERRM <> 'Monthly publication limit (20) reached' then raise; end if;
  end;
  select used into baseline from public.social_publication_monthly_quota where month=m;
  if baseline <> 19 or exists(select 1 from public.daily_social_publications where session_date=d) then
    raise exception 'Rejected pair leaked a claim or consumed a quota slot';
  end if;
  update public.social_publication_monthly_quota set used=18 where month=m;
  insert into public.daily_social_publications(session_date,platform,kind,state,publication_at)
  values(d,'tiktok','stock','claimed',tt),
        (d,'facebook','stock','claimed',(d+interval '1 day 10 hours') at time zone 'Africa/Cairo');
  select used into baseline from public.social_publication_monthly_quota where month=m;
  if baseline <> 20 then raise exception 'Pair did not consume two slots'; end if;
  begin
    update public.daily_social_publications set publication_at=publication_at+interval '1 minute'
    where session_date=d and platform='tiktok';
    raise exception 'Reservation time was mutable';
  exception when raise_exception then
    if SQLERRM not like 'Publication identity/time is immutable%' then raise; end if;
  end;
end $$;
rollback;
