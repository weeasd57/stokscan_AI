-- Preserve the global one-per-day guard and symbol cooldown. Historical
-- recommendations created before the versioned policy must not permanently
-- consume the new policy's rolling and open publication capacity.
create or replace function public.publish_public_recommendation(
  p_row jsonb, p_daily_limit integer default 1,
  p_rolling_limit integer default 20, p_open_limit integer default 10,
  p_cooldown_days integer default 7
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_row public.scan_results%rowtype;
  v_now timestamptz := now();
  v_day timestamptz := date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
  v_entry numeric := (p_row->>'entry_price')::numeric;
  v_target numeric := (p_row->>'target_price')::numeric;
  v_stop numeric := (p_row->>'stop_loss')::numeric;
begin
  if p_daily_limit is null or p_rolling_limit is null or p_open_limit is null
     or p_cooldown_days is null or p_daily_limit < 1 or p_daily_limit > 5
     or p_rolling_limit < 1 or p_rolling_limit > 30
     or p_open_limit < 1 or p_open_limit > 20 or p_cooldown_days < 1 then
    raise exception 'Invalid recommendation capacity';
  end if;
  if nullif(trim(p_row->>'symbol'), '') is null or p_row->>'exchange' is distinct from 'EGX'
     or nullif(trim(p_row #>> '{rich_details,recommendation_policy,version}'), '') is null
     or v_entry is null or v_stop is null or v_target is null
     or v_entry::text in ('NaN','Infinity','-Infinity')
     or v_target::text in ('NaN','Infinity','-Infinity')
     or v_stop::text in ('NaN','Infinity','-Infinity')
     or not (0 < v_stop and v_stop < v_entry and v_entry < v_target) then
    return jsonb_build_object('status','rejected','reason','invalid_setup');
  end if;
  if (v_target-v_entry)/(v_entry-v_stop) < 1.5 then
    return jsonb_build_object('status','rejected','reason','invalid_setup');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public_egx_recommendation_capacity', 0));
  if exists (select 1 from public.scan_results where is_public and exchange='EGX'
       and upper(symbol)=upper(p_row->>'symbol') and
       (status='open' or updated_at >= v_now - make_interval(days=>p_cooldown_days))) then
    return jsonb_build_object('status','rejected','reason','duplicate_or_cooldown');
  end if;
  if (select count(*) from public.scan_results where is_public and exchange='EGX'
      and created_at >= v_day) >= p_daily_limit then
    return jsonb_build_object('status','rejected','reason','daily_capacity');
  end if;
  if (select count(*) from public.scan_results where is_public and exchange='EGX'
      and created_at >= v_now - interval '30 days'
      and rich_details #>> '{recommendation_policy,version}' is not null) >= p_rolling_limit then
    return jsonb_build_object('status','rejected','reason','rolling_capacity');
  end if;
  if (select count(*) from public.scan_results where is_public and exchange='EGX'
      and status='open'
      and rich_details #>> '{recommendation_policy,version}' is not null) >= p_open_limit then
    return jsonb_build_object('status','rejected','reason','open_capacity');
  end if;
  insert into public.scan_results
    (batch_id,symbol,exchange,name,model_name,country,last_close,precision,signal,
     status,entry_price,target_price,stop_loss,risk_adjusted_return,is_public,
     top_reasons,features,rich_details,created_at,updated_at)
  values ((p_row->>'batch_id')::uuid,upper(p_row->>'symbol'),'EGX',p_row->>'name',
    p_row->>'model_name','Egypt',v_entry,(p_row->>'precision')::numeric,'BUY',
    'open',v_entry,v_target,v_stop,(p_row->>'risk_adjusted_return')::numeric,true,
    p_row->'top_reasons',p_row->'features',p_row->'rich_details',v_now,v_now)
  returning * into v_row;
  return jsonb_build_object('status','inserted','row',to_jsonb(v_row));
end;
$$;

revoke all on function public.publish_public_recommendation(jsonb,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.publish_public_recommendation(jsonb,integer,integer,integer,integer) to service_role;
