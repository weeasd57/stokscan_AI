import { STRATEGIES, analyzeStrategy, compareStrategies, aggregateCandles, normalizeCandles, type Candle, type StrategyId, type StrategyParams } from "../strategy-lab";

export type ChartContext = { active_chart_id: string; charts: Array<{ id: string; symbol: string; timeframe: "1d"; period?: number; strategy_ids?: StrategyId[] }> };
export type ChartAction = { type: "apply_strategy" | "compare_strategies"; chart_id: string | null; symbol: string; result: any };
export function sanitizeChartContext(value: unknown): ChartContext | undefined {
    if (!value || typeof value !== "object") return;
    const raw = value as any;
    if (!Array.isArray(raw.charts)) return;
    const charts: ChartContext["charts"] = raw.charts.slice(0, 8).filter((c: any) => c && typeof c.id === "string" && /^[\w-]{1,64}$/.test(c.id)
        && typeof c.symbol === "string" && /^[A-Za-z0-9.]{2,12}$/.test(c.symbol) && (!c.timeframe || String(c.timeframe).toLowerCase() === "1d"))
        .map((c: any) => ({ id: c.id, symbol: c.symbol.toUpperCase().replace(/\.CA$/, ""), timeframe: "1d" as const,
            ...(Number.isInteger(c.period) && c.period >= 30 && c.period <= 1000 ? { period: c.period } : {}),
            ...(Array.isArray(c.strategy_ids) && c.strategy_ids.length <= 10 && c.strategy_ids.every((id: unknown) => STRATEGIES.some(s => s.id === id)) ? { strategy_ids: [...new Set<StrategyId>(c.strategy_ids)] } : {}) }));
    if (!charts.length || new Set(charts.map(c => c.id)).size !== charts.length) return;
    return { active_chart_id: charts.some(c => c.id === raw.active_chart_id) ? raw.active_chart_id : charts[0].id, charts };
}

function validDate(value: unknown): string | undefined {
    if (value == null) return;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new Error("التاريخ يجب أن يكون يوماً صالحاً بصيغة YYYY-MM-DD");
    return value;
}
function strategy(value: unknown): StrategyId {
    if (!STRATEGIES.some(s => s.id === value)) throw new Error("استراتيجية غير مدعومة؛ استخدم قائمة الاستراتيجيات");
    return value as StrategyId;
}
function params(value: unknown): StrategyParams {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("إعدادات الاستراتيجية غير صالحة");
    const result: StrategyParams = {};
    for (const key of ["lookback", "fastPeriod", "slowPeriod"] as const) {
        const n = (value as any)[key];
        if (n != null) { if (typeof n !== "number" || !Number.isInteger(n) || n < 2 || n > 200) throw new Error("فترات المؤشرات بين 2 و200 شمعة"); result[key] = n; }
    }
    if (result.fastPeriod != null && result.slowPeriod != null && result.fastPeriod >= result.slowPeriod) throw new Error("الفترة السريعة يجب أن تكون أقصر من البطيئة");
    return result;
}

