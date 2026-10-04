import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSupabaseServiceClient } from '@/lib/supabase/route-data';

export const REPORT_CACHE_TAG = 'daily-public-reports';
export const reportNames: Record<string, string> = { market: 'تقرير وضع السوق', accumulation: 'تقرير إشارات التجميع' };
export type PublicReport = {
  session_date: string; kind: string; content: string; created_at: string;
  updated_at: string; evidence: any[];
};

// A single shared daily cache, not one private-table query per visitor or URL.
export const getPublicReports = unstable_cache(async (): Promise<PublicReport[]> => {
  const client = getSupabaseServiceClient();
  const { data, error } = await client.from('daily_social_reports')
    .select('session_date,kind,content,created_at,updated_at,evidence,job_run_id')
    .in('kind', ['market', 'accumulation']).eq('status', 'ready')
    .eq('validation->>ok', 'true').gte('session_date', '2026-10-04')
    .order('session_date', { ascending: false });
  if (error) throw new Error('Unable to load public reports');
  if (!data?.length) return [];
  const { data: jobs, error: jobError } = await client.from('daily_job_runs')
    .select('id,status,job_type,started_at,steps').in('id', [...new Set(data.map((r: any) => r.job_run_id))]);
  if (jobError) throw new Error('Unable to validate report jobs');
  return data.filter((r: any) => {
    const job = jobs?.find((j: any) => j.id === r.job_run_id);
    if (!job || job.status !== 'completed' || job.job_type !== 'daily_bot' || !r.content?.trim()) return false;
    try {
      const steps = typeof job.steps === 'string' ? JSON.parse(job.steps) : job.steps;
      const statuses = Object.fromEntries(steps.map((s: any) => [s.step, s.status]));
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(job.started_at));
      return date === r.session_date && statuses.sync_prices === 'success' && statuses.calculate_indicators === 'success'
        && statuses[r.kind === 'market' ? 'refresh_market_status' : 'accumulation_scan'] === 'success';
    } catch { return false; }
  }).map((r: any) => ({ session_date: r.session_date, kind: r.kind, content: r.content,
    created_at: r.created_at, updated_at: r.updated_at, evidence: Array.isArray(r.evidence) ? r.evidence : [] }));
}, ['public-reports-v1'], { revalidate: 86400, tags: [REPORT_CACHE_TAG] });

export function reportUrl(r: Pick<PublicReport, 'session_date' | 'kind'>) {
  return `/reports/${r.session_date}/${r.kind}`;
}
