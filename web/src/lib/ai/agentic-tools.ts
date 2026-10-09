import { executionSupabase } from "./execution";
import { executeChartStrategyTool, type ChartHistoryCache } from "./chart-strategy-tools";

const normalizeSymbol = (value: unknown) => String(value).trim().toUpperCase().replace(/\.CA$/i, "");
const finite = (value: unknown): number | null => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (value: number | null) => value == null ? null : Number(value.toFixed(2));
function positive(value: unknown): number { const n = finite(value); if (n == null || n <= 0) throw new Error("الكمية والسعر يجب أن يكونا أرقاماً محدودة أكبر من صفر"); return n; }

/** One query boundary: Supabase resolves read failures instead of throwing them. */
function checkedClient(client: any): any {
    const wrap = (target: any): any => new Proxy(target, { get(obj,key) {
        const value = obj[key];
        if (typeof value !== "function") return value;
        if (key === "then") return (yes:any,no:any) => Promise.resolve(obj).then((result:any) => {
            if (result?.error) throw new Error("تعذر إكمال عملية قاعدة البيانات؛ لا تعتبر النتيجة فارغة أو العملية ناجحة");
            return result;
        }).then(yes,no);
        return (...args:any[]) => { const next = value.apply(obj,args); return next && typeof next === "object" && typeof next.then === "function" ? wrap(next) : next; };
    }});
    return { from: (table:string) => wrap(client.from(table)) };
}

export function cairoWeekBounds(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
    const part = (kind:string) => Number(parts.find(p=>p.type === kind)?.value);
    const local = new Date(Date.UTC(part("year"),part("month")-1,part("day")));
    local.setUTCDate(local.getUTCDate()-local.getUTCDay());
    const utcMidnight = (day:Date) => {
        const tz = new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Cairo",timeZoneName:"longOffset"}).formatToParts(day).find(p=>p.type === "timeZoneName")?.value || "GMT+02:00";
        const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
        const minutes = offset ? (Number(offset[2])*60+Number(offset[3]))*(offset[1] === "+" ? 1 : -1) : 120;
        return new Date(day.getTime()-minutes*60000).toISOString();
    };
    const previous = new Date(local); previous.setUTCDate(previous.getUTCDate()-7);
    return { thisWeekStartIso:utcMidnight(local), lastWeekStartIso:utcMidnight(previous) };
}

export async function executeAgenticTool(toolName:string,args:Record<string,any>,supabase:any,userId:string,chartHistoryCache?:ChartHistoryCache):Promise<any> {
    try {
        const enums:Record<string,string[]> = { operation:["view","add","buy","purchase","update","remove","delete","sell"], preset:["momentum_and_volume","top_gainers","top_losers","rsi_oversold","macd_cross","smart_money_flow"], status:["open","closed","all"], timeframe:["this_week","last_week","all"] };
        if (args?.symbol != null && (typeof args.symbol !== "string" || !/^[A-Za-z0-9.]{2,12}$/.test(args.symbol.trim()))) throw new Error("رمز السهم غير صالح");
        if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("مدخلات الأداة يجب أن تكون كائناً");
        const chartTool = ["list_chart_strategies", "apply_chart_strategy", "compare_strategies_history"].includes(toolName);
        for (const [key,values] of Object.entries(enums)) if (!(chartTool && key === "timeframe") && args[key] != null && !values.includes(String(args[key]).toLowerCase())) throw new Error("قيمة مدخل الأداة غير مدعومة: "+key);
        if (args.symbols != null && (!Array.isArray(args.symbols) || args.symbols.length > 10 || args.symbols.some((s:any)=>typeof s !== "string" || !/^[A-Za-z0-9.]{2,12}$/.test(s.trim())))) throw new Error("الحد الأقصى 10 رموز موثقة لكل أداة");
        if (["get_stock","get_stock_levels","get_comparison"].includes(toolName) && !args.symbols?.length) throw new Error("رموز الأسهم مطلوبة");
        const normalized = {...args, ...(args.symbols ? {symbols:Array.from(new Set(args.symbols.map(normalizeSymbol)))} : {})};
        if (chartTool) return await executeChartStrategyTool(toolName, normalized, checkedClient(executionSupabase(supabase)), chartHistoryCache);
        return await executeRawTool(toolName,normalized,checkedClient(executionSupabase(supabase)),userId);
    } catch (error:any) { return {status:"error", availability:"error", persisted:false, message:error.message}; }
}

