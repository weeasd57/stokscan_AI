import type { IntentPlan, ToolResult } from '@/lib/ai/types';
import { executeStructuredTools } from '@/lib/ai/tools-v2';
import { generateV2Response, type ResponderMeta } from '@/lib/ai/final-v2';
import { getDeepSeekApiKey, getNvidiaApiKeys } from '@/lib/ai/server-secrets';
import { runAnswerGate } from '@/lib/ai/answer-gate';
import { buildFactRecords } from '@/lib/ai/facts';

export const REPORT_KINDS = ['stock', 'accumulation', 'market', 'follow_up'] as const;
export type ReportKind = typeof REPORT_KINDS[number];
export type PreviousReport = { session_date: string; symbol: string; content: string; evidence: ToolResult[] };

export function reportQuestion(kind: ReportKind, date: string, symbol: string, previous?: PreviousReport | null): string {
  const questions = {
    stock: `حلل سهم ${symbol} فنياً لجلسة ${date}: الإغلاق والتغير وحجم التداول مقارنة بمتوسطه، الاتجاه والزخم والدعم والمقاومة والسيناريو الإيجابي والسلبي والمخاطر.`,
    accumulation: `ما الأسهم عالية السيولة التي ظهرت عليها إشارات تجميع في جلسة ${date}؟ اشرح درجة التجميع والحجم النسبي والأدلة والمخاطر، وميز الإشارة الضعيفة عن المؤكدة. إذا لم توجد نتائج صالحة اذكر ذلك دون اختراع أسهم.`,
    market: `حلل وضع السوق المصري لجلسة ${date}: المؤشرات واتجاه السوق والسيولة واتساع الصعود والهبوط والقطاعات الأبرز، فقط فيما تتوفر له بيانات موثقة. وضح المقاييس غير المتاحة.`,
    follow_up: `تابع تحليل سهم ${symbol} بين جلسة ${previous?.session_date} وجلسة ${date}: ما الذي تغير في الإغلاق والزخم والحجم والمستويات؟ هل تحقق السيناريو السابق؟ لا تفترض تحقق اختراق من الإغلاق الحالي وحده.`,
  };
  return questions[kind];
}

export function chooseLiquidStock(rows: any[], date: string, excluded?: string): string {
  const ranked = rows.filter(row => row.date === date && Number(row.volume) > 0 && Number(row.last_close) > 0)
    .sort((a, b) => Number(b.last_close) * Number(b.volume) - Number(a.last_close) * Number(a.volume));
  const selected = ranked.slice(0, 10).find(row => row.symbol !== excluded) || ranked[0];
  if (!selected || !/^[A-Z0-9]{2,12}$/.test(selected.symbol)) throw new Error('No fresh liquid stock');
  return selected.symbol;
}

export function compactEvidence(results: ToolResult[]): ToolResult[] {
  return results.map(result => ({ ...result, data: { ...result.data,
    ...(Array.isArray(result.data?.corporate_actions) ? { corporate_actions: result.data.corporate_actions.slice(0, 3) } : {}),
    ...(Array.isArray(result.data?.stocks) ? { stocks: result.data.stocks.slice(0, 10) } : {}),
  } }));
}

export async function generateDailyReport(client: any, kind: ReportKind, date: string, symbol: string,
  liquidSymbols: string[], previous?: PreviousReport | null) {
  if (kind === 'follow_up' && (!previous || previous.session_date >= date)) throw new Error('Previous report required');
  const question = reportQuestion(kind, date, symbol, previous);
  const plan: IntentPlan = {
    intent: kind === 'market' ? 'market_summary' : kind === 'accumulation' ? 'accumulation_distribution' : 'stock_analysis',
    confidence: 1, entities: { symbols: ['stock', 'follow_up'].includes(kind) ? [symbol] : [], sector: null,
      timeframe: 'current', reference: null, ...(kind === 'market' ? {} : { requested_date: date }),
      ...(kind === 'accumulation' ? { scan_direction: 'accumulation' as const, min_acc_score: 60 } : {}) },
    needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
    tools: kind === 'market' ? ['get_market'] : kind === 'accumulation' ? ['get_accumulation_stocks'] : ['get_stock', 'get_stock_levels'],
    clarification_needed: false, resolved_from: { symbol: symbol || null, message_id: null },
  };
  const deepSeek = getDeepSeekApiKey();
  const keys = deepSeek ? [deepSeek, ...getNvidiaApiKeys()] : getNvidiaApiKeys();
  if (!keys.length) throw new Error('LLM provider not configured');
  const tools = await executeStructuredTools(client, plan, keys, '', '', question, []);
  let evidence = compactEvidence(tools.results);
  const essential = evidence.find(r => r.tool === (kind === 'market' ? 'get_market' : kind === 'accumulation' ? 'get_accumulation_stocks' : 'get_stock'));
  if (!essential || essential.error || essential.availability === 'failed' || essential.data_time?.slice(0, 10) !== date) {
    throw new Error('Report evidence does not match the session');
  }
  if (kind === 'market') {
    const dates = essential.data?.component_dates;
    if (dates && (dates.egx30 !== date || dates.egx100 !== date)) throw new Error('Market indices are stale');
  }
  if (kind === 'accumulation') {
    evidence = evidence.map(r => {
      if (r.tool !== 'get_accumulation_stocks') return r;
      const stocks = (r.data?.stocks || []).filter((s: any) => liquidSymbols.includes(s.symbol));
      return { ...r, symbols: stocks.map((s: any) => s.symbol), data: { ...r.data,
        stocks, matches: stocks, scan_rows: stocks, matched_count: stocks.length,
        coverage: 'high_liquidity_subset', description_ar: 'عينة الأسهم مرتفعة السيولة فقط؛ لا تمثل السوق كله' } };
    });
  }
  const history = previous ? [{ role: 'assistant', content: `تقرير جلسة ${previous.session_date}:\n${previous.content}` }] : [];
  const previousFacts = previous ? [{ context_id: `previous-${previous.session_date}`, source: 'daily_social_reports',
    symbols: [previous.symbol], as_of: previous.session_date, facts: { previous_report_evidence: previous.evidence }, data_type: 'historical' as const }] : [];
  const meta: ResponderMeta = {};
  const instruction = `اكتب منشور فيسبوك عربي منظم من 150 إلى 230 كلمة، عنوانه تاريخ جلسة ${date}. الأرقام من الأدلة فقط. لا تصفها بأنها أسعار لحظية. لا تعرض neutral كتجميع ولا درجات النماذج كاحتمالات ربح. التحليل تعليمي. لا تختلق مستويات أو قطاعات أو سيولة كلية أو نسب صعود وهبوط. لا تضف روابط دعائية أخرى. يجب أن تجيب عن السؤال الحالي تحديداً. العينة المحدودة لا تمثل السوق كله.`;
  const content = await generateV2Response(question, plan, null, evidence, previousFacts, history,
    { symbol: symbol || null, message_id: null, confidence: 1 }, keys, undefined,
    { current_symbol: symbol || null, last_symbols: symbol ? [symbol] : [], summary: null }, instruction, meta, 1700);
  const gate = runAnswerGate({ reply: content, plan, toolResults: evidence, userMessage: question, history, facts: buildFactRecords(evidence) });
  if (meta.source !== 'llm' || meta.degraded || !gate.ok) throw new Error('LLM report failed verification');
  return { question, content, evidence, source: 'llm', validation: gate };
}
