import fs from 'node:fs';

async function main() {
  for (const file of ['.env.local', '../.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([^#=\s]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const { getSupabaseServiceClient } = await import('../src/lib/supabase/route-data');
  const { data: jobs, error } = await getSupabaseServiceClient().from('daily_job_runs')
    .select('id,started_at').eq('job_type', 'daily_bot').eq('status', 'completed').order('started_at', { ascending: false }).limit(1);
  if (error || !jobs?.length) throw new Error('Completed job unavailable');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(jobs[0].started_at));
  const secret = process.env.REVALIDATE_SECRET || process.env.ADMIN_SECRET_KEY || process.env.CRON_SECRET;
  if (!secret) throw new Error('Deployment verification credentials unavailable');
  const endpoint = 'https://egxbots.com/api/social/daily-reports';
  for (const kind of ['stock', 'accumulation', 'market', 'follow_up']) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ date, kind, job_run_id: jobs[0].id }), signal: AbortSignal.timeout(135000) });
    const result = await response.json();
    console.log(JSON.stringify({ date, kind, http_status: response.status, ...result }));
    if (!response.ok) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Deployment verification failed; no Facebook post was published.'); process.exitCode = 1; });
