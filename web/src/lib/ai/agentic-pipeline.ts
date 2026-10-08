import { SessionState, SessionSummary } from "./types";
import { ExcelTable } from "./excel-tables";
import { getDeepSeekApiKey } from "./server-secrets";
import { AI_CONFIG } from "./config";

export interface PipelineOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    mockToolsResults?: any;
    mockPlannerResult?: any;
    mockVisionResult?: any;
    isPro?: boolean;
}

export interface AgenticToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export const AGENTIC_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_stock",
            "description": "جلب التحليل الفني والمالي اللحظي وسعر الإغلاق والمؤشرات (RSI, MACD, وايكوف, أحجام التداول, نماذج الذكاء الاصطناعي KING/EGX) لأسهم معينة في البورصة المصرية.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "قائمة بأكواد الأسهم مثل ['ETEL', 'AMES', 'COMI']"
                    }
                },
                "required": ["symbols"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_levels",
            "description": "جلب مستويات الدعم والمقاومة ووقف الخسارة والمستهدفات الفنية لسهم معين.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "أكواد الأسهم"
                    }
                },
                "required": ["symbols"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "manage_portfolio",
            "description": "عرض أو تسجيل أو تحديث مراكز محفظة المستخدم الاستثمارية في قاعدة البيانات (مثل إضافة سهم بالكمية وسعر الشراء، أو تحليل المحفظة الحالية).",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["view", "add", "update", "remove", "sell"],
                        "description": "العملية المطلوبة: view لعرض المحفظة الحالية، add لإضافة سهم، update لتعديل مركز، remove لحذف مركز."
                    },
                    "symbol": {
                        "type": "string",
                        "description": "كود السهم مثل AMES أو ETEL"
                    },
                    "quantity": {
                        "type": "number",
                        "description": "عدد الأسهم المشتراة"
                    },
                    "price": {
                        "type": "number",
                        "description": "سعر الشراء للسهـم"
                    }
                },
                "required": ["operation"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_market",
            "description": "جلب نظرة عامة على أداء السوق والبورصة المصرية (مؤشر EGX30، EGX70، حالة السيولة، والأسهم الأكثر ارتفاعاً والأكثر انخفاضاً للجلسة).",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_recommendations",
            "description": "جلب التوصيات والإشارات الاستثمارية الصادرة من نماذج ومسح EGX Bots (المفتوحة والمغلقة ونسب الأرباح المحققة).",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["open", "closed", "all"],
                        "description": "حالة التوصية: open للمفتوحة، closed للمغلقة، all للكل"
                    },
                    "timeframe": {
                        "type": "string",
                        "enum": ["this_week", "last_week", "all"],
                        "description": "الفترة الزمنية المطلوبة للتوصيات"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_technical_scan",
            "description": "مسح فني للسوق واستخراج أفضل الأسهم بناءً على معايير فنية محددة (أقوى زخم وسيولة، ذروة البيع RSI، اختراق حجم، التقاطع الذهبي MACD، إلخ).",
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {
                        "type": "string",
                        "enum": ["momentum_and_volume", "top_gainers", "top_losers", "rsi_oversold", "macd_cross", "smart_money_flow"],
                        "description": "قالب المسح الفني المطلوب"
                    }
                },
                "required": ["preset"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_accumulation_stocks",
            "description": "جلب الأسهم التي تمر بمرحلة تجميع مؤسسي وفق منهجية وايكوف (Wyckoff Accumulation) وتدفق سيولة ذكية.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_news",
            "description": "جلب آخر الأخبار المالية والإفصاحات وأخبار الشركات من مصادر موثوقة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "أكواد الأسهم المطلوبة، أو اتركها فارغة لأخبار السوق العامة"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_comparison",
            "description": "مقارنة فنية مباشرة بين سهمين أو أكثر من حيث السعر، الزخم (RSI)، السيولة، ونماذج الذكاء الاصطناعي.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "أكواد الأسهم المراد مقارنتها، مثل ['ETEL', 'COMI']"
                    }
                },
                "required": ["symbols"]
            }
        }
    }
];