function lockPosition(query:any, existing:any) {
    return existing.updated_at == null ? query.is("updated_at",null) : query.eq("updated_at",existing.updated_at);
}

async function executeRawTool(
    toolName: string,
    args: Record<string, any>,
    supabase: any,
    userId: string
): Promise<any> {
    try {
        if (toolName === "get_stock") {
            const symbols: string[] = Array.isArray(args.symbols)
                ? args.symbols.map(normalizeSymbol)
                : [];
            const results = [];
            for (const sym of symbols) {
                const { data: stockRows } = await supabase
                    .from("stocks")
                    .select("symbol, name, name_ar")
                    .eq("symbol", sym)
                    .limit(1);
                const stockData = stockRows?.[0] || { symbol: sym, name: sym, name_ar: sym };

                const { data: indRows } = await supabase
                    .from("stock_technical_indicators")
                    .select("date, close, change_pct, volume, r_vol, rsi_14, macd, macd_signal, macd_histogram, bb_upper, bb_lower, ema_50, ema_200, king_ai_score, egx_ai_score")
                    .eq("exchange", "EGX").eq("symbol", sym)
                    .order("date", { ascending: false })
                    .limit(1);

                const { data: wyckoffRows } = await supabase
                    .from("stock_scans_summary")
                    .select("scan_date, acc_score, dist_score, wyckoff_phase, vol_ratio, signal")
                    .eq("symbol", sym)
                    .order("scan_date", { ascending: false })
                    .limit(1);

                if (!indRows || indRows.length === 0) {
                    results.push({
                        symbol: sym,
                        found_in_main_market: false,
                        availability: "missing",
                        market_type: null,
                        message: `السهم ${sym} لا تتوفر له مؤشرات في المصدر المطلوب؛ غياب البيانات لا يحدد سوق القيد.`
                    });
                } else {
                    const ind = indRows[0];
                    const wyckoff = wyckoffRows?.[0] || {};
                    results.push({
                        symbol: sym,
                        name: stockData.name_ar || stockData.name || sym,
                        found_in_main_market: true,
                        date: ind.date,
                        price_type: "daily_close",
                        wyckoff_date: wyckoff.scan_date ?? null,
                        close: ind.close,
                        change_pct: ind.change_pct != null ? Number(ind.change_pct.toFixed(2)) : null,
                        relative_volume: ind.r_vol,
                        rsi_14: ind.rsi_14,
                        macd: ind.macd,
                        macd_signal: ind.macd_signal,
                        macd_hist: ind.macd_histogram,
                        ema_50: ind.ema_50,
                        ema_200: ind.ema_200,
                        bollinger_upper: ind.bb_upper,
                        bollinger_lower: ind.bb_lower,
                        king_ai_score: ind.king_ai_score,
                        egx_ai_score: ind.egx_ai_score,
                        wyckoff_phase: wyckoff.wyckoff_phase,
                        accumulation_score: wyckoff.acc_score,
                        distribution_score: wyckoff.dist_score
                    });
                }
            }
            return { status: "success", stocks: results };
        }

        if (toolName === "get_stock_levels") {
            const symbols: string[] = Array.isArray(args.symbols)
                ? args.symbols.map(normalizeSymbol)
                : [];
            const levels = [];
            for (const sym of symbols) {
                const { data: pRows } = await supabase
                    .from("stock_prices")
                    .select("high, low, close, date")
                    .eq("exchange", "EGX").eq("symbol", sym)
                    .order("date", { ascending: false })
                    .limit(60);
                if (pRows && pRows.length > 0) {
                    const close = finite(pRows[0].close);
                    const recentRows = pRows.slice(0, 20);
                    const recentLows = recentRows.map((r: any) => Number(r.low ?? r.close)).filter((v: number) => Number.isFinite(v) && v > 0);
                    const recentHighs = recentRows.map((r: any) => Number(r.high ?? r.close)).filter((v: number) => Number.isFinite(v) && v > 0);
                    const allHighs = pRows.map((r: any) => Number(r.high ?? r.close)).filter((v: number) => Number.isFinite(v) && v > 0);

                    const support = recentLows.length > 0 ? Number(Math.min(...recentLows).toFixed(2)) : null;
                    const resistance = recentHighs.length > 0 ? Number(Math.max(...recentHighs).toFixed(2)) : null;
                    const longTermResistance = allHighs.length > 0 ? Number(Math.max(...allHighs).toFixed(2)) : resistance;
                    const stopLoss = support != null ? Number((support * 0.98).toFixed(2)) : null;
                    const target1 = resistance;
                    const target2 = (longTermResistance != null && resistance != null && longTermResistance > resistance)
                        ? longTermResistance
                        : (resistance != null ? Number((resistance * 1.05).toFixed(2)) : null);

                    const entryZone = support != null
                        ? `${support} – ${Number((support * 1.02).toFixed(2))}`
                        : "غير محدد";

                    let tradingZone = "منطقة حيادية للمراقبة (بين الدعم والمقاومة)";
                    if (support != null && close != null && close < support) {
                        tradingZone = "تحت مستوى الدعم (كسر دعم فني)";
                    } else if (resistance != null && close != null && close > resistance) {
                        tradingZone = "فوق مستوى المقاومة (اختراق فني)";
                    } else if (support != null && close != null && close <= support * 1.025) {
                        tradingZone = "عند منطقة الدعم تماماً (منطقة شراء وتجميع محتملة)";
                    } else if (resistance != null && close != null && close >= resistance * 0.975) {
                        tradingZone = "عند منطقة المقاومة تماماً (منطقة جني أرباح ومقاومة بيعية)";
                    }

                    levels.push({
                        symbol: sym,
                        close,
                        support,
                        resistance,
                        entry_zone: entryZone,
                        stop_loss: stopLoss,
                        take_profit_1: target1,
                        take_profit_2: target2,
                        trading_zone: tradingZone,
                        date: pRows[0].date,
                        methodology: "20-session range; stop=98% support; target2=60-session high or 105% resistance",
                        observations: pRows.length, price_type: "daily_close"
                    });
                } else {
                    levels.push({ symbol: sym, availability: "missing", error: "لا يوجد تاريخ أسعار متاح؛ سوق القيد غير محدد" });
                }
            }
            return { status: "success", levels };
        }

        if (toolName === "manage_portfolio") {
            if (!userId) throw new Error("يلزم مستخدم مصادق عليه لإدارة المحفظة");
            const rawOp = String(args.operation || "view").toLowerCase();
            const operation = ["buy", "purchase", "add"].includes(rawOp) ? "add" : rawOp;
            const symbol = args.symbol ? normalizeSymbol(args.symbol) : null;
            const { data: posRows } = await supabase.from("positions")
                .select("id,symbol,quantity,entry_price,status,added_at,updated_at")
                .eq("user_id", userId).eq("status", "open").limit(101);
            const positions = posRows || [];
            if (operation === "view") {
                const enriched = [];
                for (const p of positions.slice(0, 100)) {
                    const { data: indRows } = await supabase.from("stock_technical_indicators")
                        .select("close,change_pct,rsi_14,king_ai_score,egx_ai_score,date")
                        .eq("exchange", "EGX").eq("symbol", p.symbol).order("date", { ascending: false }).limit(1);
                    const qty = finite(p.quantity), entry = finite(p.entry_price), latest = finite(indRows?.[0]?.close);
                    const cost = qty != null && entry != null ? qty * entry : null;
                    const value = qty != null && latest != null ? qty * latest : null;
                    enriched.push({ symbol: p.symbol, quantity: qty, entry_price: entry,
                        current_price: latest, date: indRows?.[0]?.date ?? null, price_type: "daily_close",
                        availability: latest == null ? "missing" : "available", cost: round(cost), market_value: round(value),
                        profit_loss_val: cost != null && value != null ? round(value - cost) : null,
                        profit_loss_pct: entry != null && entry > 0 && latest != null ? round((latest-entry)/entry*100) : null,
                        rsi: indRows?.[0]?.rsi_14 ?? null, king_ai: indRows?.[0]?.king_ai_score ?? null, egx_ai: indRows?.[0]?.egx_ai_score ?? null });
                }
                const complete = positions.length <= 100 && enriched.every(p => p.cost != null && p.market_value != null);
                const invested = enriched.every(p => p.cost != null) ? enriched.reduce((n,p) => n + p.cost!, 0) : null;
                const market = complete ? enriched.reduce((n,p) => n + p.market_value!, 0) : null;
                return { status: "success", operation, persisted: false, valuation_complete: complete,
                    truncated: positions.length > 100, positions: enriched,
                    summary: { positions_count: enriched.length, total_invested: invested,
                        total_market_value: market, unrealized_pl_val: market != null && invested != null ? round(market-invested) : null,
                        unrealized_pl_pct: market != null && invested != null && invested > 0 ? round((market-invested)/invested*100) : null } };
            }
            if (positions.length > 100) throw new Error("المحفظة أكبر من حد المعالجة؛ لم يتم تعديلها");
            if (!symbol) throw new Error("رمز السهم مطلوب");
            const existing = positions.find((p: any) => p.symbol === symbol);
            let changed: any, eventType: string, payload: any;
            if (operation === "add" || operation === "update") {
                const quantity = positive(args.quantity ?? args.shares ?? args.amount);
                const price = positive(args.price ?? args.entry_price ?? args.buy_price ?? args.cost);
                let stockName = symbol;
                const { data: stock } = await supabase.from("stocks").select("symbol,name,name_ar").eq("symbol", symbol).limit(1).maybeSingle();
                if (stock) {
                    stockName = stock.name_ar || stock.name || symbol;
                } else {
                    const { data: ind } = await supabase.from("stock_technical_indicators").select("symbol").eq("exchange", "EGX").eq("symbol", symbol).limit(1);
                    if (!ind?.length) {
                        const { data: prc } = await supabase.from("stock_prices").select("symbol").eq("exchange", "EGX").eq("symbol", symbol).limit(1);
                        if (!prc?.length) throw new Error("الرمز غير موثق في دليل الأسهم؛ لم يتم الحفظ");
                    }
                }
                if (operation === "update" && !existing) throw new Error("لا يوجد مركز مفتوح لتحديثه");
                const write = { quantity, entry_price: price, updated_at: new Date().toISOString() };
                const { data } = existing
                    ? await lockPosition(supabase.from("positions").update(write).eq("user_id", userId).eq("id", existing.id)
                        .eq("status", "open"), existing).select("id,symbol,quantity,entry_price").limit(1)
                    : await supabase.from("positions").insert({ user_id: userId, symbol, name: stockName,
                        ...write, status: "open", source: "chatbot" }).select("id,symbol,quantity,entry_price").limit(1);
                changed = data?.[0]; eventType = existing ? "portfolio_update" : "portfolio_add";
                payload = { symbol, quantity, entry_price: price };
            } else if (operation === "remove") {
                if (!existing) throw new Error("لا يوجد مركز مفتوح لحذفه");
                const { data } = await lockPosition(supabase.from("positions").delete().eq("user_id",userId).eq("id",existing.id)
                    .eq("status","open"),existing).select("id,symbol").limit(1);
                changed = data?.[0]; eventType = "portfolio_remove"; payload = { symbol, quantity: existing.quantity };
            } else if (operation === "sell") {
                if (!existing) throw new Error("لا يوجد مركز مفتوح لتسجيل بيعه");
                const quantity = positive(args.quantity), price = positive(args.price), held = positive(existing.quantity);
                if (quantity > held) throw new Error("كمية البيع أكبر من الكمية المسجلة؛ لم يتم البيع");
                const { data } = await lockPosition(supabase.from("positions").update(quantity === held
                    ? { status: "closed", status_price: price, status_at: new Date().toISOString(), updated_at: new Date().toISOString() }
                    : { quantity: held - quantity, updated_at: new Date().toISOString() })
                    .eq("user_id",userId).eq("id",existing.id).eq("status","open").eq("quantity",held)
                    ,existing).select("id,symbol,quantity,status").limit(1);
                changed = data?.[0]; eventType = "portfolio_sell";
                payload = { symbol, quantity, sell_price: price, proceeds: quantity * price, entry_price: finite(existing.entry_price) };
            } else throw new Error("عملية المحفظة غير مدعومة");
            if (!changed) throw new Error("لم يتأكد تعديل أي مركز؛ قد يكون تغير بالتزامن. راجع المحفظة قبل إعادة الطلب");
            let quote: any = null;
            if (operation === "add" || operation === "update") {
                const { data: ind } = await supabase.from("stock_technical_indicators")
                    .select("close, date, rsi_14, change_pct").eq("exchange", "EGX").eq("symbol", symbol)
                    .order("date", { ascending: false }).limit(1);
                if (ind?.[0]) quote = ind[0];
            }
            let auditRecorded = true;
            try { await supabase.from("position_events").insert({ user_id: userId, position_id: operation === "remove" ? null : changed.id,
                event_type: eventType, payload, event_at: new Date().toISOString() }); }
            catch (error) { auditRecorded = false; console.error("[Agentic portfolio] audit write failed", error); }
            return { status: "success", ok: true, operation, persisted: true, symbol, ...payload,
                close: quote?.close, current_price: quote?.close, date: quote?.date, change_pct: quote?.change_pct,
                audit_recorded: auditRecorded, cash_updated: false,
                message: operation === "sell" ? "تم تسجيل البيع في المراكز؛ لم يتم تعديل الرصيد النقدي."
                    : "تم التأكد من حفظ تعديل المركز.",
                warning: auditRecorded ? undefined : "المركز تغير لكن سجل الحدث لم يُحفظ؛ لا تكرر العملية تلقائياً" };
        }

        if (toolName === "get_market") {
            const { data: cacheRow } = await supabase
                .from("market_cache")
                .select("payload")
                .eq("cache_key", "market_status_Egypt")
                .limit(1).maybeSingle();

            const payload = cacheRow?.payload || {};
            const egx30History = Array.isArray(payload.egx30) ? payload.egx30 : [];
            const latestEgx30 = egx30History.length > 0 ? egx30History[egx30History.length - 1] : null;
            const prevEgx30 = egx30History.length > 1 ? egx30History[egx30History.length - 2] : null;

            const egx30Close = latestEgx30?.close != null ? Number(latestEgx30.close) : null;
            const egx30ChangePct = (latestEgx30?.close != null && prevEgx30?.close != null && prevEgx30.close > 0)
                ? Number((((latestEgx30.close - prevEgx30.close) / prevEgx30.close) * 100).toFixed(2))
                : null;
            const regime = payload.regime || null;

            const { data: dateRows } = await supabase
                .from("stock_technical_indicators")
                .select("date")
                .eq("exchange", "EGX")
                .order("date", { ascending: false })
                .limit(1);
            const latestDate = latestEgx30?.date || dateRows?.[0]?.date || null;

            if (!latestDate) return { status: "success", availability: "missing", session_date: null, egx30: { close: null, change_pct: null, market_regime: null }, top_gainers: [], top_losers: [] };

            const { data: gainers } = await supabase
                .from("stock_technical_indicators")
                .select("symbol, close, change_pct, r_vol, rsi_14")
                .eq("exchange", "EGX")
                .eq("date", latestDate)
                .order("change_pct", { ascending: false })
                .limit(5);

            const { data: losers } = await supabase
                .from("stock_technical_indicators")
                .select("symbol, close, change_pct, r_vol, rsi_14")
                .eq("exchange", "EGX")
                .eq("date", latestDate)
                .order("change_pct", { ascending: true })
                .limit(5);

            return {
                status: "success",
                session_date: latestDate,
                egx30: {
                    close: egx30Close,
                    change_pct: egx30ChangePct,
                    high: latestEgx30?.high,
                    low: latestEgx30?.low,
                    volume: latestEgx30?.volume,
                    market_regime: regime
                },
                top_gainers: gainers || [],
                top_losers: losers || []
            };
        }

        if (toolName === "get_recommendations") {
            const statusFilter = args.status || "all";
            const timeframe = args.timeframe || "all";

            const { thisWeekStartIso, lastWeekStartIso } = cairoWeekBounds();

            let query = supabase
                .from("scan_results")
                .select("symbol, signal, entry_price, target_price, stop_loss, exit_price, profit_loss_pct, status, created_at")
                .order("created_at", { ascending: false });
            if (args.symbols?.length) query = query.in("symbol", args.symbols);

            if (statusFilter === "open") {
                query = query.in("status", ["open", "active"]);
            } else if (statusFilter === "closed") {
                query = query.in("status", ["win", "loss", "closed"]);
            }

            if (timeframe === "this_week") {
                query = query.gte("created_at", thisWeekStartIso);
            } else if (timeframe === "last_week") {
                query = query.gte("created_at", lastWeekStartIso).lt("created_at", thisWeekStartIso);
            }

            const { data: rows } = await query.limit(10);

            // Also check latest available date in database for accurate reporting when empty
            const { data: latestRow } = await supabase
                .from("scan_results")
                .select("created_at")
                .order("created_at", { ascending: false })
                .limit(1);
            const latestDateInDb = latestRow?.[0]?.created_at ? String(latestRow[0].created_at).slice(0, 10) : null;

            const enrichedRecs = [];

            for (const r of rows || []) {
                const sym = r.symbol;
                const entry = Number(r.entry_price || 0);
                const isClosed = ["win", "loss", "closed"].includes(r.status);

                let realizedReturnPct: number | null = null;
                let unrealizedReturnPct: number | null = null;
                let currPrice: number | null = null;
                let quoteDate: string | null = null;

                if (isClosed) {
                    if (r.profit_loss_pct != null) {
                        realizedReturnPct = Number(Number(r.profit_loss_pct).toFixed(2));
                    } else if (r.exit_price != null && entry > 0) {
                        realizedReturnPct = round(((Number(r.exit_price) - entry) / entry) * 100 * (r.signal === "SELL" ? -1 : 1));
                    }
                } else {
                    const { data: indRows } = await supabase
                        .from("stock_technical_indicators")
                        .select("close, date")
                        .eq("exchange", "EGX").eq("symbol", sym)
                        .order("date", { ascending: false })
                        .limit(1);
                    currPrice = finite(indRows?.[0]?.close);
                    quoteDate = indRows?.[0]?.date ?? null;
                    if (entry > 0 && currPrice != null) {
                        unrealizedReturnPct = round(((currPrice - entry) / entry) * 100 * (r.signal === "SELL" ? -1 : 1));
                    }
                }

                enrichedRecs.push({
                    symbol: sym,
                    signal: r.signal || "BUY",
                    entry_price: entry,
                    target_price: r.target_price,
                    stop_loss: r.stop_loss,
                    exit_price: r.exit_price,
                    status: r.status,
                    signal_date: String(r.created_at || "").slice(0, 10),
                    current_price: currPrice,
                    current_date: quoteDate,
                    realized_return_pct: realizedReturnPct,
                    unrealized_return_pct: unrealizedReturnPct
                });
            }

            return {
                status: "success",
                timeframe,
                status_filter: statusFilter,
                count: enrichedRecs.length,
                recommendations: enrichedRecs,
                truncated: (rows || []).length === 10,
                latest_available_date_in_system: latestDateInDb,
                note: enrichedRecs.length === 0
                    ? `لا توجد توصيات مسجلة خلال الفترة المطلوبة (${timeframe === "this_week" ? "الأسبوع الحالي" : timeframe === "last_week" ? "الأسبوع الماضي" : timeframe}). ${latestDateInDb ? `أحدث توصيات مسجلة تعود لتاريخ ${latestDateInDb}.` : "لا يوجد تاريخ توصيات موثق متاح."}`
                    : undefined
            };
        }

        if (toolName === "get_technical_scan" || toolName === "get_accumulation_stocks") {
            const preset = toolName === "get_accumulation_stocks" ? "smart_money_flow" : args.preset;
            const table = preset === "smart_money_flow" ? "stock_scans_summary" : "stock_technical_indicators";
            const dateField = table === "stock_scans_summary" ? "scan_date" : "date";
            let dateQuery = supabase.from(table).select(dateField);
            if (table === "stock_technical_indicators") dateQuery = dateQuery.eq("exchange","EGX");
            const { data: dates } = await dateQuery.order(dateField,{ascending:false}).limit(1);
            const date = dates?.[0]?.[dateField] ?? null;
            if (!date) return { status:"success", availability:"missing", preset, date:null, stocks:[] };
            let query = supabase.from(table).select(table === "stock_scans_summary"
                ? "symbol,scan_date,acc_score,dist_score,vol_ratio,wyckoff_phase,signal"
                : "symbol,date,close,change_pct,r_vol,rsi_14,macd,macd_signal,macd_histogram,ema_50,ema_200,king_ai_score,egx_ai_score")
                .eq(dateField,date);
            if (table === "stock_technical_indicators") query = query.eq("exchange","EGX");
            switch (preset) {
                case "momentum_and_volume": query = query.gt("r_vol",1).gt("change_pct",0).order("change_pct",{ascending:false}); break;
                case "top_gainers": query = query.gt("change_pct",0).order("change_pct",{ascending:false}); break;
                case "top_losers": query = query.lt("change_pct",0).order("change_pct",{ascending:true}); break;
                case "rsi_oversold": query = query.lte("rsi_14",35).order("rsi_14",{ascending:true}); break;
                case "smart_money_flow": query = query.gte("acc_score",50).order("acc_score",{ascending:false}); break;
                case "macd_cross": query = query.gt("macd_histogram",0).order("macd_histogram",{ascending:false}); break;
                default: throw new Error("قالب المسح غير مدعوم");
            }
            const { data } = await query.limit(preset === "macd_cross" ? 60 : 10);
            let stocks = data || [];
            if (preset === "macd_cross" && stocks.length) {
                const { data: previousDates } = await supabase.from(table).select("date").eq("exchange","EGX")
                    .lt("date",date).order("date",{ascending:false}).limit(1);
                const previousDate = previousDates?.[0]?.date;
                if (!previousDate) stocks = [];
                else {
                    const { data: previous } = await supabase.from(table).select("symbol,date,macd_histogram").eq("exchange","EGX")
                        .eq("date",previousDate).in("symbol",stocks.map((s:any)=>s.symbol)).lte("macd_histogram",0).limit(60);
                    const crossed = new Set((previous || []).map((s:any)=>s.symbol));
                    stocks = stocks.filter((s:any)=>crossed.has(s.symbol)).slice(0,10);
                }
            }
            return { status:"success", preset, date, stocks, accumulation_stocks: toolName === "get_accumulation_stocks" ? stocks : undefined,
                bounded_candidates: preset === "macd_cross" ? 60 : 10, methodology: preset === "macd_cross" ? "Histogram crossed from <=0 previous session to >0 latest session" : preset };
        }

        if (toolName === "get_news") {
            const symbols = args.symbols || [];
            let stockIds: number[] = [];
            const names = new Map<number,string>();
            if (symbols.length) {
                const { data: stocks } = await supabase.from("stocks").select("id,symbol").in("symbol",symbols).limit(10);
                for (const stock of stocks || []) { stockIds.push(stock.id); names.set(stock.id,stock.symbol); }
                if (!stockIds.length) return { status:"success", availability:"missing", news:[], symbols, note:"لم أجد رموزاً موثقة للأخبار المطلوبة" };
            }
            let query = supabase.from("news").select("stock_id,title,published_at,source,url")
                .order("published_at",{ascending:false});
            if (stockIds.length) query = query.in("stock_id",stockIds);
            const { data: rows } = await query.limit(10);
            return { status:"success", news:(rows || []).map((r:any)=>({...r,symbol:names.get(r.stock_id) ?? null})), symbols };
        }

        if (toolName === "get_comparison") {
            const symbols: string[] = Array.isArray(args.symbols)
                ? args.symbols.map(normalizeSymbol)
                : [];
            const data = [];
            for (const sym of symbols) {
                const { data: indRows } = await supabase
                    .from("stock_technical_indicators")
                    .select("symbol, close, change_pct, r_vol, rsi_14, macd, macd_signal, macd_histogram, ema_50, ema_200, bb_upper, bb_lower, king_ai_score, egx_ai_score, date")
                    .eq("exchange", "EGX").eq("symbol", sym)
                    .order("date", { ascending: false })
                    .limit(1);
                if (indRows && indRows.length > 0) {
                    data.push(indRows[0]);
                } else {
                    data.push({ symbol: sym, error: "Not found in active main market" });
                }
            }
            return { status: "success", comparison: data, comparisons: data };
        }

        return { status: "error", message: `Tool ${toolName} not recognized` };
    } catch (e: any) {
        return { status: "error", message: e.message || String(e) };
    }
}

