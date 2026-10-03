import fs from 'node:fs';

async function main() {
  for (const file of ['.env.local', '../.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([^#=\s]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const { getSupabaseClient } = await import('../src/lib/supabase/route-data');
  const { chooseLiquidStock, generateDailyReport, REPORT_KINDS } = await import('../src/lib/social/daily-reports');
  const client = getSupabaseClient();
  const scanResponse = await fetch('https://egxbots.com/api/scan/technical', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"limit":300}' });
  if (!scanResponse.ok) throw new Error('Scanner unavailable');
  const rows = (await scanResponse.json()).results;
  const date = rows.map((r: any) => r.date).sort().at(-1);
  const symbol = chooseLiquidStock(rows, date);
  const liquid = rows.filter((r: any) => r.date === date).sort((a: any, b: any) => b.last_close * b.volume - a.last_close * a.volume).slice(0, 20).map((r: any) => r.symbol);
  const { data: priorDates, error } = await client.from('stock_prices').select('date').eq('symbol', symbol).lt('date', date).order('date', { ascending: false }).limit(1);
  if (error || !priorDates?.length) throw new Error('No real previous session for follow-up test');
  const previousDate = priorDates[0].date;
  const prior = await generateDailyReport(client, 'stock', previousDate, symbol, [symbol]);
  const previous = { session_date: previousDate, symbol, content: prior.content, evidence: prior.evidence };
  const output: any[] = [];
  for (const kind of REPORT_KINDS) {
    const start = Date.now();
    try {
      const report = await generateDailyReport(client, kind, date, symbol, liquid, kind === 'follow_up' ? previous : null);
      output.push({ kind, date, symbol, ms: Date.now() - start, ...report, passed: true });
      console.log(JSON.stringify({ kind, date, ms: Date.now() - start, passed: true, content: report.content }));
    } catch (error) {
      output.push({ kind, date, ms: Date.now() - start, passed: false, error: error instanceof Error ? error.message : 'Failed' });
      console.log(JSON.stringify(output.at(-1)));
    }
  }
  fs.writeFileSync('../docs/daily-social-reports-live.json', JSON.stringify({ preview_only: true, generated_at: new Date().toISOString(), reports: output }, null, 2));
  if (output.some(r => !r.passed)) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Report tests failed'); process.exitCode = 1; });