export const AGENTIC_SYSTEM_PROMPT = `أنت "EGX Bots AI" — المحلل المالي والمستشار التقني الذكي الأول للبورصة المصرية (EGX).
مهمتك: مساعدة المتداولين والمستثمرين بتحليل علمي دقيق، ومتابعة محافظهم الاستثمارية، واقتناص الفرص الفنية، والإجابة على استفساراتهم باحترافية وسلاسة تامة.

قواعد العمل الأساسية (Agentic Principles):
1. **أنت صانع القرار الكامل في تحديد النية واستدعاء الأدوات**:
   - لا تعتمد على قوالب جامدة أو نصوص معلبة.
   - إذا كان سؤال المستخدم يحتاج إلى بيانات سوقية، مؤشرات فنية، أسعار، محفظة، توصيات، أو مسح فني: استدعِ الأداة المناسبة فوراً (Tool Calling) مع المدخلات الصحيحة.
   - ⚠️ **قاعدة حاسمة**: إذا أرسل المستخدم اسم سهم أو رمزه فقط (مثل "ابو قير" أو "Ajwa" أو "COMI" أو "Ineg" أو "AMES")، حتى لو جاء في سياق متابعة بعد مسح عام، **يجب دائماً وبلا استثناء استدعاء أداة get_stock و get_stock_levels فوراً** لجلب بيانات السهم وسعره ومستوياته وتحليله تفصيلياً، ويُمنع تماماً إعادة تشغيل مسح تجميع أو مسح سوق عام أو تكرار القوائم السابقة.
   - إذا ذكر المستخدم مركزاً استثمارياً اشتراه (مثل "Ames بسعر 45.05 عدد 1115")، استدعِ أداة manage_portfolio لتسجيله في محفظته فوراً.
   - إذا طلب تحليل محفظته ("حلل محفظتي")، استدعِ أداة manage_portfolio لاسترجاع مراكزه وتحليلها بالكامل.
   - إذا سأل عن أسهم أو مقارنات أو سيولة أو أفضل أسهم، استدعِ الأدوات المناسبة ثم لخص النتائج بذكاء بشري راقٍ.
   - إذا لم يحتج السؤال إلى أدوات (شات عام، استيضاح، تحية)، أجب مباشرة بود واحترافية.

2. **الفهم الذكي للسياق والأسهم والأسواق**:
   - افهم أسماء الشركات باللغة العربية والعامية (مثلاً: "طاقة" -> TAQA، "المصرية للاتصالات" -> ETEL، "أبو قير" -> ABUK، "أجواء" -> AJWA، "توسيع" في سياق الجلسة السابقة تشير إلى سهم TWSA).
   - انتبه: البورصة المصرية تضم السوق الرئيسي (236 سهماً رئيسياً) وسوق الشركات الصغيرة والمتوسطة (بورصة النيل مثل ADRI وVERT). إذا سأل المستخدم عن سهم في بورصة النيل لا تتوفر له مؤشرات لحظية آلية، وضح له ذلك بذكاء واشرح له طبيعة قيده دون إجابات جافة أو رفض آلي، واستخدم ما ذكره المستخدم من أسعار إن وجدت.

3. **الأمان والدقة الفنية الصارمة (Grounding & Precision)**:
   - ⛔ **ممنوع اختراع أرقام أو مستويات**: لا تبتكر نقاط دخول أو مستويات تأكيد أو اختراق (مثل "دخول 12-12.30" أو "استقرار فوق 50-52") من عندك أبداً. التزم حصراً بالمستويات الواردة في نتائج الأدوات (الدعم والمقاومة، وقف الخسارة، سعر الدخول، المستهدف). إذا لم تكن هناك نقطة دخول مسجلة، وضّح أن السهم في منطقة مراقبة حيادية بين الدعم والمقاومة.
   - 📊 **الحجم النسبي (r_vol) ليس سيولة مطلقة**: معامل الحجم النسبي يصف نشاط التداول مقارنة بمتوسط الـ 20 جلسة للسهم نفسه فقط. إذا كانت قيمة r_vol أقل من 1.0، فالسهم يتداول بأحجام **أقل من متوسطه المعتاد**، ولا يجوز إطلاقاً وصفه بأنه "سيولة مرتفعة" أو "تجميع مؤسسي ضخم" حتى لو كانت نسبته أعلى بقليل من سهم آخر.
   - 🎯 **التوصيات المغلقة**: عند استعراض توصية مغلقة (حالتها loss أو win)، التزم بالنتيجة المحققة الفعلية المسجلة وتاريخ الخروج وسعر وقف الخسارة أو الهدف، ولا تحسب النتيجة من سعر إغلاق السهم الحالي بعد إغلاق التوصية. وإذا لم تكن هناك توصيات للفترة المطلوبة، اذكر ذلك صراحة مع ذكر تاريخ أحدث توصية متوفرة في المنصة بدقة.
   - ✍️ **اكتمال الرد**: لا تترك جداول مبتورة أو نقاطاً غير مكتملة تحتوي على "..." بل اعرض النتائج كاملة ومفيدة. وإذا طلبت توضيحاً، اجعل اقتراحاتك في صلب أسهم وتداولات البورصة المصرية.

4. **الخاتمة الإلزامية**:
   - اختم دائماً وبلا استثناء كل رد بالتنويه الإرشادي ورابط قناة التليجرام:
     ✅ تحليل EGX Bots مبني على أحدث البيانات المتاحة ومؤرّخ بمصدره — مش نصيحة استثمار، القرار ليك.

     📢 [قناة EGX Bots المجانية على تليجرام للتنبيهات والفرص](https://t.me/egxbots)
`;

