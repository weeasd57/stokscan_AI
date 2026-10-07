import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getSupabaseServiceClient } from '@/lib/supabase/route-data';
import { chooseLiquidStock, generateDailyReport, REPORT_KINDS, DailyReportVerificationError, type ReportKind } from '@/lib/social/daily-reports';

export const runtime = 'nodejs';
export const maxDuration = 120;

function authorized(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET || process.env.ADMIN_SECRET_KEY || process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  const { data, error } = await getSupabaseServiceClient().from('daily_social_reports')
    .select('session_date,kind,symbol,status,question,content,validation,created_at,image_url,image_status,image_error,social_title,social_hashtags,social_caption').eq('session_date', date);
  if (error) return NextResponse.json({ error: 'Unable to read reports' }, { status: 500 });
  return NextResponse.json({ reports: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { date, kind, job_run_id: jobId } = body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !REPORT_KINDS.includes(kind) || !/^[a-f0-9-]{36}$/i.test(jobId || '')) {
    return NextResponse.json({ error: 'Invalid report request' }, { status: 400 });
  }
  const service = getSupabaseServiceClient();
  const { data: job, error: jobError } = await service.from('daily_job_runs').select('status,started_at,steps,job_type').eq('id', jobId).maybeSingle();
  const steps = typeof job?.steps === 'string' ? JSON.parse(job.steps) : job?.steps || [];
  const statuses = Object.fromEntries(steps.map((s: any) => [s.step, s.status]));
  const jobDate = job ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(job.started_at)) : '';
  if (jobError || job?.job_type !== 'daily_bot' || job.status !== 'completed' || jobDate !== date
    || statuses.sync_prices !== 'success' || statuses.calculate_indicators !== 'success'
    || (kind === 'accumulation' && statuses.accumulation_scan !== 'success')
    || (kind === 'market' && statuses.refresh_market_status !== 'success')) {
    return NextResponse.json({ error: 'Daily data job is not ready' }, { status: 409 });
  }
  const { data: existing } = await service.from('daily_social_reports').select('status').eq('session_date', date).eq('kind', kind).maybeSingle();
  if (existing) return NextResponse.json({ status: existing.status, duplicate: true });
  const { error: claimError } = await service.from('daily_social_reports').insert({ session_date: date, kind, job_run_id: jobId, status: 'generating' });
  if (claimError) return NextResponse.json({ error: 'Report already claimed or storage unavailable' }, { status: 409 });
  try {
    const { data: previous, error: previousError } = await service.from('daily_social_reports')
      .select('session_date,symbol,content,evidence').eq('kind', 'stock').eq('status', 'ready').lt('session_date', date)
      .order('session_date', { ascending: false }).limit(1).maybeSingle();
    if (previousError) throw new Error('Previous reports unavailable');
    if (kind === 'follow_up' && !previous) {
      await service.from('daily_social_reports').update({ status: 'skipped', error: 'No previous report to compare' }).eq('session_date', date).eq('kind', kind);
      return NextResponse.json({ status: 'skipped', reason: 'No previous report to compare' });
    }
    const scan = await fetch(`${req.nextUrl.origin}/api/scan/technical`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 300 }) });
    if (!scan.ok) throw new Error('Cached technical scanner unavailable');
    const rows = (await scan.json()).results || [];
    const symbol = kind === 'follow_up' ? previous.symbol : chooseLiquidStock(rows, date, previous?.symbol);
    const liquidSymbols = rows.filter((r: any) => r.date === date).sort((a: any, b: any) => b.last_close * b.volume - a.last_close * a.volume).slice(0, 20).map((r: any) => r.symbol);
    const report = await generateDailyReport(getSupabaseClient(), kind as ReportKind, date, symbol, liquidSymbols, kind === 'follow_up' ? previous : null);
    const { error } = await service.from('daily_social_reports').update({ ...report, source: undefined, symbol: ['stock','follow_up'].includes(kind) ? symbol : null,
      status: 'ready', updated_at: new Date().toISOString() }).eq('session_date', date).eq('kind', kind);
    if (error) throw new Error('Report storage failed');
    return NextResponse.json({ status: 'ready', kind, symbol, date });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report failed';
    await service.from('daily_social_reports').update({ status: 'failed', error: message,
      ...(error instanceof DailyReportVerificationError ? { validation: error.validation } : {}),
      updated_at: new Date().toISOString() }).eq('session_date', date).eq('kind', kind);
    return NextResponse.json({ status: 'failed', error: message }, { status: 503 });
  }
}