/** Request-local in-flight cache: no private data and no global mutable cache. */
export type ChartHistoryCache = Map<string, Promise<Candle[]>>;
export async function executeChartStrategyTool(name: string, args: Record<string, any>, client: any, cache?: ChartHistoryCache) {
    if (name === "list_chart_strategies") return { status: "success", availability: "available", strategies: STRATEGIES, source: "deterministic:strategy-catalog" };
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase().replace(/\.CA$/, "") : "";
    if (!/^[A-Z0-9.]{2,12}$/.test(symbol)) throw new Error("رمز سهم موثق مطلوب");
    if (args.chart_id != null && (typeof args.chart_id !== "string" || !/^[\w-]{1,64}$/.test(args.chart_id))) throw new Error("معرف الشارت غير صالح");
    const timeframe = "1d";
    if (args.timeframe != null && String(args.timeframe).toLowerCase() !== "1d") {
        throw new Error("الفريم المدعوم في المنصة هو الفريم اليومي فقط (1D)");
    }
    const start = validDate(args.start_date), end = validDate(args.end_date);
    const barLimit = args.bar_limit ?? 1000;
    if (!Number.isInteger(barLimit) || barLimit < 30 || barLimit > 1000) throw new Error("عدد الشموع يجب أن يكون عدداً صحيحاً بين 30 و1000");
    if (start && end && start > end) throw new Error("بداية الفترة بعد نهايتها");
    const settings = params(args.params);
    const ids = name === "apply_chart_strategy" ? [strategy(args.strategy_id)] : (() => {
        if (!Array.isArray(args.strategy_ids) || args.strategy_ids.length < 1 || args.strategy_ids.length > 10) throw new Error("اختر من استراتيجية إلى عشر استراتيجيات");
        const unique = [...new Set(args.strategy_ids.map(strategy))];
        if (!unique.length) throw new Error("الاختبار يحتاج استراتيجية واحدة على الأقل");
        return unique;
    })();
    if (name === "compare_strategies_history") {
        for (const key of ["initialCapital", "commissionBps", "slippageBps"]) {
            const n = args[key];
            if (n == null) continue;
            if (typeof n !== "number" || !Number.isFinite(n) || (key === "initialCapital" ? n <= 0 : n < 0 || n > 1000)) throw new Error("رأس المال أو تكاليف التداول خارج الحدود المدعومة");
        }
    }
    const fingerprint = JSON.stringify([symbol, start, end, barLimit]);
    const read = async () => {
        let query = client.from("stock_prices").select("date,open,high,low,close,volume").eq("exchange", "EGX").eq("symbol", symbol);
        if (start) query = query.gte("date", start);
        if (end) query = query.lte("date", end);
        const { data, error } = await query.order("date", { ascending: false }).limit(barLimit);
        if (error) throw new Error("تعذر قراءة تاريخ السهم");
        return (data || []).map((c: any) => ({ time: Date.parse(c.date) / 1000, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) }));
    };
    let pending = cache?.get(fingerprint);
    if (!pending) { pending = read(); cache?.set(fingerprint, pending); }
    const raw = await pending;
    const candles = normalizeCandles(raw);
    const date = candles.length ? new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10) : null;
    const meta = { symbol, chart_id: args.chart_id ?? null, timeframe, date, start_date: candles.length ? new Date(candles[0].time * 1000).toISOString().slice(0, 10) : null,
        candle_count: candles.length, bounded_rows: barLimit, truncated: raw.length === barLimit, adjusted_data_verified: false,
        data_note: "تاريخ Supabase المحدود؛ تعديل الأسعار للأحداث الرأسمالية غير متحقق منه. لا تعادل النتائج تاريخ HF الكامل." };
    if (!candles.length) return { status: "success", availability: "missing", ...meta, message: "لا تتوفر شموع صالحة للفترة المطلوبة" };
    if (name === "apply_chart_strategy") {
        const analysis = analyzeStrategy(candles, ids[0], settings);
        return { status: "success", ...meta, analysis, signal_summary: { total: analysis.signals.length, buy_count: analysis.signals.filter(s => s.side === "buy").length, sell_count: analysis.signals.filter(s => s.side === "sell").length },
            signal_note: "الإشارات ليست صفقات منفذة؛ تكرار إشارة شراء لا يعني فتح مراكز متعددة. نسبة الفوز تُحسب من الصفقات المغلقة فقط." };
    }
    const comparison = compareStrategies(candles, ids, { initialCapital: args.initialCapital, commissionBps: args.commissionBps, slippageBps: args.slippageBps, params: settings });
    return { status: "success", ...meta, comparison, assumptions: { initialCapital: args.initialCapital ?? 100000, commissionBps: args.commissionBps ?? 10, slippageBps: args.slippageBps ?? 10, params: settings },
        strategy_metrics: comparison.results.filter(r => STRATEGIES.find(s => s.id === r.strategyId)?.backtestable).map(r => ({ strategy_id: r.strategyId, strategy_name: STRATEGIES.find(s => s.id === r.strategyId)!.name, ...r.metrics })) };
}

const common = { symbol: { type: "string" }, chart_id: { type: "string", description: "معرف الشارت كما ورد في سياق مساحة العمل" }, timeframe: { type: "string", enum: ["1d"], description: "الفريم اليومي فقط (1D)؛ المنصة لا تدعم سوى الفريم اليومي" }, bar_limit: {type:"integer",minimum:30,maximum:1000,description:"آخر عدد محدد من الشموع اليومية؛ افتراضياً فترة الشارت الحالي عند غياب تاريخ صريح"}, start_date: { type: "string", description: "YYYY-MM-DD" }, end_date: { type: "string", description: "YYYY-MM-DD" }, params: { type: "object", properties: { lookback: { type: "integer", minimum: 2, maximum: 200 }, fastPeriod: { type: "integer", minimum: 2, maximum: 200 }, slowPeriod: { type: "integer", minimum: 2, maximum: 200 } }, additionalProperties: false } };
export const CHART_STRATEGY_TOOL_SCHEMA = [
    { type: "function", function: { name: "list_chart_strategies", description: "قائمة استراتيجيات الشارت وحدودها وما يمكن اختباره؛ لا نسب نجاح ثابتة.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
    { type: "function", function: { name: "apply_chart_strategy", description: "احسب رسومات وإشارات استراتيجية على شارت مستهدف. استخدم الرمز والفريم ومعرف الشارت من السياق؛ لا تختلق إحداثيات.", parameters: { type: "object", properties: { ...common, strategy_id: { type: "string", enum: STRATEGIES.map(s => s.id) } }, required: ["symbol", "strategy_id"], additionalProperties: false } } },
    { type: "function", function: { name: "compare_strategies_history", description: "اختبر استراتيجية واحدة أو قارن عدة استراتيجيات بنفس تاريخ السهم والتكاليف. اختر الاستراتيجيات المطلوبة فقط. للفترة الحديثة حدد start_date/end_date أو bar_limit صراحة. الرسومات فقط لا تُرتب كاستراتيجيات تداول؛ العينة الصغيرة والتعديلات غير المتحققة معلنة.", parameters: { type: "object", properties: { ...common, strategy_ids: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string", enum: STRATEGIES.map(s => s.id) } }, initialCapital: { type: "number", exclusiveMinimum: 0 }, commissionBps: { type: "number", minimum: 0, maximum: 1000 }, slippageBps: { type: "number", minimum: 0, maximum: 1000 } }, required: ["symbol", "strategy_ids"], additionalProperties: false } } },
];