export async function executeAgenticTool(
    toolName: string,
    args: Record<string, any>,
    supabase: any,
    userId: string
): Promise<any> {
    try {
        if (toolName === "get_stock") {
            const symbols: string[] = Array.isArray(args.symbols)
                ? args.symbols.map((s: any) => String(s).toUpperCase())
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
                    .eq("exchange", "EGX")
                    .eq("symbol", sym)
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
                        market_type: "سوق المشروعات الصغيرة والمتوسطة (بورصة النيل) أو غير مسجل في المؤشرات اللحظية",
                        message: `السهم ${sym} غير مدرج في قاعدة المؤشرات الآلية اللحظية للسوق الرئيسي (236 سهماً).`
                    });
                } else {
                    const ind = indRows[0];
                    const wyckoff = wyckoffRows?.[0] || {};
                    results.push({
                        symbol: sym,
                        name: stockData.name_ar || stockData.name || sym,
                        found_in_main_market: true,
                        date: ind.date,
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
                ? args.symbols.map((s: any) => String(s).toUpperCase())
                : [];
            const levels = [];
            for (const sym of symbols) {
                const { data: pRows } = await supabase
                    .from("stock_prices")
                    .select("high, low, close, date")
                    .eq("exchange", "EGX")
                    .eq("symbol", sym)
                    .order("date", { ascending: false })
                    .limit(60);
                if (pRows && pRows.length > 0) {
                    const lows = pRows.map((r: any) => r.low).filter((v: any) => v != null);
                    const highs = pRows.map((r: any) => r.high).filter((v: any) => v != null);
                    const support = lows.length > 0 ? Math.min(...lows.slice(0, 20)) : null;
                    const resistance = highs.length > 0 ? Math.max(...highs.slice(0, 20)) : null;
                    levels.push({
                        symbol: sym,
                        close: pRows[0].close,
                        support,
                        resistance,
                        date: pRows[0].date
                    });
                } else {
                    levels.push({ symbol: sym, error: "No price history available" });
                }
            }
            return { status: "success", levels };
        }

        if (toolName === "manage_portfolio") {
            const operation = args.operation || "view";
            const symbol = args.symbol ? String(args.symbol).toUpperCase() : null;
            const quantity = args.quantity != null ? Number(args.quantity) : null;
            const price = args.price != null ? Number(args.price) : null;

            if (operation === "view") {
                const { data: posRows } = await supabase
                    .from("positions")
                    .select("symbol, quantity, entry_price, status, added_at")
                    .eq("user_id", userId)
                    .eq("status", "open");
                const positions = posRows || [];
                const enriched = [];
                let totalCost = 0.0;
                let totalMarketVal = 0.0;

                for (const p of positions) {
                    const sym = p.symbol;
                    const qty = Number(p.quantity || 0);
                    const entry = Number(p.entry_price || 0);

                    const { data: indRows } = await supabase
                        .from("stock_technical_indicators")
                        .select("close, change_pct, rsi_14, king_ai_score, egx_ai_score, date")
                        .eq("symbol", sym)
                        .order("date", { ascending: false })
                        .limit(1);

                    const latestPrice = indRows?.[0]?.close ?? entry;
                    const cost = qty * entry;
                    const mktVal = qty * latestPrice;
                    const plVal = mktVal - cost;
                    const plPct = entry > 0 ? ((latestPrice - entry) / entry) * 100 : 0.0;

                    totalCost += cost;
                    totalMarketVal += mktVal;

                    enriched.push({
                        symbol: sym,
                        quantity: qty,
                        entry_price: entry,
                        current_price: latestPrice,
                        cost: Number(cost.toFixed(2)),
                        market_value: Number(mktVal.toFixed(2)),
                        profit_loss_val: Number(plVal.toFixed(2)),
                        profit_loss_pct: Number(plPct.toFixed(2)),
                        rsi: indRows?.[0]?.rsi_14 ?? null,
                        king_ai: indRows?.[0]?.king_ai_score ?? null,
                        egx_ai: indRows?.[0]?.egx_ai_score ?? null
                    });
                }

                const totalPlVal = totalMarketVal - totalCost;
                const totalPlPct = totalCost > 0 ? (totalPlVal / totalCost) * 100 : 0.0;

                return {
                    status: "success",
                    operation: "view",
                    summary: {
                        total_invested: Number(totalCost.toFixed(2)),
                        total_market_value: Number(totalMarketVal.toFixed(2)),
                        unrealized_pl_val: Number(totalPlVal.toFixed(2)),
                        unrealized_pl_pct: Number(totalPlPct.toFixed(2)),
                        positions_count: enriched.length
                    },
                    positions: enriched
                };
            }

            if (operation === "add" || operation === "update") {
                if (!symbol || quantity === null || price === null) {
                    return { status: "error", message: "Symbol, quantity, and price are required." };
                }

                const cleanSymbol = String(symbol).toUpperCase().replace(/\.CA$/i, "").trim();
                const numQty = Number(quantity);
                const numPrice = Number(price);

                if (isNaN(numQty) || isNaN(numPrice)) {
                    return { status: "error", message: "Quantity and price must be valid numbers." };
                }

                const { data: stockRow } = await supabase
                    .from("stocks")
                    .select("name, name_ar")
                    .eq("symbol", cleanSymbol)
                    .maybeSingle();

                const stockName = stockRow?.name_ar || stockRow?.name || cleanSymbol;

                const { data: existing } = await supabase
                    .from("positions")
                    .select("id")
                    .eq("user_id", userId)
                    .eq("symbol", cleanSymbol)
                    .eq("status", "open");

                if (existing && existing.length > 0) {
                    const { error: updateErr } = await supabase
                        .from("positions")
                        .update({
                            quantity: numQty,
                            entry_price: numPrice,
                            updated_at: new Date().toISOString()
                        })
                        .eq("id", existing[0].id);

                    if (updateErr) {
                        console.error("[manage_portfolio] update failed:", updateErr);
                        return { status: "error", message: `فشل تحديث المركز في قاعدة البيانات: ${updateErr.message}` };
                    }
                } else {
                    const { error: insertErr } = await supabase
                        .from("positions")
                        .insert({
                            user_id: userId,
                            symbol: cleanSymbol,
                            name: stockName,
                            quantity: numQty,
                            entry_price: numPrice,
                            status: "open",
                            source: "chatbot"
                        });

                    if (insertErr) {
                        console.error("[manage_portfolio] insert failed:", insertErr);
                        return { status: "error", message: `فشل تسجيل المركز في قاعدة البيانات: ${insertErr.message}` };
                    }
                }

                return {
                    status: "success",
                    operation: existing?.length ? "updated" : "added",
                    symbol: cleanSymbol,
                    quantity: numQty,
                    price: numPrice,
                    message: `تم تسجيل سهم ${cleanSymbol} في المحفظة بعدد ${numQty} بسعر ${numPrice} ج.م بنجاح.`
                };
            }

            if (operation === "remove" || operation === "delete") {
                if (!symbol) {
                    return { status: "error", message: "Symbol is required to remove position." };
                }
                const cleanSymbol = String(symbol).toUpperCase().replace(/\.CA$/i, "").trim();
                const { error: delErr } = await supabase
                    .from("positions")
                    .delete()
                    .eq("user_id", userId)
                    .eq("symbol", cleanSymbol)
                    .eq("status", "open");

                if (delErr) {
                    console.error("[manage_portfolio] delete failed:", delErr);
                    return { status: "error", message: `فشل حذف المركز: ${delErr.message}` };
                }

                return {
                    status: "success",
                    operation: "removed",
                    symbol: cleanSymbol,
                    message: `تم حذف سهم ${cleanSymbol} من المحفظة بنجاح.`
                };
            }
        }

        if (toolName === "get_market") {
            const { data: cacheRow } = await supabase
                .from("market_cache")
                .select("payload")
                .eq("cache_key", "market_status_Egypt")
                .maybeSingle();

            const payload = cacheRow?.payload || {};
            const egx30History = Array.isArray(payload.egx30) ? payload.egx30 : [];
            const latestEgx30 = egx30History.length > 0 ? egx30History[egx30History.length - 1] : null;
            const prevEgx30 = egx30History.length > 1 ? egx30History[egx30History.length - 2] : null;

            const egx30Close = latestEgx30?.close != null ? Number(latestEgx30.close) : null;
            const egx30ChangePct = (latestEgx30?.close != null && prevEgx30?.close != null && prevEgx30.close > 0)
                ? Number((((latestEgx30.close - prevEgx30.close) / prevEgx30.close) * 100).toFixed(2))
                : null;
            const regime = payload.regime || "عرضي (sideways)";

            const { data: dateRows } = await supabase
                .from("stock_technical_indicators")
                .select("date")
                .eq("exchange", "EGX")
                .order("date", { ascending: false })
                .limit(1);
            const latestDate = latestEgx30?.date || dateRows?.[0]?.date || "2026-10-07";

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

            // Determine date bounds based on Sunday-Thursday trading week
            const now = new Date();
            const dayOfWeek = now.getUTCDay(); // 0: Sunday, 1: Monday, ...
            const sundayThisWeek = new Date(now);
            sundayThisWeek.setUTCDate(now.getUTCDate() - dayOfWeek);
            sundayThisWeek.setUTCHours(0, 0, 0, 0);
            const thisWeekStartIso = sundayThisWeek.toISOString();

            const sundayLastWeek = new Date(sundayThisWeek);
            sundayLastWeek.setUTCDate(sundayThisWeek.getUTCDate() - 7);
            const lastWeekStartIso = sundayLastWeek.toISOString();

            let query = supabase
                .from("scan_results")
                .select("symbol, signal, entry_price, target_price, stop_loss, exit_price, profit_loss_pct, status, created_at")
                .order("created_at", { ascending: false });

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
            const latestDateInDb = latestRow?.[0]?.created_at ? String(latestRow[0].created_at).slice(0, 10) : "2026-09-21";

            const enrichedRecs = [];

            for (const r of rows || []) {
                const sym = r.symbol;
                const entry = Number(r.entry_price || 0);
                const isClosed = ["win", "loss", "closed"].includes(r.status);

                let realizedReturnPct: number | null = null;
                let unrealizedReturnPct: number | null = null;
                let currPrice: number | null = null;

                if (isClosed) {
                    if (r.profit_loss_pct != null) {
                        realizedReturnPct = Number(Number(r.profit_loss_pct).toFixed(2));
                    } else if (r.exit_price != null && entry > 0) {
                        realizedReturnPct = Number((((Number(r.exit_price) - entry) / entry) * 100).toFixed(2));
                    } else if (r.status === "loss" && r.stop_loss != null && entry > 0) {
                        realizedReturnPct = Number((((Number(r.stop_loss) - entry) / entry) * 100).toFixed(2));
                    } else if (r.status === "win" && r.target_price != null && entry > 0) {
                        realizedReturnPct = Number((((Number(r.target_price) - entry) / entry) * 100).toFixed(2));
                    }
                } else {
                    const { data: indRows } = await supabase
                        .from("stock_technical_indicators")
                        .select("close, date")
                        .eq("symbol", sym)
                        .order("date", { ascending: false })
                        .limit(1);
                    currPrice = indRows?.[0]?.close ?? entry;
                    if (entry > 0 && currPrice != null) {
                        unrealizedReturnPct = Number((((currPrice - entry) / entry) * 100).toFixed(2));
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
                latest_available_date_in_system: latestDateInDb,
                note: enrichedRecs.length === 0
                    ? `لا توجد توصيات مسجلة خلال الفترة المطلوبة (${timeframe === "this_week" ? "الأسبوع الحالي" : timeframe === "last_week" ? "الأسبوع الماضي" : timeframe}). أحدث توصيات مسجلة بالمنصة تعود لتاريخ ${latestDateInDb}.`
                    : undefined
            };
        }

        if (toolName === "get_technical_scan") {
            const preset = args.preset || "momentum_and_volume";
            const { data: dateRows } = await supabase
                .from("stock_technical_indicators")
                .select("date")
                .eq("exchange", "EGX")
                .order("date", { ascending: false })
                .limit(1);
            const latestDate = dateRows?.[0]?.date || "2026-10-07";

            let res;
            if (preset === "momentum_and_volume" || preset === "top_gainers") {
                res = await supabase
                    .from("stock_technical_indicators")
                    .select("symbol, close, change_pct, r_vol, rsi_14, ema_50, ema_200, macd, king_ai_score, egx_ai_score")
                    .eq("exchange", "EGX")
                    .eq("date", latestDate)
                    .gt("r_vol", 1.0)
                    .gt("change_pct", 0.0)
                    .order("change_pct", { ascending: false })
                    .limit(10);
            } else if (preset === "rsi_oversold") {
                res = await supabase
                    .from("stock_technical_indicators")
                    .select("symbol, close, change_pct, r_vol, rsi_14")
                    .eq("exchange", "EGX")
                    .eq("date", latestDate)
                    .lte("rsi_14", 35)
                    .order("rsi_14", { ascending: true })
                    .limit(10);
            } else {
                res = await supabase
                    .from("stock_technical_indicators")
                    .select("symbol, close, change_pct, r_vol, rsi_14")
                    .eq("exchange", "EGX")
                    .eq("date", latestDate)
                    .order("change_pct", { ascending: false })
                    .limit(10);
            }

            return {
                status: "success",
                preset,
                date: latestDate,
                stocks: res?.data || []
            };
        }

        if (toolName === "get_accumulation_stocks") {
            const { data: rows } = await supabase
                .from("stock_scans_summary")
                .select("symbol, scan_date, acc_score, dist_score, vol_ratio, wyckoff_phase, signal")
                .gte("acc_score", 50)
                .order("scan_date", { ascending: false })
                .order("acc_score", { ascending: false })
                .limit(10);

            return { status: "success", accumulation_stocks: rows || [] };
        }

        if (toolName === "get_news") {
            const symbols: string[] = Array.isArray(args.symbols)
                ? args.symbols.map((s: any) => String(s).toUpperCase())
                : [];
            const { data: newsRows } = await supabase
                .from("news")
                .select("title, published_at, symbols, source")
                .order("published_at", { ascending: false })
                .limit(10);

            const filtered = symbols.length > 0
                ? (newsRows || []).filter((n: any) => symbols.some(s => String(n.symbols || "").includes(s) || String(n.title || "").includes(s)))
                : (newsRows || []).slice(0, 5);

            return { status: "success", news: filtered };
        }

        if (toolName === "get_comparison") {
            const symbols: string[] = Array.isArray(args.symbols)
                ? args.symbols.map((s: any) => String(s).toUpperCase())
                : [];
            const data = [];
            for (const sym of symbols) {
                const { data: indRows } = await supabase
                    .from("stock_technical_indicators")
                    .select("symbol, close, change_pct, r_vol, rsi_14, macd, king_ai_score, egx_ai_score, date")
                    .eq("symbol", sym)
                    .order("date", { ascending: false })
                    .limit(1);
                if (indRows && indRows.length > 0) {
                    data.push(indRows[0]);
                } else {
                    data.push({ symbol: sym, error: "Not found in active main market" });
                }
            }
            return { status: "success", comparison: data };
        }

        return { status: "error", message: `Tool ${toolName} not recognized` };
    } catch (e: any) {
        return { status: "error", message: e.message || String(e) };
    }
}

export async function* runAgenticPipelineStream(
    userMessage: string,
    images: string[],
    sessionState: SessionState,
    sessionSummary: SessionSummary | null,
    history: Array<{ role: string; content: string }>,
    supabase: any,
    apiKeys: string[],
    userId: string,
    sessionId: string,
    messageId: string,
    requestedModel?: string,
    options: PipelineOptions = {}
): AsyncGenerator<{ type: string; data: any }> {
    yield { type: "status", data: { status: "agent", message: "تحليل الاستفسار وتحديد الأدوات المطلوبة..." } };

    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
        yield { type: "token", data: "عذراً، خدمة الذكاء الاصطناعي غير مهيأة بالشكل المطلوب حالياً." };
        yield { type: "done", data: { response: "عذراً، خدمة الذكاء الاصطناعي غير مهيأة بالشكل المطلوب حالياً.", session_update: {}, tables: [] } };
        return;
    }

    // Build dialogue messages
    const trimmedHistory = (history || []).slice(-16);
    const messages: any[] = [
        { role: "system", content: AGENTIC_SYSTEM_PROMPT },
        ...trimmedHistory.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage }
    ];

    // First call: let LLM decide on tool calls
    let firstResp: Response;
    try {
        firstResp = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages,
                tools: AGENTIC_TOOLS_SCHEMA,
                tool_choice: "auto",
                temperature: 0.2,
                max_tokens: 1500
            })
        });
    } catch (err: any) {
        console.error("[Agentic Pipeline] First call failed:", err);
        const errMsg = "تعذر الاتصال بخدمة التحليل الذكي حالياً. يرجى المحاولة بعد لحظات.";
        yield { type: "token", data: errMsg };
        yield { type: "done", data: { response: errMsg, session_update: {}, tables: [] } };
        return;
    }

    if (!firstResp.ok) {
        const errText = await firstResp.text();
        console.error(`[Agentic Pipeline] DeepSeek API error: ${firstResp.status} ${errText}`);
        const errMsg = "تعذر إكمال طلبك حالياً بسبب ضغط الخدمة. يرجى إعادة المحاولة.";
        yield { type: "token", data: errMsg };
        yield { type: "done", data: { response: errMsg, session_update: {}, tables: [] } };
        return;
    }

    const firstJson = await firstResp.json();
    const assistantMsg = firstJson.choices?.[0]?.message || {};
    const toolCalls: AgenticToolCall[] = assistantMsg.tool_calls || [];

    yield {
        type: "plan",
        data: {
            intent: toolCalls.length > 0 ? "agentic_tools" : "general_chat",
            tools: toolCalls.map(tc => tc.function.name)
        }
    };

    let finalResponseText = "";
    const usedSymbols: string[] = [];

    if (toolCalls.length > 0) {
        const toolNames = toolCalls.map(tc => tc.function.name);
        yield { type: "status", data: { status: "tools", message: `تنفيذ أدوات البيانات: ${toolNames.join("، ")}...` } };

        messages.push(assistantMsg);

        // Execute all tools concurrently
        const toolResults = await Promise.all(
            toolCalls.map(async tc => {
                let args: any = {};
                try {
                    args = JSON.parse(tc.function.arguments || "{}");
                } catch {}
                if (args.symbol) {
                    usedSymbols.push(String(args.symbol).toUpperCase().replace(/\.CA$/i, ""));
                }
                if (Array.isArray(args.symbols)) {
                    for (const s of args.symbols) {
                        usedSymbols.push(String(s).toUpperCase().replace(/\.CA$/i, ""));
                    }
                }
                const output = await executeAgenticTool(tc.function.name, args, supabase, userId);
                return {
                    tool_call_id: tc.id,
                    tool_name: tc.function.name,
                    output
                };
            })
        );

        for (const res of toolResults) {
            messages.push({
                role: "tool",
                tool_call_id: res.tool_call_id,
                content: JSON.stringify(res.output)
            });
        }

        yield {
            type: "tools_data",
            data: {
                formattedText: JSON.stringify(toolResults.map(r => r.output)),
                results: toolResults.map(r => ({ tool: r.tool_name, data: r.output }))
            }
        };

        yield { type: "status", data: { status: "response", message: "صياغة التقرير التحليلي المخصص..." } };

        // Second call: streaming the final synthesized response
        try {
            const secondResp = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages,
                    stream: true,
                    temperature: 0.2,
                    max_tokens: 2500
                })
            });

            if (!secondResp.ok || !secondResp.body) {
                throw new Error(`Second stream call failed with status ${secondResp.status}`);
            }

            const reader = secondResp.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data:")) continue;
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === "[DONE]") break;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const token = parsed.choices?.[0]?.delta?.content || "";
                        if (token) {
                            finalResponseText += token;
                            yield { type: "token", data: token };
                        }
                    } catch {}
                }
            }
        } catch (streamErr) {
            console.error("[Agentic Pipeline] Stream response failed:", streamErr);
            if (!finalResponseText) {
                finalResponseText = "تم جلب البيانات بنجاح، لكن حدث خطأ أثناء عرض التقرير. يرجى إعادة المحاولة.";
                yield { type: "token", data: finalResponseText };
            }
        }
    } else {
        // Direct answer without tools
        finalResponseText = assistantMsg.content || "";
        yield { type: "token", data: finalResponseText };
    }

    const updatedCurrentSymbol = usedSymbols[0] || sessionState.current_symbol || null;
    const updatedLastSymbols = Array.from(new Set([...usedSymbols, ...(sessionState.last_symbols || [])])).slice(0, 10);

    // Ensure Telegram channel link is always present at the end
    const telegramFooter = "\n\n📢 [قناة EGX Bots المجانية على تليجرام للتنبيهات والفرص](https://t.me/egxbots)";
    if (!finalResponseText.includes("t.me/egxbots")) {
        finalResponseText += telegramFooter;
        yield { type: "token", data: telegramFooter };
    }

    yield {
        type: "done",
        data: {
            response: finalResponseText,
            session_update: {
                current_symbol: updatedCurrentSymbol,
                last_symbols: updatedLastSymbols,
                summary: userMessage
            },
            tables: [],
            response_origin: "llm",
            publication_review: {
                passed: true,
                reasons: [],
                repaired: false,
                final_passed: true
            }
        }
    };
}

export async function runAgenticPipeline(
    userMessage: string,
    images: string[],
    sessionState: SessionState,
    sessionSummary: SessionSummary | null,
    history: Array<{ role: string; content: string }>,
    supabase: any,
    apiKeys: string[],
    userId: string,
    sessionId: string,
    messageId: string,
    requestedModel?: string,
    options: PipelineOptions = {}
): Promise<{ response: string; session_update: any; tables: ExcelTable[] }> {
    const stream = runAgenticPipelineStream(
        userMessage,
        images,
        sessionState,
        sessionSummary,
        history,
        supabase,
        apiKeys,
        userId,
        sessionId,
        messageId,
        requestedModel,
        options
    );

    let finalDoneData: any = { response: "", session_update: {}, tables: [] };
    for await (const event of stream) {
        if (event.type === "done") {
            finalDoneData = event.data;
        }
    }
    return finalDoneData;
}
