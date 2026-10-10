import { executionSupabase } from "./execution";
import { executeChartStrategyTool, type ChartHistoryCache } from "./chart-strategy-tools";
import { sanitizeNewsRows } from "./news-evidence";
import { todayInCairo } from "./cairo-date";

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
        if (toolName === "calculate_position") {
            if (!args.symbol) throw new Error("رمز السهم مطلوب لحساب المركز");
            const symbol = normalizeSymbol(args.symbol);
            let quantity = args.quantity == null ? null : positive(args.quantity);
            const suppliedEntry = args.entry_price == null ? null : positive(args.entry_price);
            const suppliedCost = args.total_cost == null ? null : positive(args.total_cost);
            if (quantity == null && suppliedCost == null) throw new Error("أدخل الكمية ومتوسط الشراء، أو التكلفة الإجمالية المعروفة");
            if (quantity != null && suppliedEntry == null && suppliedCost == null) throw new Error("مع الكمية، أدخل متوسط الشراء أو التكلفة الإجمالية المعروفة");
            const cost = suppliedCost ?? (quantity! * suppliedEntry!);
            if (quantity == null && suppliedCost != null && suppliedEntry != null) quantity = cost / suppliedEntry;
            const entry_price = suppliedEntry ?? (quantity != null ? cost / quantity : null);
            if (suppliedCost != null && quantity != null && suppliedEntry != null && Math.abs(quantity * suppliedEntry - suppliedCost) > 0.01)
                throw new Error("التكلفة الإجمالية لا تطابق الكمية ومتوسط الشراء");
            if (!Number.isFinite(cost) || (quantity != null && !Number.isFinite(quantity)) || (entry_price != null && !Number.isFinite(entry_price))) throw new Error("قيمة المركز تتجاوز حدود الحساب");
            const { data } = await supabase.from("stock_technical_indicators")
                .select("date,close").eq("exchange", "EGX").eq("symbol", symbol)
                .order("date", { ascending: false }).limit(1);
            const quote = data?.[0];
            const close = finite(quote?.close);
            const priced = close != null && close > 0 && Boolean(quote?.date);
            const marketValue = priced && quantity != null ? quantity * close! : null;
            const profit = marketValue == null ? null : marketValue - cost;
            if (marketValue != null && !Number.isFinite(marketValue)) throw new Error("قيمة المركز تتجاوز حدود الحساب");
            return { status: "success", mode: "temporary_position", persisted: false,
                valuation_complete: priced && quantity != null, fees_included: false,
                positions: [{ symbol, quantity, entry_price, cost: round(cost),
                    close: priced ? close : null, date: priced ? quote.date : null,
                    market_value: round(marketValue), profit_loss_val: round(profit),
                    profit_loss_pct: profit == null ? null : round(profit / cost * 100) }],
                formulas: { cost: suppliedCost != null ? "user_supplied_total_cost" : "quantity * entry_price", market_value: "quantity * close",
                    profit_loss_val: "market_value - cost", profit_loss_pct: "profit_loss_val / cost * 100" } };
        }
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
                        distance_from_support_pct: close != null && close > 0 && support != null ? (support - close) / close * 100 : null,
                        distance_from_resistance_pct: close != null && close > 0 && resistance != null ? (resistance - close) / close * 100 : null,
                        distance_basis: "(level - close) / close * 100; negative=below close; positive=above close; absolute value for proximity",
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
                return { status: "success", operation, persisted: false, read_complete: true,
                    empty: positions.length === 0, saved_positions_found: positions.length > 0,
                    valuation_complete: complete, truncated: positions.length > 100, positions: enriched,
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

        if (toolName === "screen_stocks") {
            const rsiMin = finite(args.rsi_min) ?? 40, rsiMax = finite(args.rsi_max) ?? 60;
            const volumeMin = finite(args.relative_volume_min) ?? 1;
            const distanceMax = finite(args.max_resistance_distance_pct) ?? 3;
            // User wording like "أعلى من" is strict by default at every threshold.
            // Inclusive thresholds must be requested explicitly ("على الأقل").
            const volumeInclusive = typeof args.relative_volume_inclusive === "boolean" ? args.relative_volume_inclusive : false;
            const distanceInclusive = args.resistance_distance_inclusive === true;
            const maxResults = Math.trunc(finite(args.max_results) ?? 10);
            if (rsiMin < 0 || rsiMax > 100 || rsiMin >= rsiMax) throw new Error("نطاق RSI غير صالح");
            if (volumeMin <= 0 || volumeMin > 20) throw new Error("حد الحجم النسبي يجب أن يكون بين 0 و20");
            if (distanceMax <= 0 || distanceMax > 10) throw new Error("حد القرب من المقاومة يجب أن يكون أكبر من صفر وحتى 10%");
            if (maxResults < 1 || maxResults > 20) throw new Error("عدد النتائج يجب أن يكون بين 1 و20");
            const { data: dates } = await supabase.from("stock_technical_indicators").select("date")
                .eq("exchange", "EGX").order("date", { ascending: false }).limit(1);
            const date = dates?.[0]?.date;
            if (!date) return { status:"success", availability:"missing", date:null, stocks:[], scan_complete:false };
            let candidateQuery = supabase.from("stock_technical_indicators")
                .select("symbol,date,close,change_pct,r_vol,rsi_14")
                .eq("exchange", "EGX").eq("date", date).gte("rsi_14", rsiMin).lte("rsi_14", rsiMax);
            candidateQuery = volumeInclusive ? candidateQuery.gte("r_vol", volumeMin) : candidateQuery.gt("r_vol", volumeMin);
            const { data: candidates } = await candidateQuery.order("r_vol", { ascending:false }).limit(251);
            const bounded = candidates || [];
            const truncated = bounded.length > 250;
            const rows = bounded.slice(0,250);
            const symbols = rows.map((r:any)=>normalizeSymbol(r.symbol));
            const startDate = new Date(`${date}T00:00:00Z`); startDate.setUTCDate(startDate.getUTCDate()-45);
            const history: any[] = [];
            for (let offset=0; offset<symbols.length; offset+=20) {
                const page = symbols.slice(offset,offset+20);
                const { data } = await supabase.from("stock_prices").select("symbol,date,high,close")
                    .eq("exchange","EGX").in("symbol",page).gte("date",startDate.toISOString().slice(0,10))
                    .lte("date",date).order("date",{ascending:false}).limit(1000);
                history.push(...(data || []));
            }
            const histories = new Map<string, any[]>();
            for (const row of history) { const list=histories.get(row.symbol)||[]; list.push(row); histories.set(row.symbol,list); }
            const insufficientHistory:string[]=[];
            const stocks = rows.flatMap((row:any) => {
                const prices = (histories.get(normalizeSymbol(row.symbol))||[]).slice(0,20);
                if (prices.length < 20) { insufficientHistory.push(row.symbol); return []; }
                const highs = prices.map((p:any)=>finite(p.high ?? p.close)).filter((n:any)=>n != null && n > 0) as number[];
                const resistance = highs.length === 20 ? Math.max(...highs) : null;
                const close=finite(row.close);
                if (resistance == null || close == null || close > resistance) return [];
                // Express distance as a percentage of the observed close; this is
                // the same denominator used by the publication validator.
                const distance = (resistance-close)/close*100;
                if (distanceInclusive ? distance > distanceMax : distance >= distanceMax) return [];
                return [{ symbol:row.symbol, date:row.date, close, change_pct:finite(row.change_pct), r_vol:finite(row.r_vol),
                    rsi_14:finite(row.rsi_14), resistance:Number(resistance.toFixed(6)), distance_from_resistance_pct:round(distance),
                    resistance_relation:close === resistance ? "at" : "below",
                    price_type:"daily_close", resistance_sessions:20 }];
            }).sort((a:any,b:any)=>(a.distance_from_resistance_pct-b.distance_from_resistance_pct)||(b.r_vol-a.r_vol)).slice(0,maxResults);
            return { status:"success", date, filters:{rsi_min:rsiMin,rsi_max:rsiMax,relative_volume_min:volumeMin,
                relative_volume_inclusive:volumeInclusive,max_resistance_distance_pct:distanceMax,resistance_distance_inclusive:distanceInclusive}, stocks, scan_complete:!truncated && insufficientHistory.length===0,
                candidate_limit:250, candidates_checked:rows.length, truncated, insufficient_history_symbols:insufficientHistory,
                methodology:`r_vol ${volumeInclusive ? ">=" : ">"} threshold; distance ${distanceInclusive ? "<=" : "<"} threshold; resistance is maximum high over latest 20 daily sessions including snapshot session; distance=(resistance-close)/close*100`,
                breakout_assessment:"This rolling high includes the snapshot session; proximity or equality does not establish a breakout above prior resistance." };
        }

        if (toolName === "analyze_portfolio_risk") {
            if (!userId) throw new Error("يلزم مستخدم مصادق عليه لتحليل السيناريو");
            const capital = positive(args.capital);
            const symbols: string[] = [...new Set<string>((args.symbols as unknown[]).map((value:any)=>normalizeSymbol(value)))];
            if (symbols.length < 2 || symbols.length > 10) throw new Error("أدخل من سهمين إلى عشرة أسهم لتحليل السيناريو");
            let weights: Map<string,number>;
            if (args.allocation_mode !== "equal" && Array.isArray(args.allocations) && args.allocations.length) {
                weights = new Map<string,number>();
                for (const item of args.allocations) {
                    const sym=normalizeSymbol(item.symbol), pct=finite(item.allocation_pct);
                    if (!symbols.includes(sym) || pct == null || pct <= 0 || weights.has(sym)) throw new Error("توزيع السيناريو غير صالح أو لا يطابق قائمة الأسهم");
                    weights.set(sym,pct);
                }
                if (symbols.some((sym:string)=>!weights.has(sym)) || Math.abs([...weights.values()].reduce((a:number,b:number)=>a+b,0)-100)>0.1)
                    throw new Error("يجب توزيع 100% على جميع الأسهم المذكورة");
            } else weights = new Map<string,number>(symbols.map((sym:string)=>[sym,100/symbols.length]));
            const [{data:savedRows},{data:fundRows}] = await Promise.all([
                supabase.from("positions").select("symbol").eq("user_id",userId).eq("status","open").in("symbol",symbols).limit(10),
                supabase.from("stock_fundamentals").select("symbol,data").eq("exchange","EGX").in("symbol",symbols).limit(10)
            ]);
            const saved = new Set((savedRows||[]).map((r:any)=>normalizeSymbol(r.symbol)));
            const fundamentals = new Map((fundRows||[]).map((r:any)=>[normalizeSymbol(r.symbol),r.data]));
            const classificationOf=(raw:any):{sector:string|null;industry:string|null}=>{
                const data=typeof raw === "string" ? (()=>{try{return JSON.parse(raw)}catch{return {}}})() : raw||{};
                const text=(value:any)=>typeof value === "string" && value.trim() ? value.trim() : null;
                return {sector:text(data.sector ?? data.Sector),industry:text(data.industry ?? data.Industry)};
            };
            const equalWeight=args.allocation_mode === "equal" || !args.allocations?.length;
            const totalCents=Math.round(capital*100), baseCents=Math.floor(totalCents/symbols.length), extraCents=totalCents % symbols.length;
            const stocks=symbols.map((symbol:string,index:number)=>{
                const rawAllocation=weights.get(symbol)!;
                const allocation_pct=Number(rawAllocation.toFixed(4));
                const allocated_capital=equalWeight
                    ? (baseCents + (index >= symbols.length-extraCents ? 1 : 0))/100 : round(capital*rawAllocation/100);
                const {sector,industry}=classificationOf(fundamentals.get(symbol));
                return {symbol,sector,industry,allocation_pct,allocated_capital,saved:saved.has(symbol),availability:fundamentals.has(symbol)?"available":"partial"};
            });
            const sectors=new Map<string,any>();
            for(const row of stocks){const key=row.sector||"غير محدد";const current=sectors.get(key)||{symbol:"PORTFOLIO",sector:row.sector,allocation_pct:0,allocated_capital:0,symbols:[]};
                current.allocation_pct+=row.allocation_pct;current.allocated_capital+=row.allocated_capital;current.symbols.push(row.symbol);sectors.set(key,current);}
            const sector_exposure=[...sectors.values()].map((s:any)=>({...s,allocation_pct:round(s.allocation_pct),allocated_capital:round(s.allocated_capital)}));
            const industries=new Map<string,any>();
            for(const row of stocks){const key=row.industry||"غير محدد";const current=industries.get(key)||{symbol:"PORTFOLIO",industry:row.industry,allocation_pct:0,allocated_capital:0,symbols:[]};
                current.allocation_pct+=row.allocation_pct;current.allocated_capital+=row.allocated_capital;current.symbols.push(row.symbol);industries.set(key,current);}
            const industry_exposure=[...industries.values()].map((s:any)=>({...s,allocation_pct:round(s.allocation_pct),allocated_capital:round(s.allocated_capital)}));
            const stress_scenarios_not_forecasts=[{change_pct:-5,loss:round(capital*.05)},{change_pct:-10,loss:round(capital*.10)}];
            return {status:"success",mode:"scenario",source_portfolio:"user_scenario_not_saved",capital,
                assumption:equalWeight?"equal_weight":"explicit_allocations",currency:"EGP",stocks,sector_exposure,industry_exposure,
                risk_scope:"allocation_concentration_and_stress_only",
                limitations:["لم تُحسب تقلبات الأسهم أو الارتباطات بينها من سلسلة عوائد تاريخية؛ لا يصح اعتبار التوزيع أو هبوط السيناريو مقياساً للمخاطر السوقية الفعلية.","السيناريو توزيع لرأس المال وليس كميات أسهم مشتراة؛ لم تستخدم أسعار تنفيذ أو تكاليف شراء أو سيولة تداول."],
                rounding_note:equalWeight ? "التوزيع متساوٍ قبل التقريب؛ يعرض الوزن إلى أربع منازل والمبلغ إلى قرشين، وتوزع قروش فرق التقريب على المبالغ الأخيرة للحفاظ على رأس المال، وليس كتفضيل للسهم." : null,
                sector_concentration_complete:stocks.every((s:any)=>s.sector!=null),
                industry_concentration_complete:stocks.every((s:any)=>s.industry!=null),
                classification_note:"القطاع تصنيف عام من المصدر وقد يجمع شركات تعمل في صناعات مختلفة؛ اعرض الصناعة بجانبه ولا تعتبر القطاع العام نشاطاً واحداً. القيم غير المتاحة ليست قطاعاً أو صناعة مشتركة مؤكدة.",
                stress_scenarios_not_forecasts,
                scenario_metrics:[{symbol:"PORTFOLIO",scenario_capital:capital},...stress_scenarios_not_forecasts.map((s:any)=>({symbol:"PORTFOLIO",scenario_loss_pct:s.change_pct,scenario_loss_amount:-s.loss}))],
                saved_symbols:symbols.filter((s:string)=>saved.has(s)),not_saved_symbols:symbols.filter((s:string)=>!saved.has(s)),persisted:false};
        }

        if (toolName === "get_news") {
            const symbols: string[] = args.symbols || [];
            const today = todayInCairo();
            const since = new Date(`${today}T00:00:00Z`);
            since.setUTCDate(since.getUTCDate() - 7);
            const sinceDate = since.toISOString().slice(0, 10);
            let query = supabase.from("stock_news_sentiment")
                .select("symbol,date,sentiment_score,news_count,headlines")
                .eq("exchange", "EGX").gte("date", sinceDate).gt("news_count", 0)
                .order("date", { ascending: false }).limit(50);
            if (symbols.length) query = query.in("symbol", symbols);
            const { data: rows } = await query;
            const rowSymbols = [...new Set((rows || []).map((r:any)=>String(r.symbol || "").toUpperCase()).filter(Boolean))];
            const { data: names } = rowSymbols.length
                ? await supabase.from("stocks").select("symbol,name").in("symbol", rowSymbols).limit(rowSymbols.length)
                : { data: [] };
            const nameMap = new Map<string,string>((names || []).map((r:any)=>[String(r.symbol).toUpperCase(),String(r.name || "")]));
            const news = sanitizeNewsRows(rows || [], nameMap);
            return { status:"success", availability:news.length ? "available" : "missing", news, symbols,
                date_range:{ from:sinceDate, through:today }, note:news.length ? undefined : "لا توجد عناوين موثقة مطابقة في مصدر الأخبار خلال آخر 7 أيام" };
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
        return { status: "error", availability: "error", persisted: false, message: e.message || String(e) };
    }
}


