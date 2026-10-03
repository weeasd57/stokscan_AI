import fs from 'node:fs';
import path from 'node:path';

// Local preview only: reuse the site's analysis tools and LLM responder.
// Never publishes or schedules a Facebook post.
async function main() {
  for (const file of ['.env.local', '../.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([^#=\s]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const { getSupabaseClient } = await import('../src/lib/supabase/route-data');
  const { runPipelineStream } = await import('../src/lib/ai/pipeline');
  const { generateV2Response } = await import('../src/lib/ai/final-v2');
  const { getNvidiaApiKeys, getDeepSeekApiKey } = await import('../src/lib/ai/server-secrets');
  const { runAnswerGate } = await import('../src/lib/ai/answer-gate');
  const { buildFactRecords } = await import('../src/lib/ai/facts');
  const symbol = (process.argv[2] || 'CCAP').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new Error('Invalid symbol');
  const state = { current_symbol: null, last_symbols: [], summary: null };
  const dk = getDeepSeekApiKey();
  const keys = dk ? [dk, ...getNvidiaApiKeys()] : getNvidiaApiKeys();
  const question = `حلل سهم ${symbol} تحليلا فنيا بناء على آخر جلسة متاحة`;
  let plan: any;
  let results: any[] = [];
  for await (const event of runPipelineStream(question, [], state, null, [], getSupabaseClient(), keys, '', '', `facebook-preview-${Date.now()}`)) {
    if (event.type === 'plan') plan = event.data;
    if (event.type === 'tools_data') results = event.data.results;
  }
  if (!plan || !results.length) throw new Error('Missing analysis evidence');
  // Corporate-action histories are repeated by two tools. Limit the preview
  // to the latest three complete records, preserving dates, sources and URLs.
  results = results.map(result => ({ ...result, data: { ...result.data,
    ...(Array.isArray(result.data?.corporate_actions) ? { corporate_actions: result.data.corporate_actions.slice(0, 3) } : {})
  } }));
  const meta: any = {};
  let reply = '';
  const instruction = 'أعد صياغة التحليل كمنشور فيسبوك عربي منظم في حدود 220 كلمة. ابدأ باسم السهم وتاريخ الجلسة الفعلي. اعرض الإغلاق والتغير وحجم التداول ونسبته للمتوسط، الاتجاه والزخم، الدعم والمقاومة ثم السيناريو الإيجابي والسلبي. لا تضف أرقاما خارج الأدلة. لا تصف neutral كتجميع ولا تعتبر درجة تجميع ضعيفة تأكيدا. لا تعرض تقييمات النماذج كنسب نجاح. إذا البيانات قديمة سمها قراءة للجلسة المؤرخة ولا تقل اليوم. اختم بأن التحليل تعليمي وليس توصية شخصية.';
  reply = await generateV2Response(question, plan, null, results, [], [], { symbol, message_id: null, confidence: 1 }, keys, undefined, state, instruction, meta, 1400);
  const gate = runAnswerGate({ reply, plan, toolResults: results, userMessage: question, history: [], facts: buildFactRecords(results) });
  const output = { generated_at: new Date().toISOString(), symbol, source: meta.source, degraded: meta.degraded || false, gate, evidence: results, reply, preview_only: true };
  const outputPath = path.resolve('../docs/facebook-llm-preview.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ source: meta.source, gate, reply, outputPath }));
  if (meta.source !== 'llm' || meta.degraded || !gate.ok) process.exitCode = 2;
}
main().catch(() => { console.error('Facebook preview failed; no post was published.'); process.exitCode = 1; });
