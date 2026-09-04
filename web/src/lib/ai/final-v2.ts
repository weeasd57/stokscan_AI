import { IntentPlan, VisionContext, ToolResult, FactSnapshot, SessionState } from "./types";
import { getSyncSymbolOfficialNameMap } from "./planner";
import { AI_CONFIG } from "./config";
import { getDeepSeekApiKey, getNvidiaApiKeys } from "./server-secrets";
import { describeDatedFallback, getFairValueFilters, getInvestorGuidanceIntent, isBestBuyStockQuestion, isDailyPriceLimitQuestion, isEarningsDataRequest, isFairValueScanRequest, isTermsDefinitionRequest, isUsageLimitQuestion } from "./intent-policy";
import { sanitizeReply } from "./sanitizer";
import { isOtcStock, buildOtcNotice } from "./otc-stocks";
import { buildComparisonMatrix } from "./comparison-matrix";

const MAX_CONTEXT_CHARS = 30000;



export function buildEvidenceEnginePromptBlock(toolResults: ToolResult[]): string {
    const stockResults = toolResults.filter(r => r.tool === "get_stock" && r.data?.symbol);
    const levelResults = toolResults.filter(r => r.tool === "get_stock_levels" && (r.data?.symbol || r.symbols?.[0]));
    const scanResults = toolResults.filter(r => r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks");
    
    if (stockResults.length === 0 && levelResults.length === 0 && scanResults.length === 0) {
        return "";
    }

    const symbolSet = new Set<string>();
    stockResults.forEach(r => { if (r.data?.symbol) symbolSet.add(String(r.data.symbol).toUpperCase()); });
    levelResults.forEach(r => {
        const sym = r.data?.symbol || r.symbols?.[0];
        if (sym) symbolSet.add(String(sym).toUpperCase());
    });
    scanResults.forEach(s => {
        const stocks = Array.isArray(s.data?.stocks) ? s.data.stocks : Array.isArray(s.data?.scan_rows) ? s.data.scan_rows : [];
        stocks.forEach((st: any) => {
            if (st.symbol) symbolSet.add(String(st.symbol).toUpperCase());
        });
        if (Array.isArray(s.symbols)) {
            s.symbols.forEach((sym: string) => symbolSet.add(String(sym).toUpperCase()));
        }
    });

    const symbolsToProcess = Array.from(symbolSet);
    if (symbolsToProcess.length === 0) {
        return "";
    }

    const lines: string[] = ["=== STRICT EVIDENCE CONTEXT (FACTS, DERIVED & AVAILABLE EVIDENCE) ==="];

    for (const sym of symbolsToProcess) {
        const stockData = stockResults.find(r => String(r.data?.symbol).toUpperCase() === sym)?.data;
        const lvlData = levelResults.find(l => String(l.data?.symbol || l.symbols?.[0] || "").toUpperCase() === sym)?.data;
        
        let scanStock: any = null;
        let scanDirection: string | null = null;
        for (const scan of scanResults) {
            const stocks = Array.isArray(scan.data?.stocks) ? scan.data.stocks : Array.isArray(scan.data?.scan_rows) ? scan.data.scan_rows : [];
            const found = stocks.find((st: any) => String(st.symbol).toUpperCase() === sym);
            if (found) {
                scanStock = found;
                scanDirection = scan.data?.direction || (scan.tool === "get_distribution_stocks" ? "distribution" : "accumulation");
                break;
            }
        }

        const otc = isOtcStock(sym);

        lines.push(`\n📌 STOCK: ${sym}`);
        lines.push(`FACTS:`);
        lines.push(`  - price: ${stockData?.price ?? stockData?.close ?? scanStock?.price ?? scanStock?.close ?? "NOT_PROVIDED"} ← [CURRENT PRICE — جنيه — use ONLY this as السعر الحالي]`);
        lines.push(`  - change_pct: ${stockData?.change_pct ?? scanStock?.change_pct ?? "NOT_PROVIDED"}`);
        lines.push(`  - rsi_14: ${stockData?.rsi_14 ?? scanStock?.rsi_14 ?? "NOT_PROVIDED"} ← [RSI مقياس 0-100 فقط — لا تقل RSI إلا بهذا الرقم]`);
        lines.push(`  - vol_ratio: ${stockData?.vol_ratio ?? scanStock?.vol_ratio ?? "NOT_PROVIDED"}`);
        lines.push(`  - macd: ${stockData?.macd ?? scanStock?.macd ?? "NOT_PROVIDED"} ← [MACD هذا ليس RSI — قيمته قد تكون صغيرة جداً أو سالبة]`);
        lines.push(`  - macd_signal: ${stockData?.macd_signal ?? scanStock?.macd_signal ?? "NOT_PROVIDED"}`);
        lines.push(`  - support: ${lvlData?.support ?? "NOT_PROVIDED"} ← [مستوى الدعم — ليس السعر الحالي]`);
        lines.push(`  - resistance: ${lvlData?.resistance ?? "NOT_PROVIDED"} ← [مستوى المقاومة — ليس السعر الحالي]`);
        lines.push(`  - king_ai_score: ${stockData?.king_ai_score ?? scanStock?.king_ai_score ?? "NOT_PROVIDED"} ← [تقييم نموذج KING للتعلم الآلي فنيًا من 0 إلى 1، مثلاً 0.583 تعني ثقة 58.3%]`);
        lines.push(`  - egx_ai_score: ${stockData?.egx_ai_score ?? scanStock?.egx_ai_score ?? "NOT_PROVIDED"} ← [تقييم نموذج EGX للتعلم الآلي فنيًا من 0 إلى 1، مثلاً 0.67 تعني ثقة 67.0%]`);
        const rec = stockData?.recommendation;
        if (rec) {
            lines.push(`  - platform_recommendation: ${rec.has_recommendation ? (rec.is_active ? `ACTIVE_OPEN (إشارة ${rec.signal}، سعر الدخول: ${rec.entry_price} ج.م، المستهدف: ${rec.target_price} ج.م، وقف الخسارة: ${rec.stop_loss} ج.م، صدرت: ${rec.duration}، العائد المحقق حتى الآن: ${rec.profit_loss_str})` : `PREVIOUS_CLOSED (الحالة: ${rec.status}، النتيجة: ${rec.outcome_desc}، صدرت: ${rec.duration}، العائد: ${rec.profit_loss_str})`) : "NONE (لا توجد توصيات سابقة أو حالية مسجلة لهذا السهم على المنصة)"}`);
        }


        lines.push(`DERIVED_FLAGS:`);
        lines.push(`  - otc_market_status: ${otc ? "OTC_MARKET (سهم خارج المقصورة / سوق الأوامر)" : "MAIN_MARKET"}`);
        const rsiVal = Number(stockData?.rsi_14 ?? scanStock?.rsi_14);
        if (Number.isFinite(rsiVal)) {
            lines.push(`  - rsi_status: ${rsiVal >= 70 ? "OVERBOUGHT (تشبع شرائي)" : rsiVal >= 50 ? "BULLISH_MOMENTUM (زخم صاعد)" : rsiVal <= 30 ? "OVERSOLD (تشبع بيعي)" : "NEUTRAL (محايد)"}`);
        } else {
            lines.push(`  - rsi_status: NOT_PROVIDED`);
        }
        const macdSig = stockData?.macd_signal ?? scanStock?.macd_signal;
        lines.push(`  - macd_signal_line_status: ${macdSig != null ? `PROVIDED (${macdSig})` : "UNKNOWN (do NOT state above/below signal line!)"}`);

        const kingConsensusVal = Number(stockData?.king_ai_score ?? scanStock?.king_ai_score);
        const egxConsensusVal = Number(stockData?.egx_ai_score ?? scanStock?.egx_ai_score);
        if (Number.isFinite(kingConsensusVal) && Number.isFinite(egxConsensusVal)) {
            const kingPct = kingConsensusVal * 100;
            const egxPct = egxConsensusVal * 100;
            const deltaPts = Math.abs(kingPct - egxPct);
            const sameDirection = (kingPct > 50 && egxPct > 50) || (kingPct < 50 && egxPct < 50);
            const agreementLabel = deltaPts >= 15 ? "اتفاق منخفض جداً" : sameDirection ? "اتفاق قوي" : "اتفاق ضعيف";
            const thresholdPhrase = deltaPts >= 15 ? "الفرق ≥ 15 نقطة" : "الفرق أقل من 15 نقطة";
            lines.push(`  - model_consensus: KING AI = ${kingPct.toFixed(2)}%, EGX AI = ${egxPct.toFixed(2)}%, الفرق = ${deltaPts.toFixed(2)} نقطة (${thresholdPhrase}) → ${agreementLabel} ← [قيمة محسوبة مسبقًا: استخدمها حرفيًا في قسم رأي النماذج ولا تعد حسابها ولا تعكس مقارنة الـ 15 نقطة]`);
        } else {
            lines.push(`  - model_consensus: NOT_PROVIDED (لا تذكر اتفاق النماذج)`);
        }

        lines.push(`AVAILABLE_EVIDENCE:`);
        if (scanStock) {
            lines.push(`  - wyckoff_phase: ${scanStock.wyckoff_phase ?? scanDirection ?? "NOT_PROVIDED"}`);
            lines.push(`  - accumulation_score (acc_score): ${scanStock.acc_score ?? "NOT_PROVIDED"} ← [هذا مؤشر تجميع 0-100 وليس سعر دعم أو مقاومة]`);
            lines.push(`  - distribution_score (dist_score): ${scanStock.dist_score ?? "NOT_PROVIDED"} ← [هذا مؤشر تصريف 0-100 وليس سعر]`);
            lines.push(`  - consecutive_days: ${scanStock.consecutive_acc_days ?? scanStock.consecutive_dist_days ?? "NOT_PROVIDED"} ← [هذا عدد أيام متتالية وليس سعر دعم أو مقاومة]`);
        } else {
            lines.push(`  - wyckoff_phase: NONE (No Wyckoff scan evidence present)`);
            lines.push(`  - accumulation_score: NONE`);
            lines.push(`  - distribution_signal: NONE (do NOT claim volume is distribution / سيولة توزيعية without dist_score)`);
        }
    }

    const matrixRes = buildComparisonMatrix(toolResults);
    if (matrixRes) {
        lines.push("\n" + matrixRes.formatted_prompt_block);
    }

    lines.push("\nSTRICT BOUNDARIES FOR MODEL:");
    lines.push("1. ⛔ NEVER claim 'فوق خط الإشارة' or 'تحت خط الإشارة' if macd_signal is NOT_PROVIDED or UNKNOWN.");
    lines.push("1b. ⛔ MACD > 0 (above the zero line) does NOT by itself mean a bullish signal. Without an explicit macd_signal value or a Histogram trend in the data, you MUST describe MACD as NEUTRAL (محايد). Never claim 'إشارة إيجابية', 'إيجابية فوق خط الصفر', 'تقاطع صاعد' or any bullish crossover based solely on MACD being positive. The ONLY valid MACD comparisons are: MACD vs the provided macd_signal line, or Histogram trend in the data — nothing else.");
    lines.push("2. ⛔ NEVER classify volume as 'سيولة توزيعية' or 'إشارة تصريح' unless distribution_score or wyckoff_phase is explicitly positive in AVAILABLE_EVIDENCE.");
    lines.push("2b. ⛔ INFERENCE BAN — SELLING PRESSURE: A high vol_ratio (e.g. 1.69x) alone NEVER implies 'ضغط بيعي', 'سيولة توزيعية', 'تصريح' or 'توزيع'. Selling-pressure language requires distribution_score > 0 OR wyckoff_phase == distribution/market in AVAILABLE_EVIDENCE. If neither is present, describe volume only as 'نشط' (active) and state the numeric ratio, with NO directional-selling inference.");
    lines.push("2c. ⛔ INFERENCE BAN — BUYING PRESSURE: A high vol_ratio alone NEVER implies 'ضغط شرائي', 'نشاط شرائي' or 'تجميع'. Buying-pressure language requires accumulation_score > 0 OR wyckoff_phase == accumulation/strong_accumulation in AVAILABLE_EVIDENCE. If neither is present, describe volume only as 'نشط' (active) and state the numeric ratio, with NO directional-buying inference.");
    lines.push("3. ⛔ NEVER classify volume as 'سيولة تجميعية' or 'إشارة تجميع' unless accumulation_score or wyckoff_phase is explicitly positive in AVAILABLE_EVIDENCE.");
    lines.push("4. ⛔ NEVER make implicit inferences or suggest directional momentum (e.g., 'ضغط بيعي', 'نشاط شرائي', 'جني أرباح') based purely on volume/RSI if the wyckoff_phase or direction is NOT_PROVIDED.");
    lines.push("5. ⛔ Only state facts and conclusions directly supported by the FACTS, DERIVED_FLAGS, and AVAILABLE_EVIDENCE above.");
    lines.push("6. 💡 If a stock is flagged as OTC_MARKET (سهم خارج المقصورة / سوق الأوامر) and missing live technical data, YOU MUST explicitly state that the stock trades OTC (خارج المقصورة / سوق الأوامر) which explains why daily automated technical data / support-resistance levels are unavailable.");
    lines.push("7. ⛔ NEVER use acc_score, dist_score, or consecutive_days as price levels. These are DIMENSIONLESS SCORES (0-100) or DAY COUNTS. The ONLY valid price levels are: price, support, resistance, sma_50, sma_200, bb_upper, bb_lower from FACTS above.");
    lines.push("8. ⛔ When presented with get_accumulation_stocks or get_distribution_stocks: ALL stocks listed under get_accumulation_stocks are ACCUMULATION stocks (درجة تجميع عالية). NEVER label any stock from get_accumulation_stocks as 'تصريف' or 'توزيع'. If get_distribution_stocks reports no stocks found, explicitly write that no distribution stocks were detected in today's scan.");
    lines.push("9. ⛔ CRITICAL: If the distribution scan result shows stocks=[] or says 'لا توجد أسهم تصريف', you MUST NOT mention ANY stock as having 'تصريف', 'سيولة توزيعية', 'ضغط بيعي', or 'مرحلة تصريف'. Just say: 'لا توجد أسهم توزيع واضحة في المسح الحالي'. Same rule applies to accumulation: if accumulation scan is empty, do not invent accumulation stocks.");
    lines.push("10. ⛔ تحذير قوة الإشارة RSI: كلمة 'آمن' أو 'قوي' أو 'إيجابية واضحة' للزخم لا تنطبق على RSI بين 40-70. RSI في المنطقة 40-70 هو 'محايد' أو 'يميل للإيجابية/السلبية' فقط. لا تقل أبداً 'منطقة زخم صاعد إيجابي وآمن'، 'آمن تماماً'، أو 'إشارة قوية' إذا كان RSI بين 40 و 70. استخدم بدلاً منها: 'زخم محايد يميل للإيجابية' أو 'محايد بنسبة RSI X'.");
    lines.push("11. 📝 هيكل الرد الإلزامي للمقارنات (MANDATORY COMPARISON LAYOUT): عندما يطلب المستخدم مقارنة أسهم، يجب الالتزام بهذا الترتيب الصارم: 1. النظرة العامة، 2. التحليل الفني لكل سهم، 3. مصفوفة القرار (Decision Matrix) في جدول (يحتوي: السهم | جودة الاتجاه | زخم | سيولة | مخاطرة الدخول | القرار)، 4. الرأي الإحصائي للذكاء الاصطناعي (ML Scores & Consensus)، 5. الخلاصة وشروط الدخول الثابتة والخاتمة التوجيهية (Decision Conclusion).");
    lines.push("12. 📏 عتبات المؤشرات الثابتة (STRICT THRESHOLDS): للـ ADX (أقل 20=ضعيف، 20-25=بداية، 25-40=قوي، >40=مفرط/قوي جداً). للـ RSI (>70=تشبع شرائي ومخاطرة عالية ولا تطارد السهم، <30=تشبع بيعي، 40-70=محايد). للـ vol_ratio (<0.8x=سيولة ضعيفة، ~1.0x=متوسطة، >1.5x=انفجار). لا تنصح بالدخول إذا كانت السيولة ضعيفة.");
    lines.push("13. 🎯 شروط الدخول (ACTIONABLE CONDITIONS): لا تكتفي بـ 'للمراقبة'. قدم دائماً شروطاً تنفيذية: ماذا يجب أن يحدث لكي نشتري؟ (مثال: 'الدخول يصبح جذاباً إذا عاد الحجم فوق 1.0x اخترق X، بينما كسر الدعم Y يلغي السيناريو').");
    lines.push("14. 🤖 الرأي الإحصائي والرياضيات (ML MODELS & MATH): استخدم دائماً القيم المجهزة مسبقاً في ML STATISTICAL DELTAS أعلاه. لا تخترع فوارق حسابية من عندك.");
    lines.push("15. ⛔ سلامة ومطابقة الرموز والبيانات (SYMBOL & DATA INTEGRITY): يجب عليك فقط كتابة وتحليل الأسهم الموجودة صراحة في STRICT EVIDENCE CONTEXT أعلاه. يمنع منعاً باتاً استبدال أو خلط رموز الأسهم ببعضها البعض، ويجب ربط بيانات كل سهم (السعر، التغير، RSI، حجم التداول، إلخ) برمزها الصحيح بدقة بالغة دون أي تبديل أو خلط، مع الامتناع التام عن ذكر أو مناقشة أي أسهم غير متواجدة في البيانات المرفقة.");
    lines.push("16. 📊 قوالب الماسح الفني (TECHNICAL SCREENER TEMPLATES): عند وجود نتائج get_technical_scan، اعرض الأسهم المرصودة مع أسمائها، أسعارها، ونسب التغير والمؤشرات ذات الصلة (مثل RSI، MACD، حجم التداول النسبي، أو إشارات الدايفرجنس). وضح للمستخدم طبيعة الفلتر الفني ومعناه الاستثماري دون تقديم نصيحة شراء مباشرة.");

    lines.push("=== END STRICT EVIDENCE CONTEXT ===");
    return lines.join("\n");
}

export function buildV2FinalMessages(

    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number },
    sessionState?: SessionState | null,
    correctionPrompt?: string
): { role: string; content: any }[] {
    const sections: string[] = [];
    const guidanceIntent = plan.guidance_intent;

    if (sessionState && (sessionState.investment_budget || sessionState.investment_horizon || sessionState.risk_tolerance || sessionState.preferred_sectors?.length)) {
        sections.push("=== INVESTOR PROFILE & SESSION CONTEXT ===");
        if (sessionState.investment_budget) {
            sections.push(`- الميزانية المتاحة للمستثمر: ${sessionState.investment_budget.toLocaleString("ar-EG")} جنيه مصري`);
        }
        if (sessionState.investment_horizon) {
            const hMap: Record<string, string> = { short_term: "مضاربة / قصير الأجل (عدة أيام لأسبوع)", medium_term: "استثمار متوسط الأجل (عدة أشهُر حتى نهاية السنة)", long_term: "استثمار طويل الأجل (سنة فأكثر)" };
            sections.push(`- أفق الاستثمار المطلوب: ${hMap[sessionState.investment_horizon] || sessionState.investment_horizon}`);
        }
        if (sessionState.risk_tolerance) {
            const rMap: Record<string, string> = { low: "مخاطرة منخفضة / محافظ على رأس المال", medium: "مخاطرة متوازنة / معتدلة", high: "مخاطرة مرتفعة / مضاربة جريئة" };
            sections.push(`- مستوى تحمل المخاطرة: ${rMap[sessionState.risk_tolerance] || sessionState.risk_tolerance}`);
        }
        if (sessionState.preferred_sectors?.length) {
            sections.push(`- القطاعات المفضلة لدى المستثمر: ${sessionState.preferred_sectors.join("، ")}`);
        }
    }

    sections.push("=== INTENT PLAN ===");
    sections.push(JSON.stringify({
        intent: plan.intent,
        guidance_intent: (function() {
            const gMap: Record<string, string> = {
                onboarding: "بدء البورصة للمستثمر المبتدئ",
                allocation: "توزيع رأس المال وإدارة المحفظة",
                product_comparison: "المقارنة بين أدوات الاستثمار والأسهم",
                product_explainer: "شرح منتجات الدخل الثابت والأدوات الادخارية",
                terms_explainer: "شرح وتوضيح المصطلحات والمفاهيم المالية"
            };
            return guidanceIntent ? (gMap[guidanceIntent] || guidanceIntent) : guidanceIntent;
        })(),
        confidence: plan.confidence,
        entities: plan.entities,
        needs_live_data: plan.needs_live_data,
        needs_historical_data: plan.needs_historical_data
    }, null, 2));

    if (guidanceIntent) {
        const guidanceRules: Record<string, string> = {
            onboarding: "المستخدم يسأل عن كيفية بدء الاستثمار أو تخصيص مبلغ استثماري جديد (مثل 10 آلاف أو 50 ألف). أرحب به بلغة عربية مصريّة ودودة ومبسطة جداً، واطرح خطة استرشادية تعليمية متدرجة (تحديد أفق الاستثمار، الاحتفاظ بصندوق طوارئ، ثم تقسيم الشراء على دفعات)، واختم بسؤال تفاعلي واحد ومباشر عن مدى تحمله للمخاطر للبدء في تحليل بعض الأسهم الشائعة في البورصة المصرية.",
            allocation: "المستخدم يطلب توزيع مبلغ أو سيولة استثمارية محددة (مثل نصف مليون أو 500 ألف) حتى لو اشترط أسهم تجميع أو هدفاً زمنياً. لا تحوّل الإشارات أو البيانات التاريخية إلى توصية شخصية أو وعد بمكسب، قدم له إطاراً استرشادياً تعليمياً بالعامية المصرية المبسطة (تحديد مدة الاستثمار، التوعية بالمخاطر، وتقسيم الشراء على دفعات متدرجة بدلاً من الدخول دفعة واحدة)، واسأله عن أفق الاستثمار ومستوى تحمله للمخاطر لتحديد أفضل القطاعات المناسبة.",
            product_comparison: "المستخدم يقارن منتجاً ادخارياً أو دفاعياً بسهم. وضّح أنهما فئتان مختلفتان ولا تقارن بينهما بسعر السهم أو RSI؛ قارن الهدف والسيولة والمخاطر والأفق الزمني والرسوم، واطلب اسم المنتج الكامل عند الحاجة.",
            product_explainer: "المستخدم يسأل عن منتج ادخاري أو دخل ثابت. اشرح كيف يقيّمه من مصدره الرسمي: العائد المعلن أو المتغير، السيولة، الرسوم، المخاطر، وشروط الاسترداد. لا تفترض ضماناً أو عائداً غير موجود في السياق.",
            terms_explainer: "المستخدم يطلب شرحاً أو تعريفاً لمصطلحات ومفاهيم مالية أو فنية في البورصة. قم بشرح كافة المصطلحات المطلوبة بلغة عربية مصريّة ودودة ومبسطة جداً بدون تعقيد، مع إعطاء مثال عملي بسيط لتقريب المعنى، واختم بسؤال تفاعلي ودود للبدء في تطبيق المفاهيم على أي سهم يفضله المستخدم."
        };
        sections.push("=== RESPONSE MODE: INVESTOR EDUCATION ===\n" + guidanceRules[guidanceIntent]);
    }

    const officialNameMap = getSyncSymbolOfficialNameMap();
    const allowedSymbols = Array.from(new Set([
        ...toolResults.flatMap(result => result.symbols || []),
        ...(visionContext?.symbols || []).map(symbol => symbol.symbol)
    ])).filter(Boolean);
    if (allowedSymbols.length > 0) {
        sections.push("=== ALLOWED SYMBOLS & OFFICIAL NAMES ===");
        allowedSymbols.forEach(sym => {
            const symUpper = sym.toUpperCase();
            const info = officialNameMap[symUpper];
            const nameAr = info?.name_ar ? ` (${info.name_ar})` : "";
            const nameEn = info?.name_en ? ` - ${info.name_en}` : "";
            sections.push(`- ${symUpper}${nameAr}${nameEn}`);
        });
        sections.push("⚠️ MANDATORY NAME ACCURACY RULE: You MUST use the EXACT official Arabic stock name listed above for each symbol code. NEVER follow the user's Arabic name for a symbol if it contradicts the official name listed here. If the user called INFI 'إيبيكو' but the official name is 'إسماعيلية الوطنية للأغذية', correct it silently and use the official name. NEVER guess, assume, or invent company names based on ticker letters. The official name in this section ALWAYS overrides what the user wrote.");
    }

    if (visionContext) {
        sections.push("=== IMAGE ANALYSIS ===");
        sections.push(JSON.stringify({
            image_type: visionContext.image_type,
            symbols: visionContext.symbols.map(s => `${s.symbol}: ${JSON.stringify(s.visible_values)}`),
            technical_observations: visionContext.technical_observations,
            market_depth: visionContext.market_depth,
            summary: visionContext.user_relevant_summary,
            confidence: visionContext.confidence
        }, null, 2));
    }

    // Recent history is no longer injected into sections; it's passed as actual chat messages below.

    if (resolvedReference.symbol) {
        sections.push("=== RESOLVED REFERENCE ===");
        sections.push(`المرجع "${userMessage.match(/ده|دا|دي|هذا/)?.[0] || "السابق"}" يشير إلى: ${resolvedReference.symbol} (ثقة: ${Math.round(resolvedReference.confidence * 100)}%)`);
    }

    const memoryAllowed = plan.needs_historical_data || Boolean(resolvedReference.symbol);
    const scopedFacts = memoryAllowed ? relevantFacts : [];
    const imageDerivedFacts = scopedFacts.filter(f => f.data_type === "image-derived");
    const liveMemoryFacts = scopedFacts.filter(f => f.data_type === "live");
    const historicalFacts = scopedFacts.filter(f => f.data_type === "historical");

    const formatFactValue = (val: unknown): string => {
        if (val === null || val === undefined) return "N/A";
        if (typeof val === "object") {
            try {
                return JSON.stringify(val);
            } catch {
                return String(val);
            }
        }
        return String(val);
    };

    if (imageDerivedFacts.length > 0) {
        sections.push("=== IMAGE-DERIVED MEMORY ===");
        imageDerivedFacts.forEach(f => {
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${formatFactValue(val)}`);
            }
        });
    }

    if (liveMemoryFacts.length > 0) {
        sections.push("=== LIVE DATA MEMORY ===");
        liveMemoryFacts.forEach(f => {
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${formatFactValue(val)}`);
            }
        });
    }

    if (historicalFacts.length > 0) {
        sections.push("=== HISTORICAL DATA ===");
        historicalFacts.forEach(f => {
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${formatFactValue(val)}`);
            }
        });
    }

    if (toolResults.length > 0) {
        const validResults = toolResults.filter(r => r.source !== "empty" && r.data !== null && !(r.tool === "search_web" && Array.isArray((r.data as any)?.results) && (r.data as any).results.length === 0));
        const liveResults = validResults.filter(r => r.data_type !== "historical");
        const historicalResults = validResults.filter(r => r.data_type === "historical");

        if (liveResults.length > 0) {
            sections.push("=== LIVE DATA ===");
            liveResults.forEach(r => {
                sections.push(`الأداة: ${r.tool} | المصدر: ${r.source} | الوقت: ${r.data_time} | نوع: ${r.data_type}`);
                if (typeof r.data === "object" && r.data !== null) {
                    if (r.tool === "get_technical_scan" && Array.isArray(r.data.stocks)) {
                        sections.push("  stocks_table (You MUST output this exact Markdown table structure to the user under a suitable heading. Do not convert it to lists or paragraphs):");
                        sections.push("  | # | السهم | الاسم | السعر | التغير | RSI | حجم نسبي | تفاصيل فنية أخرى |");
                        sections.push("  |---|---|---|---|---|---|---|---|");
                        r.data.stocks.forEach((s: any, idx: number) => {
                            const changeStr = Number(s.change_pct) >= 0 ? `+${s.change_pct}%` : `${s.change_pct}%`;
                            const extra = [];
                            if (s.ema_50 && s.ema_50 !== "N/A") extra.push(`EMA 50: ${s.ema_50}`);
                            if (s.ema_200 && s.ema_200 !== "N/A") extra.push(`EMA 200: ${s.ema_200}`);
                            if (s.divergence_summary) extra.push(s.divergence_summary);
                            const detailText = extra.length > 0 ? extra.join(" ، ") : "-";
                            sections.push(`  | ${idx + 1} | **${s.symbol}** | ${s.name || s.symbol} | ${s.close} ج.م | ${changeStr} | ${s.rsi || "N/A"} | ${s.r_vol || "1.00"}x | ${detailText} |`);
                        });
                        for (const [key, val] of Object.entries(r.data)) {
                            if (key !== "stocks") {
                                sections.push(`  ${key}: ${formatFactValue(val)}`);
                            }
                        }
                    } else {
                        for (const [key, val] of Object.entries(r.data)) {
                            sections.push(`  ${key}: ${formatFactValue(val)}`);
                        }
                    }
                }
            });
        }

        if (historicalResults.length > 0) {
            sections.push("=== HISTORICAL DATA ===");
            historicalResults.forEach(r => {
                sections.push(`الأداة: ${r.tool} | المصدر: ${r.source} | الوقت: ${r.data_time} | نوع: ${r.data_type}`);
                if (r.tool === "get_recommendations" && Array.isArray(r.data)) {
                    sections.push("  recommendations_data (Use this strictly for qualitative performance analysis; DO NOT output raw table rows into the text response as the interactive Excel table is already rendered above your answer):");
                    r.data.forEach((rec: any, idx: number) => {
                        const retSign = rec.return_pct != null ? `${rec.return_pct >= 0 ? "+" : ""}${Number(rec.return_pct).toFixed(2)}%` : "-";
                        sections.push(`  - [${rec.symbol} - ${rec.name || rec.symbol}]: إشارة=${rec.signal || "BUY"} | حالة=${rec.status_label || rec.status} | دخول=${rec.entry_price} ج.م | هدف=${rec.target_price} ج.م | وقف=${rec.stop_loss} ج.م | عائد=${retSign} | مدة=${rec.duration || rec.created_at}`);
                    });
                } else if (typeof r.data === "object" && r.data !== null) {
                    for (const [key, val] of Object.entries(r.data)) {
                        sections.push(`  ${key}: ${formatFactValue(val)}`);
                    }
                }
            });
        }
    }

    const webSearchResults = toolResults.filter(result =>
        result.tool === "search_web" && Array.isArray(result.data?.results) && result.data.results.length > 0
    );
    if (webSearchResults.length > 0) {
        sections.push("=== VERIFIED WEB SEARCH RESULTS ===");
        sections.push("هذه نتائج بحث حي جلبها النظام الآن. استخدمها فقط للإجابة عن الطلب الحالي، ولا تعتبر مقتطفات البحث حقيقة مؤكدة إذا لم تدعمها بوضوح. أشر إلى المصادر داخل النص بصيغة [1] و[2] فقط.");
        let sourceNumber = 0;
        for (const result of webSearchResults) {
            for (const item of result.data.results.slice(0, 8)) {
                sourceNumber += 1;
                sections.push(`[${sourceNumber}] ${item.title}\nالموقع: ${item.domain}\nالرابط: ${item.url}\nالمقتطف: ${item.snippet || "لا يوجد مقتطف"}`);
            }
        }
    }

    sections.push("=== RESPONSE RULES ===");
    sections.push("- استخدم طلب المستخدم الحالي كأولوية أولى");
    sections.push("- استخدم نية الـ planner كأولوية ثانية");
    sections.push("- اكتب كخبير يتحدث مع المستخدم: ابدأ بالنتيجة، ثم اذكر الدليل الأقوى، ثم وضّح ما لا يمكن الجزم به.");
    sections.push("- عندما يسأل المستخدم سؤالاً عاماً أو مقارنة عن أفضل أسهم للشراء (مثل: مين أدخله بكرة، أشتري إيه، أفضل سهم للشراء):");
    sections.push("  1. ابدأ بالمقارنة الفعلية من البيانات المتاحة، بصياغة محادثية لا تشبه تقريراً آلياً.");
    sections.push("  2. قارن الأسهم المتاحة وحدد الأقوى نسبياً مع ذكر سبب أو سببين فقط.");
    sections.push("  3. لا تحوّل المقارنة إلى أمر شراء أو بيع، ولا تضف نصائح لا يطلبها المستخدم.");
    sections.push("- استخدم بيانات الصورة فقط إذا كانت موجودة في === IMAGE ANALYSIS ===");
    sections.push("- استخدم نتائج الأدوات الحالية من === LIVE DATA ===");
    sections.push("- إذا وُجد قسم === VERIFIED WEB SEARCH RESULTS ===، لخّص المعلومات الواردة فيه بأسلوب محادثة طبيعي، واربط كل معلومة خارجية بالمصدر المناسب [رقم].");
    sections.push("- لا تقل إنك بحثت أو تنسب معلومة لمصدر لم يظهر حرفياً في نتائج البحث الموثقة.");
    sections.push("- استخدم البيانات التاريخية من === HISTORICAL DATA ===");
    sections.push("- لا تخترع أرقاماً غير موجودة في الأقسام أعلاه");
    sections.push("- لا تعطِ توصيات شراء أو بيع صريحة");
    sections.push("- اذكر مصدر كل رقم (صورة، بيانات حية، بيانات تاريخية)");
    sections.push("- إذا كان مستوى الدعم أو المقاومة المحسوب في === LIVE DATA === بعيداً جداً عن السعر الحالي (بمسافة تزيد عن 40%)، نبّه العميل بوضوح أن هذا المستوى بعيد جداً ولا يعتبر نقطة مرجعية موثوقة أو عمليّة للتداول قصير المدى ولا يُنصح بالاعتماد عليه.");
    sections.push("- اكتب بعربية واضحة وطبيعية، ويمكن استخدام تعبير مصري خفيف إذا كان مناسباً لأسلوب المستخدم.");
    sections.push("- تحليل السيولة المصاحب: اشرح RSI و MACD ونسبة السيولة من البيانات إن وجدت");
    sections.push("- لا تنشئ جدول Markdown من نفسك؛ سيضيف النظام الجدول المنظم المستخرج من البيانات بعد ردك");
    sections.push("- لا تذكر أو تسرد أي رمز أو اسم شركة غير موجود في مصادر البيانات والجداول أعلاه");
    sections.push("- لا تعيد سرد قوائم الأسهم في النص؛ اشرح الاتجاهات فقط واترك القائمة للجدول المنظم");
    sections.push("- عندما يسأل المستخدم عن سبب هبوط أو صعود أو حركة سهم معين (مثل: ما سبب هبوط/صعود... أو ليه نزل/طلع...):");
    sections.push("  1. إذا كانت هناك أخبار في === LIVE DATA ===، اشرح العوامل والأخبار المرتبطة بالسهم أولاً.");
    sections.push("  2. قدم تحليلاً فنياً ومالياً مفسراً لسبب الحركة (مثل: عمليات جني أرباح فنية طبيعية بعد وصول مؤشر RSI لمناطق تشبع شرائي مرتفعة، أو ضعف السيولة وانخفاض التداول عن المتوسط، أو اختبار مستويات مقاومة وتراجع السعر منها، أو حركات تصحيحية في المسار الصاعد).");
    sections.push("- الأحداث المالية المؤثرة (أداة get_corporate_actions في === LIVE DATA ===):");
    sections.push("  1. إذا وُجدت أحداث مالية للسهم (حقوق اكتتاب، توزيعات أرباح، تجزئة، أسهم مجانية، زيادة/تخفيض رأس المال، استحواذ)، اذكرها صراحة عند تحليل السهم لأنها تؤثر مباشرة على السعر والسيولة.");
    sections.push("  2. اربط الحدث بأثره المتوقع: حقوق الاكتتاب تمتص السيولة وقد تضغط على السعر مؤقتاً، التوزيعات والأسهم المجانية تجذب السيولة قبل موعدها، التجزئة/تخفيض القيمة الاسمية يغيران السعر الاسمي دون تغيير القيمة السوقية للشركة.");
    sections.push("  3. الأحداث التي جاءت من البحث الحي (origin أو source يشير لموقع ويب) يجب ذكر مصدرها (اسم الموقع) عند سردها، ولا يجوز إضافة تفاصيل أو أرقام غير موجودة في البيانات.");
    sections.push("  4. إذا لم توجد أحداث مالية مسجلة للسهم، لا تفترض وجود اكتتاب أو توزيعات أو تجزئة من عندك — قل إنه لا توجد أحداث مسجلة.");
    sections.push("- عندما يسأل المستخدم عن القيمة العادلة أو التقييم لسهم معين (مثل: ما القيمة العادلة لسهم...):");
    sections.push("  1. قدّم تحليلاً شاملاً مستنداً إلى البيانات المتاحة (السعر الحالي، القيمة السوقية، ومستويات الدعم والمقاومة الحسابية).");
    sections.push("  2. وضح نطاق الحركة السعرية ومستويات القيمة العادلة الفنية بين الدعم والمقاومة والقيمة السوقية للشركة.");
    sections.push("  3. اجعل الإجابة مفسرة ومباشرة ترضي استفسار العميل.");
    sections.push("- عندما يسأل المستخدم عن مستويات التصحيح أو الدعم (مثل: 'تصحيح لحد كام', 'الدعم فين', 'ممكن ينزل لكام', 'مستهدفات الهبوط'):");
    sections.push("  1. أجب بشكل مباشر ومحدد بذكر مستويات الدعم الفنية المحسوبة من البيانات والمتوسطات المتحركة (SMA50, SMA200) كنقاط ارتداد ومستويات متوقعة للتصحيح.");
    sections.push("  2. اذكر أرقام الدعم بوضوح ووضح المسافة المئوية بينها وبين السعر الحالي دون إعادة سرد نفس الفقرات السابقة.");
    sections.push("- عندما يسأل المستخدم عن قرار البيع أو الشراء أو الاحتفاظ بسهم معين، أو 'اشتري مين بكره' أو 'أفضلهم للشراء' (مقارنة أو سهم مفرد):");
    sections.push("  1. أجب مباشرة وبموجز شديد (3-4 أسطر فقط) محدداً السهم الأفضل فنياً مقارنة بالآخرين بناءً على المؤشرات الفعلية المتوفرة.");
    sections.push("  2. يمنع منعاً باتاً كتابة عناوين أو أقسام فرعية مثل 'إدارة المخاطر' أو 'سيناريو الارتداد' أو نصائح عامة عن السيولة.");
    sections.push("  3. قارن فقط بين الأسعار الحالية ومستويات الدعم والمقاومة، ووضح السهم الأقرب للدعم أو ذو الزخم الإيجابي الأقوى مباشرة.");
    sections.push("  • مؤشر التجميع (acc_score / Accumulation): يجب ترجمته بـ 'تجميع' أو 'درجة تجميع' ويُمنع تماماً استخدام كلمة 'توزيع' أو 'تصريف' لوصفه.");
    sections.push("  • مؤشر التصريف (dist_score / Distribution): يجب ترجمته بـ 'تصريف' أو 'درجة تصريف' ويُمنع تماماً استخدام كلمة 'توزيع' أو 'تجميع' لوصفه.");
    sections.push("  • 🚫 قاعدة صارمة لمنع خلط acc_score مع dist_score: عند ذكر درجة التجميع والتصريف، يجب دائماً ذكر القيمتين معاً بوضوح: 'درجة التجميع (acc_score): X' و'درجة التصريف (dist_score): Y'. يمنع تماماً كتابة 'تجميع بدرجة X' إذا كان X هو قيمة dist_score وليس acc_score. مثال: إذا كان acc_score=80.3 و dist_score=0، يجب الكتابة: 'درجة التجميع 80.3 ودرجة التصريف 0' وليس 'تجميع بدرجة 0'.");
    sections.push("  • 🚫 قاعدة صارمة: يُمنع تماماً استخدام RSI لتحديد مرحلة التجميع أو التصريف (Wyckoff). RSI هو مؤشر زخم سعري فقط، وليس مقياساً للتجميع/التصريف المؤسسي. لا تقل أبداً 'السهم في مرحلة تصريف لأن RSI مرتفع' أو 'السهم في مرحلة تجميع لأن RSI منخفض'. مرحلة Wyckoff تُحدَّد حصرياً من حقل wyckoff_phase في بيانات get_accumulation_stocks/get_distribution_stocks.");
    sections.push("  • 🚫 قاعدة عدم التناقض بين RSI وWyckoff: عندما تجد بيانات Wyckoff تُظهر مرحلة تجميع (accumulation/strong_accumulation) لسهم ما، وفي نفس الوقت RSI مرتفع (≥70)، هذا ليس تناقضاً — يمكن أن يكون السهم في مرحلة تجميع مع RSI مرتفع. اشرح كلا المؤشرين منفصلاً: 'مسح Wyckoff يُظهر مرحلة تجميع قوي بدرجة X (بتاريخ كذا)، بينما RSI اللحظي يبلغ Y مما يُشير إلى منطقة تشبع شرائي على المدى القصير.' لا تجعل أحدهما يلغي الآخر.");
    sections.push("  • مؤشر RSI: النسبة بين 50 و 69 (مثل 64) تعني 'منطقة إيجابية محايدة/صاعدة' وليست 'تشبع شرائي'؛ التشبع الشرائي (Overbought) يبدأ حصرياً من 70 فأعلى.");
    sections.push("  • تقريب الأرقام السعرية ومستويات الدعم والمقاومة إلى رقمين عشريين دائماً (مثال: 0.43 جنيه وليس 0.428684 جنيه).");
    sections.push("  • يمنع تماماً تكرار الجمل التمهيدية (مثل: حسناً دعونا نبدأ... حسناً دعونا نبدأ) أو تكرار الفقرات ذات المعنى المماثل في الرد.");
    sections.push("  • يمنع منعاً باتاً تكرار العبارات الانتقالية المتماثلة مثل (من ناحية أخرى، يظهر أن) أو سرد الجمل بصيغ متكررة؛ اكتب بلغة عربية سلسلة ومتنوعة ومترابطة.");
    sections.push("  • يمنع منعاً باتاً استخدام مقدمات أو أسلوب المقالات أو المدونات (مثل: 'مرحباً بكم في هذا المقال' أو 'سنتحدث اليوم عن'). ابدأ مباشرة بالتحليل والإجابة عن سؤال العميل بأسلوب مساعد مالي ذكي ومباشر.");
    sections.push("  • لا تشرح المفاهيم العامة للمؤشرات الفنية (مثل شرح ما هو RSI أو ما هو MACD) بل طبّق الأرقام مباشرة لوصف حالة السهم الحالية، إلا إذا طلب المستخدم تعريفها صراحة.");
    sections.push("  • نسبة الحجم (Volume Ratio / vol_ratio): إذا كانت أقل من 1.0x (مثل 0.53x) فهذا يعني أن 'التداول والسيولة ضعيفة/أقل من المتوسط'، ويُمنع تماماً وصفها بأنها قوية. لا تعتبر السيولة قوية إلا إذا كانت نسبة الحجم أكبر من 1.5x.");
    sections.push("  • مؤشر MACD: القيمة الرقمية المجردة القريبة من الص الصفر (مثل 0.0089) لا تعني 'إشارات صاعدة' بمفردها؛ صف حركة السهم بناءً على تقاطعه مع خط الإشارة أو اتجاه الـ Histogram إن وجد في البيانات، وإلا اعتبره محايداً.");
    sections.push("  • عندما يسأل المستخدم 'في أي منطقة' أو 'منطقة إيه حالياً' أو عن موقع السعر مقارنة بالدعم والمقاومة لأسهم معينة:");
    sections.push("    1. استخدم قيم الحقول المحسوبة الجاهزة في === LIVE DATA === (مثل: price_vs_support, distance_from_support_pct, trading_zone, position_pct) لوصف موقع السعر بدقة.");
    sections.push("    2. يمنع تماماً مقارنة الأرقام يدوياً من قبلك لتفادي أخطاء الحساب اللغوي؛ اعتمد 100% على الحقل trading_zone و price_vs_support المكتوب في البيانات لتصنيف النطاق الفني.");
    sections.push("  • 🚫 قاعدة مصفوفة القرار (Decision Matrix) — للاستعلامات مقارنة أسهم (2 سهم فأكثر): عند مقارنة أسهم، يجب عليك بناء **مصفوفة قرار** تلقائية تلقائياً من البيانات المقدرة، تتكوّن من البندات التالية لكل سهم:");
    sections.push("    - التقنية (Technical): RSI، MACD (مقابل خط الإشارة إن وجد)، الاتجاه، مستويات الدعم/المقاومة، Bollinger Bands.");
    sections.push("    - السيولة (Liquidity): vol_ratio، عدد الأيام المتداولة، wyckoff_phase.");
    sections.push("    - التعلم الآلي (ML): KING AI score، EGX AI score (مع الفرق النقطي الدقيق بين الأسهم).");
    sections.push("    - المخاطر (Risk): مسافة السعر من أقرب مستوى دعم/مقاومة، إشارات توزيع/تجميع المتاحة.");
    sections.push("    - الثقة النهائية (Final Confidence): مجموع البندات الموجبة.");
    sections.push("    ثم اجمعها في عمود 'النتيجة النهائية' وقلّلها إلى فئات: STRONG BUY (قوي للشراء) / BUY (أفضل) / NEUTRAL (محايد) / AVOID (تجنب). لا تخترع بندًا واحدة من عدها — استخدم فقط القيم الموجودة في === LIVE DATA ===. كن النظام المحسوب وليس الكاتب الذي يخترع.");
    sections.push("- عندما يسأل المستخدم عن قوائم أو توصيات السوق أو الأسبوع أو كل التوصيات المفتوحة (استعلام عام يشمل أكثر من سهم):");
    sections.push("  • جدول التوصيات الكامل التفاعلي (مع إمكانية التصدير لإكسيل) يُعرض تلقائياً أعلى ردك مباشرة كعنصر تفاعلي في واجهة المحادثة. يمنع منعاً باتاً تكرار أو طباعة أسطر الجدول أو كتابة نصوص بنظام '1 | COSG | ...' داخل النص.");
    sections.push("  • يمنع تماماً استخدام عنوان '🎯 موقف توصيات المنصة للسهم' في الاستعلامات العامة للتوصيات؛ هذا العنوان مخصص فقط للسهم الفردي.");
    sections.push("  • لا تقل أبداً '📋 جدول توصيات...' أو تعد بجدول تالٍ في ردك، بل ادخل مباشرة في التحليل الفني النوعي.");
    sections.push("  • قدم تحليلاً نوعياً ذكياً وموجزاً يصنف التوصيات إلى: 🟢 الأفضل أداءً (الرابحة مع نسب العائد)، ⚪ المتعادلة (0.00% صفقات راكدة لم تتحرك)، 🔴 المتراجعة (خسائر غير محققة)، و🏁 المنتهية (المغلقة بتحقيق الهدف أو ضرب الوقف إن وُجدت).");
    sections.push("- 🎯 موقف توصيات منصة EGX Bots للسهم (مخصص حصرياً وإلزامي عند تحليل أو الاستعلام عن سهم واحد بعينه مثل: حلل ABUK، سعر COMI، أو هل له توصية):");
    sections.push("  • في ردود الأسهم الفردية فقط، خصص قسماً بعنوان '🎯 موقف توصيات المنصة للسهم' يوضح بدقة:");
    sections.push("    1. إذا كانت هناك توصية نشطة (مفتوحة / open): اذكر نوع الإشارة (شراء BUY أو بيع SELL)، سعر الدخول، المستهدف، وقف الخسارة، تاريخ صدورها والمدة المنقضية (مثال: 'صدرت منذ 4 أيام بتاريخ 2026-08-31')، والعائد المحقق حتى الآن (مثال: +14.20%).");
    sections.push("    2. إذا كانت هناك توصية سابقة مغلقة (حققت الهدف win أو ضربت الوقف loss): اذكر متى صدرت، وكيف انتهت (حققت الهدف بنجاح بربح X% أو ضربت وقف الخسارة بنسبة Y%).");
    sections.push("    3. إذا لم تكن هناك أي توصيات سابقة أو حالية مسجلة للسهم: وضح بصراحة واختصار أنه لا توجد توصيات مسجلة لهذا السهم على المنصة حالياً.");
    sections.push("  • 🚫 قاعدة صارمة لتقييم 'الأقوى' أو 'الأفضل' أداءً في التوصيات:");
    sections.push("    1. العائد بقيمة 0.00% يعني تعادلاً تاماً (صفقة راكدة لم تتحرك)، وليس ربحاً ولا ينبغي تسميتها 'مرحلة إيجابية' أو 'صفقة رابحة'.");
    sections.push("    2. الترتيب الصحيح لقوة أداء الصفقات هو: الأعلى ربحاً (الموجب) > الأقرب للتعادل (الأقل خسارة أو 0.00%) > الأكبر خسارة (السالب).");
    sections.push("    3. إذا كانت كل الصفقات/الإشارات خاسرة أو متعادلة، يجب قول ذلك بصدق وصراحة كاملة، مثلاً: 'لا توجد توصية رابحة حالياً من بين الصفقات المسجلة؛ صفقة X متعادلة بـ 0.00%، بينما صفقات Y و Z تسجل خسائر غير محققة بنسبة...'");
    sections.push("    4. يمنع تماماً نعت توصية متعادلة بـ 'الأقوى فنياً' أو 'مرحلة إيجابية' لمجرد أن النسبة صفر أو موجب رمزياً، دون مقارنتها بباقي الصفقات.");
    sections.push("- عندما يسأل المستخدم عن الأسهم المتوافقة مع الشريعة أو توصيات إسلامية/شرعية (مؤشر الشريعة EGX33):");
    sections.push("  1. وضح أن البورصة المصرية تعتمد رسمياً مؤشر الشريعة (EGX 33 Shariah Index) المعتمد من الرقابة المالية.");
    sections.push("  2. اربط التوصيات الفنية المتاحة بالبيانات بالشركات المنتمية لمؤشر الشريعة والقطاعات المباحة (مثل: AMOC، MBSC، MCQE، ARCC، SWDY، ETEL، TMGH، ABUK، MFPC، ADIB، ISPH، إلخ).");
    sections.push("  3. اعرض تفاصيل الصفقات الفنية المتاحة بالبيانات (سعر الدخول، الأهداف، وقف الخسارة) مع توضيح موقفها الفني وقيمتها الاستثمارية.");
    sections.push("  • إذا كان السؤال يتضمن قراراً استثمارياً، وضّح باختصار أن القراءة فنية وليست توصية شراء أو بيع، من دون تكرار صيغة ثابتة في كل رد.");
    sections.push("  • لا تقل أبداً 'إليك الجدول أدناه/التالي/أدناه:' أو تعد بجدول تالٍ في ردك النصي؛ لأن الجداول الفنية والمسوح تظهر تلقائياً في أعلى ردك مباشرة كجزء من واجهة المستخدم.");
    sections.push("  • 🚫 قاعدة صارمة لمنع الاختراع والهلوسة بالبيانات (Zero Hallucination Rule):");
    sections.push("    1. يمنع تماماً اختراع أو افتراض أي رقم، نسبة، أو مرحلة Wyckoff غير موجودة حرفياً في البيانات المتاحة أعلاه (مثل اختراع درجة تصريف أو أيام تصريف غير صفرية إذا كانت في البيانات صفر).");
    sections.push("    2. إذا سأل المستخدم عن مؤشر فني أو قيمة معينة (مثل SMA, EMA, المتوسطات المتحركة, درجة التصريف dist_score, أيام التصريف, إلخ) وهذه القيمة غير متوفرة أو قيمتها صفر في البيانات المتاحة أعلاه (=== DATABASE DATA ===):");
    sections.push("       - يمنع تماماً استخدام رقم أو مؤشر آخر بدلاً منها (مثل استخدام السعر الحالي أو سعر الإغلاق 30 كقيمة للمتوسطات المتحركة SMA/EMA).");
    sections.push("       - يمنع تماماً اختراع أي قيمة تقديرية لها من عقلك.");
    sections.push("       - يجب أن تكتب حرفياً باللغة العربية: 'بيانات [اسم المؤشر] غير متوفرة حالياً لهذا السهم في قاعدة البيانات'.");
    sections.push("    3. التزم بالتماسك المنطقي التام؛ يمنع التناقض في نفس الرد (مثل القول بأن السهم في مرحلة تجميع صاعدة ثم القول في نفس الفقرة بأنه في مرحلة تصريف). طابق كلامك مع إشارات التجميع والتصريف الفعلية الواردة في البيانات.");
    sections.push("    4. 📅 قاعدة توضيح تواريخ المؤشرات: إذا كانت هناك بيانات أو مؤشرات لنفس السهم من تواريخ مختلفة (مثل السعر اللحظي مقابل مسح Wyckoff من تاريخ سابق): يجب عليك كتابة تاريخ كل مؤشر بوضوح بجانبه (مثال: 'مؤشر RSI يبلغ قيمته الفلانية (في تاريخ كذا)، بينما كان قيمته الأخرى في تاريخ المسح الفلاني')؛ يمنع تماماً دمج أو سرد قيم مختلفة لنفس المؤشر دون توضيح التواريخ المرتبطة بكل قيمة بشكل واضح ودقيق.");
    sections.push("  • عندما يسألك المستخدم عن التجميع والتصريف (Accumulation/Distribution) لسهم معين:");
    sections.push("    1. يجب أن تبحث عن أداة get_accumulation_stocks أو get_distribution_stocks في البيانات وتستخرج منها درجة التجميع (acc_score) ودرجة التصريف (dist_score) ومرحلة Wyckoff (wyckoff_phase) وأيام التجميع/التصريف.");
    sections.push("    2. اشرح النتيجة بوضوح مستنداً لتلك الأرقام والتواريخ. صيغة الإجابة الصحيحة: 'بناءً على مسح Wyckoff بتاريخ [X]: درجة التجميع (acc_score) = [قيمة acc_score]، درجة التصريف (dist_score) = [قيمة dist_score]، المرحلة: [wyckoff_phase]، أيام التجميع المتتالية: [عدد الأيام]'.");
    sections.push("    3. يمنع تماماً تجاهل بيانات التجميع الفنية المتاحة أو استخدام مؤشر RSI كبديل للتعبير عن التجميع.");
    sections.push("    4. 🚫 يمنع منعاً باتاً: إذا كانت wyckoff_phase = 'accumulation' أو 'strong_accumulation'، لا تقل أبداً 'السهم في مرحلة تصريف' حتى لو كان RSI مرتفعاً. المرحلة محددة من البيانات الفعلية وليس من RSI.");
    sections.push("  • يمنع تكرار نفس التفسير أو الجملة اللفظية لأكثر من سؤال أو مؤشر (مثل تكرار جملة 'هذا يعني أن السهم في مرحلة تشبع... ويمكن أن يبدأ في هبوط قريباً'). صِف كل مؤشر وقيمته الرقمية بشكل منفصل وبتفسير فني دقيق ومتنوع.");
    sections.push("  • تقريب الأرقام السعرية ومستويات الدعم والمقاومة إلى رقمين عشريين دائماً (مثال: 0.43 جنيه وليس 0.428684 جنيه).");
    sections.push("  • يمنع تماماً تكرار الجمل التمهيدية (مثل: حسناً دعونا نبدأ... حسناً دعونا نبدأ) أو تكرار الفقرات ذات المعنى المماثل في الرد.");
    sections.push("- عندما يسأل المستخدم عن وجود توصيات أو إشارات (أو عند العثور على توصيات في البيانات):");
    sections.push("  • إذا توفرت توصيات أو إشارات في بيانات الأدوات (المسترجعة من get_recommendations أو get_signals): قم بعرض تفاصيل كل توصية بوضوح (سعر الدخول، الهدف، وقف الخسارة، ونسبة العائد المتوقعة أو الفعلية والتقييم الفعلي لأدائها).");
    sections.push("  • إذا لم تكن هناك توصيات مسجلة للأسهم المطلوبة في البيانات: ابدأ الرد بإجابة حوارية مباشرة موضحاً أنه لا توجد حالياً توصيات جديدة مسجلة على هذه الأسهم بصفحة التوصيات بالنظام، ثم قدم له قراءة فنية لمستويات الدعم والمقاومة للاسترشاد بها.");

    sections.push(`- عندما يسأل المستخدم عن تحليل Elliott Wave (موجات إليوت / إليوت فيز / Elliot phase) لسهم معين:
  • لا يوجد حقل Elliott Wave مباشر في قاعدة البيانات. لكن يمكنك تقديم تقدير احترافي للمرحلة باستخدام المؤشرات المتاحة:
  1. قارن السعر الحالي بمستويات الدعم (support) والمقاومة (resistance) والمتوسطات المتحركة (SMA50, SMA200):
     - السعر قريب من الدعم + RSI 30–50 + حجم ضعيف → يُرجَّح: موجة 2 أو 4 تصحيحية، أو نهاية التصحيح
     - السعر في منتصف القناة + RSI 50–65 + حجم نشط → يُرجَّح: موجة 3 أو 1 صاعدة قوية (المرحلة الأقوى)
     - السعر عند المقاومة + RSI ≥ 70 (تشبع شرائي) + حجم ضعيف → يُرجَّح: نهاية موجة 5 أو قمة دافعية (مرحلة جني أرباح)
     - السعر تحت SMA200 + RSI ≤ 40 + اتجاه هابط → يُرجَّح: موجة A أو B أو C تصحيحية
  2. استخدم دائماً صيغة "يُرجَّح" أو "من المحتمل" أو "التقدير الفني يشير إلى" — وليس جزم مطلق — لأن التحديد الدقيق لموجات إليوت يحتاج تحليل رسم بياني مفصل لا يتوفر في البيانات.
  3. اذكر صراحةً أن النظام لا يحتوي على حقل بيانات إليوت آلي، وأن هذا تقدير فني مبني على المؤشرات المتاحة.
  4. قدم القراءة الفنية الكاملة (RSI، الموقع في النطاق، الحجم) ثم استنتج المرحلة المحتملة بناءً على ذلك.`);

    sections.push("=== USER REQUEST ===\n" + (userMessage || "(بدون رسالة)"));


    const evidenceEngineBlock = buildEvidenceEnginePromptBlock(toolResults);
    if (evidenceEngineBlock) {
        sections.push(evidenceEngineBlock);
    }

    if (correctionPrompt) {
        sections.push("⚠️ SYSTEM CORRECTION ALERT:\n" + correctionPrompt);
    }


    let contextText = sections.join("\n\n");
    if (contextText.length > MAX_CONTEXT_CHARS) {
        contextText = `...\n\n[تم اقتطاع السياق القديم - تجاوز الحد الأقصى]\n\n` + contextText.slice(-MAX_CONTEXT_CHARS);
    }

    const today = new Date().toISOString().split("T")[0];

    const lengthRule = plan.intent === "technical_scan"
        ? "اعرض قائمة الأسهم ونتائج المسح الفني دائمًا في جدول ماركداون (Markdown Table) منسق ومكتمل الأعمدة بدلاً من القوائم المنقطة أو الأسطر الطويلة لتفادي تداخل النصوص واللغات."
        : (plan.intent === "stock_analysis" || plan.intent === "general_chat")
        ? "أجب مباشرة في فقرة قصيرة أو نقطتين إلى أربع نقاط حسب عدد الأرقام المطلوبة، من دون افتتاحية محفوظة أو حشو."
        : "أجب مباشرة وبقدر التفصيل الذي يحتاجه السؤال؛ اجمع الأرقام المتصلة في جمل طبيعية ولا تحوّل كل حقل إلى سطر ثابت (إلا في حالة القوائم أو نتائج الفلاتر فاستخدم الجداول دائماً).";

    const systemPrompt = `أنت الخبير والمحلل الفني الاحترافي للبورصة المصرية (EGX Bots). اليوم: ${today}.
دورك تقديم قراءة فنية موضوعية ومباشرة تعتمد حكراً على الأرقام الحقيقية في البيانات.

🚨 قانون تنسيق جداول المسح الفني الفائق الأهمية (MANDATORY TABLE RULE):
إذا كانت البيانات تحتوي على نتائج مسح فني أو فلاتر أو قائمة أسهم (مثل get_technical_scan أو get_accumulation_stocks)، يجب عليك عرضها بالكامل في جدول ماركداون (Markdown Table) منسق ومكتمل الأعمدة كالتالي:
| # | السهم | الاسم | السعر | التغير | RSI | حجم نسبي | تفاصيل فنية أخرى |
|---|---|---|---|---|---|---|---|
يمنع منعاً باتاً صياغة القوائم أو نتائج الفلاتر الفنية في شكل نقاط (Bullet points) أو فقرات نصية عادية. يجب دائماً استخدام الجدول.

قواعد تحليل وتغطية الأسهم الصارمة:
1. ${lengthRule}
2. يجب تغطية ومقارنة جميع الأسهم المذكورة في البيانات أدناه وعدم تجاهل أي سهم منها.
2b. إذا كان اسم السهم في البيانات يختلف عمّا كتبه المستخدم في سؤاله (مثلاً كتب 'روتو' أو 'الرود' أو 'الرواد'، أو كتب 'راكتا' أو 'راكطا' أو 'ورق راكتا')، اذكر في أول سطر من التحليل الاسم الذي حُلَّ إليه الاستعلام (مثال: 'روتو → الرواد للسياحة') حتى يتأكد العميل أن التحليل يخص السهم الذي يقصده. استخدم الأسماء الوصفية فقط (لا تكتب رموز الأسهم المؤلفة من حروف لاتينية في هذا السطر التوضيحي).
3. قواعد القراءة الفنية للمؤشرات:
   - RSI أكبر من أو يساوي 70: منطقة تشبع شرائي (Overbought) وتخفيف/جني أرباح، وتعتبر مرتفعة المخاطر للشراء.
    - RSI بين 50 و 68: منطقة زخم محايد يميل للإيجابية. تتطلب حجم تداول مثبت (vol_ratio ≥ 1.0) لتأكيد الإشارة. لا تُصف بأنها 'آمنة'، 'قوية'، أو 'واضحة' إلا إذا رانج الحجم أو المؤشرات الأخرى دعم ذلك.
   - RSI بين 40 و 49: منطقة حيادية استقرار.
   - نسبة الحجم (Volume Ratio): أكبر من 1.0x تعني تداولاً كثيفاً فوق المتوسط، وأقل من 1.0x تعني تداولاً أقل من المتوسط.
4. سلامة اللغة والموضوعية:
   - اكتب بلغة عربية فصحى سليمة 100% وبدون أخطاء إملائية أو ركيكة (يمنع استخدام عبارات مثل "يوصي بنا" أو "أن نستثمر").
   - اذكر الجانب الفني لكل سهم وموقعه الموضوعي باختصار شديد. في حالة الاستعلام عن وجود توصيات أو صفقات بالاسم، اعرض تفاصيل التوصية المتوفرة (سعر الدخول، الهدف، وقف الخسارة، ونسبة العائد الفعلي)؛ خلاف ذلك اذكر الجانب الفني دون تقديم أوامر شراء صريحة.
5. قواعد عرض تقييمات نماذج الذكاء الاصطناعي (ML Scores):
   - يمتلك النظام تقييمين يعتمدان على الذكاء الاصطناعي وتعلم الآلة لكل سهم: KING AI Score و EGX AI Score (يتم تمثيلهما كنسبة مئوية، مثلاً 58.3% أو 0.0% أو غير متوفر).
   - يجب عليك في نهاية تحليلك لأي سهم، وبعد ذكر رأيك الفني والمالي التقليدي، أن تضيف فقرة مستقلة تمامًا في نهاية الرد بعنوان "**الرأي الإحصائي للذكاء الاصطناعي (ML Scores)**".
   - اذكر فيها بوضوح تقييم KING AI ونموذج EGX AI للسهم وفسرهما للعميل. وضح أن النسبة تمثل درجة ثقة الموديل في إيجابية الاتجاه فنيًا (النسب المرتفعة تشير لفرص قوية والنسب القريبة من الصفر تعني تجنب السهم تمامًا فنيًا).
   - 📊 قاعدة فارق نقاط ML (ML Score Delta): عند مقارنة سهمين أو أكثر، يجب أن تذكر الفرق الدقيق بين نقاط KING AI و EGX AI لكل أزواج الأسهم (مثال: 'الموديل الأول يتفوق على الموديل الثاني بفارق نقاط معين'). إذا كان الفرق ≤ 1.0 نقطة، صرّح صراحة أن الفرق 'ضيق / غير إحصائيًا ولا يلزم دلالة ضعيفة' ولا يُعتبر فرقاً معنوياً. لا تقل أبداً 'تفوق كبير' أو 'ميزة واضحة' إذا كان الفرق ≤ 1.0 نقطة.
    - 📊 قاعدة توافق النماذج (Model Consensus): عند عرض ML Scores، أضف قسماً 'رأي النماذات' يحتوي على:
      • تفسير كل نموذج بناءاً على النسبة: 70%+ = 'إيجابي قوي'، 55-70% = 'إيجابي متوسط'، 45-55% = 'محايد'، 30-45% = 'متحفظ'، <30% = 'سلبي'.
      • 'اتفاق النماذج': انسخ قيمة model_consensus من DERIVED_FLAGS حرفيًا (الفرق بالنقاط + التصنيف). ممنوع إعادة حسابها بنفسك أو القول إن الفرق 'أكبر من 15 نقطة' إذا كانت القيمة المحسوبة أقل من 15 نقطة والعكس صحيح.
      • استنتج 'القرار الفني العام' من تصنيف model_consensus: اتفاق قوي + نطاق عالي = 'شراء/مراجعة'؛ اتفاق ضعيف = 'مراقبة'؛ اتفاق منخفض جداً = 'انتظار'.
      - لا تنسَ: النماذات قد تتباين، وهذا شائع. اشرح للمستخدم لماذى قد تختلف النماذات.
6. تنسيق القوائم والجداول (Formatting Guideline):
   - عندما يُطلب منك عرض قائمة أسهم أو نتائج مسح فني أو فلاتر أو مقارنات متعددة، اعرضها دائماً في جدول ماركداون (Markdown Table) منسق ومكتمل الأعمدة بدلاً من القوائم المنقطة أو الأسطر الطويلة. هذا يمنع تداخل النصوص واللغات ويجعل العرض احترافياً ونظيفاً ونظيفاً جداً في واجهة المستخدم.
7. التعامل مع الأسهم والشركات غير المدرجة بقاعدة البيانات الرئيسية (Unlisted/SME Stocks):
   - إذا سأل المستخدم عن شركة أو سهم (مثل ركاز RKAZ أو أي شركة غير مسجلة في الـ 236 سهماً الرئيسية للمنصة) وتوفرت عنها نتائج بحث على الويب (=== VERIFIED WEB SEARCH RESULTS ===):
   - وضح للمستخدم في أول سطر من إجابتك بوضوح واحترافية: أن هذا السهم/الشركة غير مدرج في قاعدة بيانات الأسهم الرئيسية الـ 236 المسجلة على المنصة (مثلاً لأنه مدرج بسوق المشروعات الصغيرة والمتوسطة SMEs / بورصة النيل، أو شركة خارج السوق الرئيسي)، وبالتالي لا تتوفر له مؤشرات فنية أو سكورات ML آلية لحظية.
   - ثم قدم له ملخصاً وافياً ومفيداً عن نشاط الشركة، وتطوراتها، وأحدث الأخبار المتاحة عنها من نتائج البحث على الويب مع الإشارة للمصادر بصيغة [1] و [2].`;

    const messages: { role: string; content: any }[] = [
        { role: "system", content: systemPrompt }
    ];

    if (plan.needs_history && recentHistory.length > 0) {
        recentHistory.forEach(m => {
            const content = String(m.content || "")
                .replace(/ERROR:.*image.*model does not support image input[^.]*\.?/gi, "")
                .replace(/Cannot read ["']?image\.(?:png|jpe?g|webp)["']?[^.]*\.?/gi, "")
                .replace(/===\s*(?:USER REQUEST|LIVE DATA|INTENT PLAN|RESPONSE RULES)\s*===/gi, "")
                .trim();
            if (content) {
                const role = m.role === "user" || m.role === "assistant" ? m.role : "user";
                messages.push({ role, content: content.substring(0, 800) });
            }
        });
    }

    messages.push({ role: "user", content: contextText });

    return messages;
}

// 🔑 Smart multi-key handling: rotate the starting key per request to spread
// rate limits across keys, and put a key in cooldown when it gets a 429.
const nvidiaKeyCooldownUntil = new Map<string, number>();
let nvidiaKeyCursor = 0;
function orderNvidiaKeys(keys: string[]): string[] {
    if (keys.length <= 1) return keys;
    const pivot = nvidiaKeyCursor++ % keys.length;
    const rotated = [...keys.slice(pivot), ...keys.slice(0, pivot)];
    const now = Date.now();
    return [...rotated].sort((a, b) => ((nvidiaKeyCooldownUntil.get(a) || 0) <= now ? 0 : 1) - ((nvidiaKeyCooldownUntil.get(b) || 0) <= now ? 0 : 1));
}
function setKeyCooldown(key: string, seconds: number) {
    nvidiaKeyCooldownUntil.set(key, Date.now() + Math.min(Math.max(seconds, 10), 120) * 1000);
}

async function callNvidiaApi(
    modelName: string,
    messages: { role: string; content: any }[],
    apiKeys: string[],
    stream: boolean = false,
    maxTokens?: number,
    timeoutMs: number = 25000,
    reasoningEffort?: string
): Promise<{ response: string | null; streamGen?: AsyncGenerator<string>; aborted?: boolean }> {
    const orderedKeys = orderNvidiaKeys(apiKeys);
    let keyIndex = 0;
    while (keyIndex < orderedKeys.length) {
        const key = orderedKeys[keyIndex];
        const keyCooldown = nvidiaKeyCooldownUntil.get(key) || 0;
        if (keyCooldown > Date.now() && orderedKeys.some(k => (nvidiaKeyCooldownUntil.get(k) || 0) <= Date.now())) {
            keyIndex++; // another key is available — don't burn a rate-limited one
            continue;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(AI_CONFIG.api.nvidiaBaseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: modelName,
                    messages,
                    temperature: 0.15,
                    max_tokens: maxTokens || AI_CONFIG.limits.responseMaxTokens,
                    stream,
                    // Reasoning models merge deliberation into content unless effort is capped.
                    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok && res.status === 429) {
                const errData: any = await res.json().catch(() => null);
                const retryAfter = Number(errData?.retry_after_seconds || errData?.error?.retry_after_seconds) || 30;
                setKeyCooldown(key, retryAfter + 5);
                console.warn(`[Responder] NVIDIA HTTP 429 (key ${keyIndex + 1}/${orderedKeys.length}) — key cooldown ${Math.min(retryAfter + 5, 120)}s`);
                keyIndex++;
                continue;
            }
            if (res.ok) {
                if (stream) return { response: null, streamGen: parseSseStream(res) };
                const data = await res.json();
                const reply = data.choices?.[0]?.message?.content?.trim();
                if (reply) return { response: reply };
                keyIndex++;
            } else {
                console.warn(`[Responder] NVIDIA HTTP ${res.status} (key ${keyIndex + 1}/${orderedKeys.length})`);
                keyIndex++;
            }
        } catch (err: any) {
            clearTimeout(timeoutId);
            console.warn(`[Responder] NVIDIA error: ${err?.message || err}`);
            // Timeout = endpoint congestion (same backend for all keys) — stop burning keys
            // and let the caller fall through to the next model immediately.
            if (controller.signal.aborted) return { response: null, aborted: true };
            keyIndex++;
        }
    }
    return { response: null };
}

async function callDeepSeekApi(
    modelName: string,
    messages: { role: string; content: any }[],
    apiKey: string,
    stream: boolean = false
): Promise<{ response: string | null; streamGen?: AsyncGenerator<string> }> {
    const controller = new AbortController();
    const timeoutMs = modelName === "deepseek-reasoner" ? 45000 : 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const maxTokens = modelName === "deepseek-reasoner" ? 4000 : AI_CONFIG.limits.responseMaxTokens;
        const res = await fetch(AI_CONFIG.api.deepseekBaseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: modelName,
                messages,
                temperature: modelName === "deepseek-reasoner" ? undefined : 0.15,
                max_tokens: maxTokens,
                stream
            })
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            if (stream) return { response: null, streamGen: parseSseStream(res) };
            const data = await res.json();
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (reply) return { response: reply };
        } else {
            console.warn(`[Responder] DeepSeek HTTP ${res.status}`);
        }
    } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`[Responder] DeepSeek error: ${err?.message || err}`);
    }
    return { response: null };
}

const DEEPSEEK_RESPONDER_MODELS = [
    "deepseek-chat",
    "deepseek-reasoner"
];

const NVIDIA_MODEL_TUNING: Record<string, { maxTokens: number; timeoutMs: number; reasoningEffort?: string }> = {
    "meta/llama-3.2-11b-vision-instruct": { maxTokens: 2500, timeoutMs: 25000 },
    "nvidia/nemotron-3.5-lightning-30b-a3b": { maxTokens: 2500, timeoutMs: 15000 },
    "meta/muse-glimmer-30b": { maxTokens: 2500, timeoutMs: 20000 }
};

// Text fallback chain used when DEEPSEEK_API_KEY is not configured (e.g. the
// production environment) so the responder never silently degrades to
// deterministic-only replies.
const NVIDIA_TEXT_FALLBACK_MODELS = [
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "meta/muse-glimmer-30b"
];

// 🧊 Congestion cooldown: a timeout means the shared NIM backend is congested,
// so skip the whole chain briefly instead of re-hitting it.
let nvidiaCooldownUntil = 0;

// Shortest remaining cooldown (ms) until at least one provider slot opens up.
// Lets the pipeline wait out brief rate-limit windows before a degraded-fallback
// retry, and fail fast during long storms.
export function getResponderCooldownMs(): number {
    const now = Date.now();
    const remaining: number[] = [];
    for (const until of nvidiaKeyCooldownUntil.values()) {
        if (until > now) remaining.push(until - now);
    }
    if (nvidiaCooldownUntil > now) remaining.push(nvidiaCooldownUntil - now);
    return remaining.length ? Math.min(...remaining) : 0;
}

async function callResponderLlm(
    messages: { role: string; content: any }[],
    apiKeys: string[],
    stream: boolean = false,
    requestedModel?: string
): Promise<{ response: string | null; streamGen?: AsyncGenerator<string>; provider: "deepseek" | "nvidia" | "none" }> {
    
    const visionModels = new Set(AI_CONFIG.models.response.vision);
    const isVisionModel = requestedModel && visionModels.has(requestedModel);
    const hasImages = messages.some(m => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url'));

    if (isVisionModel || (hasImages && !requestedModel)) {
        // vision request - route to NVIDIA Llama vision models
        const targetModel = requestedModel || AI_CONFIG.models.response.vision[0];
        const nvidiaKeys = Array.from(new Set([
            ...apiKeys,
            ...getNvidiaApiKeys(),
        ]));

        const tuning = NVIDIA_MODEL_TUNING[targetModel];
        const n = await callNvidiaApi(targetModel, messages, nvidiaKeys, stream, tuning?.maxTokens, tuning?.timeoutMs, tuning?.reasoningEffort);
        if (n.response || n.streamGen) return { ...n, provider: "nvidia" };
    } else {
        // text request - route to DeepSeek (chat/reasoner)
        const targetModel = requestedModel === "deepseek-reasoner" ? "deepseek-reasoner" : "deepseek-chat";
        const deepseekKey = getDeepSeekApiKey();
        if (deepseekKey) {
            const ds = await callDeepSeekApi(targetModel, messages, deepseekKey, stream);
            if (ds.response || ds.streamGen) return { ...ds, provider: "deepseek" };
        } else {
            // No DeepSeek credentials (production): fall back to the legacy
            // NVIDIA text chain instead of returning nothing.
            console.warn("[Responder] DeepSeek credentials are not configured — falling back to NVIDIA text models");
            const nvidiaKeys = Array.from(new Set([
                ...apiKeys,
                ...getNvidiaApiKeys(),
            ]));
            for (const model of NVIDIA_TEXT_FALLBACK_MODELS) {
                const tuning = NVIDIA_MODEL_TUNING[model];
                const n = await callNvidiaApi(model, messages, nvidiaKeys, stream, tuning?.maxTokens, tuning?.timeoutMs);
                if (n.response || n.streamGen) return { ...n, provider: "nvidia" };
                if (n.aborted) break;
            }
        }
    }

    console.warn("[Responder] All LLM providers failed — deterministic fallback will be used");
    return { response: null, provider: "none" };
}

async function* parseSseStream(res: Response): AsyncGenerator<string, void, unknown> {
    if (!res.body) throw new Error("stream ended before provider completion marker");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let providerDone = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data: ")) {
                    const dataStr = trimmed.slice(6);
                    if (dataStr === "[DONE]") {
                        providerDone = true;
                        break;
                    }
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.choices?.[0]?.finish_reason) providerDone = true;
                        const token = parsed.choices?.[0]?.delta?.content || "";
                        if (token) yield token;
                    } catch {}
                }
            }
            if (providerDone) break;
        }
        if (!providerDone) throw new Error("stream ended before provider completion marker");
    } finally {
        reader.releaseLock();
    }
}

function removeModelTables(text: string): string {
    return text;
}

export interface ResponderMeta {
    source?: "llm" | "deterministic";
    // True when the deterministic reply is a degraded fallback after ALL LLM
    // providers failed (vs. an intentional template answer) — the pipeline may
    // grant one extra attempt once rate-limit cooldowns expire.
    degraded?: boolean;
}


export function buildDeterministicNewsResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const normMsg = userMessage.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    // Compound requests ("سعر راميدا كام واخبار كومي ايه") must reach the LLM with all
    // tool data — this news-only template would hide the price half of the question.
    const compoundSplit = userMessage
        .split(/\s+و?(?=(?:هات|جيب|اعرض|حلل|شوف|قارن|مين|ايه|إيه|اخبار|أخبار|سعر|ترتيب|قايمه|قائمة)(?:\s|$))/i)
        .filter(Boolean);
    if (compoundSplit.length > 1) return null;
    const asksForNews = /(?:اخبار|أخبار|خبر(?!ه)|عناوين|news)/i.test(normMsg);
    if (!asksForNews) return null;

    const newsResult = toolResults.find(r => r.tool === "get_news");
    if (!newsResult) return null;

    // Corporate actions complement the headlines and must never be hidden by
    // this deterministic template.
    const caResult = toolResults.find(r => r.tool === "get_corporate_actions");
    const caItems = caResult && Array.isArray(caResult.data?.corporate_actions)
        ? caResult.data.corporate_actions
        : [];
    const formatCaSection = (items: any[]): string[] => {
        const lines = ["", "الأحداث المالية المؤثرة (اكتتابات/توزيعات/تجزئة/منح/رأس المال):"];
        items.slice(0, 6).forEach((item: any) => {
            const dateStr = item.published_at ? ` (${String(item.published_at).slice(0, 10)})` : "";
            const sourceStr = item.source ? ` — المصدر: ${item.source}` : "";
            lines.push(`- **${item.symbol}** (${item.action_type_ar}): ${item.title}${dateStr}${sourceStr}`);
        });
        return lines;
    };

    const items = Array.isArray(newsResult.data) ? newsResult.data : [];
    const rangeLabel = plan.entities.requested_start_date && plan.entities.requested_end_date
        ? ` من ${plan.entities.requested_start_date} إلى ${plan.entities.requested_end_date}`
        : " الحالية";

    if (items.length === 0) {
        if (caItems.length > 0) {
            return [`لا توجد أخبار عامة مسجلة خلال الفترة${rangeLabel}، لكن توجد أحداث مالية مؤثرة:`, ...formatCaSection(caItems)].join("\n");
        }
        return `لا توجد أخبار أو بيانات معنويات مسجلة خلال الفترة${rangeLabel}${plan.entities.symbols?.length ? ` للأسهم ${plan.entities.symbols.join("، ")}` : ""}.`;
    }

    // Deduplicate by title (case-insensitive and trimmed)
    const seenTitles = new Set();
    const uniqueItems = [];
    for (const item of items) {
        const itemHeadlines = Array.isArray(item?.headlines) ? item.headlines : [];
        const dateStr = item.date || item.published_at || "";
        for (const hl of itemHeadlines) {
            if (!hl) continue;
            const normalizedTitle = hl.toLowerCase().trim().replace(/\s+/g, ' ');
            if (!seenTitles.has(normalizedTitle)) {
                seenTitles.add(normalizedTitle);
                uniqueItems.push({
                    symbol: item.symbol,
                    title: hl.trim(),
                    date: dateStr
                });
            }
        }
    }

    if (uniqueItems.length === 0) {
        if (caItems.length > 0) {
            return [`لا توجد عناوين أخبار عامة مسجلة خلال الفترة${rangeLabel}، لكن توجد أحداث مالية مؤثرة:`, ...formatCaSection(caItems)].join("\n");
        }
        return `لا توجد أخبار أو بيانات معنويات مسجلة خلال الفترة${rangeLabel}.`;
    }

    // Filter and limit to 5 headlines
    const headlines = uniqueItems.slice(0, 5);
    const lines = [`أهم الأخبار الفعلية المتاحة خلال الفترة${rangeLabel}:`];
    
    headlines.forEach((item: any) => {
        const title = item.title;
        const dateStr = item.date || "";
        const formattedDate = dateStr ? ` (${String(dateStr).slice(0, 10)})` : "";
        const symbolPrefix = item.symbol ? `**${item.symbol}**: ` : "";
        lines.push(`- ${symbolPrefix}${title}${formattedDate}`);
    });

    if (caItems.length > 0) {
        lines.push(...formatCaSection(caItems));
    }

    return lines.join("\n");
}

// Web-search results (explicit request or news missing from the database) are
// rendered deterministically so every item keeps its real source URL instead of
// letting the LLM paraphrase or invent citations.
export function buildWebSearchResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const allWeb = toolResults.filter(r => r.tool === "search_web");
    const webResults = allWeb.filter(r => Array.isArray(r.data?.results) && r.data.results.length > 0);
    if (webResults.length === 0) {
        // Explicit internet request but zero usable results: never let the LLM
        // fabricate an "I searched" reply - answer deterministically instead.
        const explicitSearch = /(?:ابحث|دور|فتش|بحث|شوف|بص|سيرش|شيك|تشيك)\s*(?:في|فى|على|عن)\s*(?:النت|الانترنت|الإنترنت|جوجل|المواقع|الويب)|(?:من|عبر)\s+(?:النت|الانترنت|الإنترنت)/i.test(userMessage);
        const fallbackOnly = allWeb.length > 0 && allWeb.every(r => r.data?.fallback_for === "get_news");
        if (explicitSearch && !fallbackOnly) {
            return "بحثت على الإنترنت عن طلبك لكن لم أجد نتائج موثقة يمكن عرضها حالياً. جرّب إعادة صياغة السؤال بكلمات مختلفة أو أكثر تحديداً.";
        }
        return null;
    }
    // Let DeepSeek synthesize the verified results. Raw result rendering made
    // explicit web searches look like a search dump rather than a conversation.
    return null;
}

function appendVerifiedWebSources(response: string, toolResults: ToolResult[]): string {
    const webResults = toolResults.filter(result =>
        result.tool === "search_web" && Array.isArray(result.data?.results) && result.data.results.length > 0
    );
    if (webResults.length === 0 || /المصادر المستخدمة|مصادر البحث/i.test(response)) return response;
    const lines = ["", "**مصادر البحث المستخدمة:**"];
    let index = 0;
    for (const result of webResults) {
        for (const item of result.data.results.slice(0, 8)) {
            index += 1;
            lines.push(`[${index}] ${item.title} (${item.domain})`);
            lines.push(item.url);
        }
    }
    lines.push("هذه روابط جلبها النظام أثناء الإجابة وقد تتغير محتوياتها لاحقاً.");
    return `${response.trim()}\n${lines.join("\n")}`;
}

// Day-by-day change requests ("جيب نسبة تغيره آخر أسبوع يوم بيوم", "آخر 11 يوم")
// reach the LLM with the daily history inside === HISTORICAL DATA ===, but the
// model often ignores it or paraphrases it instead of the requested table.
// Render the table deterministically from get_price_history results before any
// LLM call.

export function buildYtdMarketRankingResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const ytdResult = toolResults.find(r => r.tool === "get_price_history" && (Array.isArray(r.data?.market_period_ranking) || Array.isArray(r.data?.market_ytd_ranking)));
    if (!ytdResult) return null;

    const ranking = ytdResult.data.market_period_ranking || ytdResult.data.market_ytd_ranking;
    if (!ranking || ranking.length === 0) return null;

    const isWtd = ytdResult.data.period_type === "WTD" || /(?:اسبوع|wtd)/i.test(userMessage);
    const isMtd = !isWtd && (ytdResult.data.period_type === "MTD" || /(?:شهر|mtd)/i.test(userMessage));
    const countMatch = userMessage.match(/(\d{1,2}|٥٠|٢٠|١٥|١٠)/);
    let requestedLimit = isWtd ? 15 : isMtd ? 15 : 50;
    if (countMatch) {
        const arabicToNum: Record<string, number> = { "٥٠": 50, "٢٠": 20, "١٥": 15, "١٠": 10 };
        const num = arabicToNum[countMatch[1]] || parseInt(countMatch[1], 10);
        if (num > 0 && num <= 100) requestedLimit = num;
    }

    const displayedStocks = ranking.slice(0, requestedLimit);
    const endDate = ytdResult.data.end_date || "2026-08-13";
    const startPeriod = ytdResult.data.start_period || (isWtd ? "بداية الأسبوع" : isMtd ? "بداية الشهر" : "2026-01-04");
    const periodName = isWtd ? `من بداية الأسبوع (${startPeriod})` : isMtd ? `من بداية الشهر (${startPeriod})` : "من بداية العام 2026 (YTD)";

    const wantsLiquidity = ytdResult.data.wants_liquidity || /(?:سيول|تداول|حجم)/i.test(userMessage);
    const wantsLowest = ytdResult.data.wants_lowest || /(?:اقل|أقل|ارخص|أرخص|ادنى|أدنى)/i.test(userMessage);

    const orderWord = wantsLowest ? "بأقل" : "بأعلى";
    const metricWord = wantsLiquidity ? "معدل السيولة وتداول الجلسة" : "نسبة الأرباح والعائد";

    const colName = wantsLiquidity ? "قيمة التداول (السيولة)" : (isWtd ? "نسبة الارتفاع (WTD)" : isMtd ? "نسبة الارتفاع (MTD)" : "نسبة الارتفاع (YTD)");
    const startPriceCol = isWtd ? "سعر بداية الأسبوع" : isMtd ? "سعر بداية الشهر" : "سعر بداية العام";

    const lines: string[] = [
        `إليك قائمة ${orderWord} ${displayedStocks.length} سهماً من حيث ${metricWord} بالبورصة المصرية ${periodName} حتى جلسة ${endDate}، مرتبة ${wantsLowest ? "تصاعدياً" : "تنازلياً"}:`,
        "",
        `| # | الرمز | اسم الشركة | السعر الحالي | ${startPriceCol} | ${colName} |`,
        "| :--- | :--- | :--- | :--- | :--- | :--- |"
    ];

    displayedStocks.forEach((s: any, idx: number) => {
        let metricVal = "";
        if (wantsLiquidity) {
            const liqM = Number(s.liquidity || 0);
            if (liqM >= 1_000_000) {
                metricVal = `**${(liqM / 1_000_000).toFixed(2)} مليون ج.م**`;
            } else if (liqM >= 1_000) {
                metricVal = `**${(liqM / 1_000).toFixed(2)} ألف ج.م**`;
            } else {
                metricVal = `**${liqM.toFixed(2)} ج.م**`;
            }
        } else {
            const ret = s.return_pct ?? s.mtd_return_pct ?? s.ytd_return_pct;
            const sign = Number(ret) >= 0 ? "+" : "";
            metricVal = `**${sign}${ret}%**`;
        }
        lines.push(`| ${idx + 1} | **${s.symbol}** | ${s.name} | ${s.current_price} ج.م | ${s.start_price} ج.م | ${metricVal} |`);
    });

    lines.push("");
    lines.push(`📌 الحساب مبني على أسعار الإغلاق المعتمدة بين أول جلسة تداول في الفترة (${startPeriod}) وآخر جلسة مسجلة (${endDate}). هذه قراءة لأداء الأسعار الفعلي وليست توصية شراء أو بيع.`);

    return lines.join("\n");
}

export function buildDailyChangeHistoryResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const normMsg = userMessage.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    // Future-forecast phrasing keeps its dedicated deterministic handling.
    if (/(?:توقع|متوقع|توقعات)/i.test(normMsg)) return null;
    const dayByDayMarker = /يوم\s*بـ?\s*يوم|التغير\s*اليومي|تغير\s*يومي|سعر\s*كل\s*يوم|اداء\s*يومي|تغيره?\s*(?:يوميا|يوم بيوم)/i.test(normMsg);
    const weekMarker = /(?:اخر|آخر)\s*(?:اسبوع|أسبوع|اسبوعين|أسبوعين|ايام|أيام|جلسات)|يوميا/i.test(normMsg);
    const changeMention = /تغير|نسبه|نسبة|اداء|أداء/i.test(normMsg);
    if (!dayByDayMarker && !(weekMarker && changeMention)) return null;

    const priceHistories = toolResults.filter(r => r.tool === "get_price_history" && r.data?.symbol && Array.isArray(r.data.recent_5_sessions));
    if (priceHistories.length === 0) return null;

    // Explicit session count ("آخر 11 يوم", "اخر 5 جلسات") clamped to the data
    // the tool provides (recent_15_sessions); default = last trading week.
    const countMatch = normMsg.match(/(?:اخر|آخر)\s*(\d{1,2})\s*(?:يوم|ايام|جلسه|جلسة)/i);
    const wantsFifteen = /اسبوعين|أسبوعين|خمستاشر|خمسة عشر/i.test(normMsg);
    const requestedCount = countMatch ? Math.min(Math.max(parseInt(countMatch[1], 10), 1), 15) : wantsFifteen ? 15 : 5;
    const fmt = (v: unknown) => Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "غير متاح";

    const blocks: string[] = [];
    for (const history of priceHistories) {
        const data = history.data;
        const pool = requestedCount > 5 && Array.isArray(data.recent_15_sessions)
            ? data.recent_15_sessions
            : data.recent_5_sessions;
        const rows = (Array.isArray(pool) ? pool : []).filter((s: any) => s && s.date).slice(0, requestedCount);
        if (!rows.length) continue;
        const periodLabel = requestedCount === 5 && !countMatch
            ? "آخر أسبوع تداول (آخر 5 جلسات)"
            : `آخر ${rows.length} جلسة متاحة`;
        const lines: string[] = [
            `التغير اليومي لسهم ${data.symbol} خلال ${periodLabel} يوم بيوم من بيانات الأسعار المسجلة:`,
            "",
            "| التاريخ | سعر الإغلاق | نسبة التغير اليومي | أعلى سعر | أدنى سعر |",
            "| :--- | :--- | :--- | :--- | :--- |"
        ];
        rows.forEach((s: any) => {
            lines.push(`| ${String(s.date).slice(0, 10)} | ${fmt(s.close)} جنيه | ${s.change_pct ?? "N/A"} | ${fmt(s.high)} | ${fmt(s.low)} |`);
        });
        const latestClose = Number(rows[0].close);
        const parsedChanges = rows
            .map((s: any) => Number(String(s.change_pct ?? "").replace("%", "")))
            .filter(Number.isFinite);
        // Compound every known daily change so the period total also covers the
        // oldest row (whose own change is relative to the session before the table).
        const periodChange = (parsedChanges as number[]).length
            ? ((parsedChanges as number[]).reduce((acc: number, v: number) => acc * (1 + v / 100), 1) - 1) * 100
            : null;
        const upDays = parsedChanges.filter((v: number) => v > 0).length;
        const downDays = parsedChanges.filter((v: number) => v < 0).length;
        const trend = periodChange == null
            ? "الاتجاه غير محسوم لعدم اكتمال البيانات"
            : periodChange > 2 ? "الاتجاه العام صاعد"
            : periodChange < -2 ? "الاتجاه العام هابط"
            : "الحركة عرضية في مجملها";
        const summaryParts = [`${trend}${periodChange != null ? `؛ محصلة الفترة ${periodChange >= 0 ? "+" : ""}${periodChange.toFixed(2)}%` : ""}`];
        if (parsedChanges.length) summaryParts.push(`جلسات الصعود ${upDays} والهبوط ${downDays}`);
        lines.push("");
        lines.push(`ملخص الفترة: ${summaryParts.join("، ")}، وآخر إغلاق ${fmt(latestClose)} جنيه بتاريخ ${String(rows[0].date).slice(0, 10)}. الأرقام من بيانات الأسعار التاريخية وليست توصية شراء أو بيع.`);
        blocks.push(lines.join("\n"));
    }
    return blocks.length ? blocks.join("\n\n") : null;
}

export async function generateV2Response(
    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number },
    apiKeys: string[],
    requestedModel?: string,
    sessionState?: SessionState | null,
    correctionPrompt?: string,
    meta?: ResponderMeta
): Promise<string> {
    if (visionContext && visionContext.symbols.length === 0 && toolResults.length === 0) {
        if (meta) meta.source = "deterministic";
        return buildVisionUncertaintyResponse(visionContext);
    }
    const webSearchResponse = buildWebSearchResponse(userMessage, plan, toolResults);
    if (webSearchResponse) {
        if (meta) meta.source = "deterministic";
        return sanitizeReply(webSearchResponse);
    }
    const newsResponse = buildDeterministicNewsResponse(userMessage, plan, toolResults);
    if (newsResponse) {
        if (meta) meta.source = "deterministic";
        return newsResponse;
    }
    const ytdRanking = buildYtdMarketRankingResponse(userMessage, plan, toolResults);
    if (ytdRanking) {
        if (meta) meta.source = "deterministic";
        return sanitizeReply(ytdRanking);
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) {
        if (meta) meta.source = "deterministic";
        return fastAdvisor;
    }
    const dailyHistory = buildDailyChangeHistoryResponse(userMessage, plan, toolResults);
    if (dailyHistory) {
        if (meta) meta.source = "deterministic";
        return sanitizeReply(dailyHistory);
    }
    const singleStockAccDistResponse = buildSingleStockAccumulationDistributionResponse(userMessage, plan, toolResults);
    if (singleStockAccDistResponse) {
        if (meta) meta.source = "deterministic";
        return sanitizeReply(singleStockAccDistResponse);
    }
    const isAnalyticalQuery = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|اشتريت|خسران|نازل)/i.test(userMessage);
    const needsGuidanceResponse = plan.guidance_intent;
    const deterministic = toolResults.length === 0 && !needsGuidanceResponse && !isAnalyticalQuery
        ? buildDeterministicResponse(userMessage, plan, toolResults, sessionState)
        : null;
    if (deterministic) {
        if (meta) meta.source = "deterministic";
        return deterministic;
    }
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        if (meta) meta.source = "deterministic";
        const requestedDate = plan.entities.requested_date;
        return requestedDate
            ? `لا توجد بيانات موثقة لهذا الطلب بتاريخ ${requestedDate}. لم أستخدم تاريخاً آخر حتى لا أخلط بين البيانات.`
            : "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference, sessionState,
        correctionPrompt
    );

    const result = await callResponderLlm(messages, apiKeys, false, requestedModel);
    if (result.response) {
        if (meta) meta.source = "llm";
        let reply = sanitizeReply(appendVerifiedWebSources(result.response, toolResults));
        // Hybrid: append deterministic scan table after LLM qualitative analysis
        const scanTableHtml = buildDeterministicTechnicalScanResponse(userMessage, plan, toolResults);
        if (scanTableHtml && !reply.includes("|---|")) {
            reply = reply + "\n\n---\n" + scanTableHtml;
        }
        return appendLiveSessionNotices(reply, toolResults);
    }
    if (meta) {
        meta.source = "deterministic";
        meta.degraded = true;
    }
    const detReply = sanitizeReply(buildDeterministicResponse(userMessage, plan, toolResults, sessionState) || "عذراً، لم أتمكن من إنشاء الرد.");
    return appendLiveSessionNotices(detReply, toolResults);
}

function appendLiveSessionNotices(reply: string, toolResults: ToolResult[]): string {
    const stockResults = toolResults.filter(r => r.tool === "get_stock" && r.data?.symbol);
    const hasLiveFailed = stockResults.some(r => r.data?.live_refresh_failed === true);
    if (hasLiveFailed && !reply.includes("تعذر جلب السعر المباشر")) {
        return reply + "\n\n> ⚠️ **ملاحظة:** تم إجراء محاولة لتحديث بيانات السهم لحظياً من جلسة التداول، ولكن تعذر جلب السعر المباشر حالياً بسبب بطء الاستجابة. تم الاعتماد على آخر إغلاق رسمي مسجل. سيتم تحديث جميع البيانات تلقائياً بعد إغلاق الجلسة بساعة، أو يمكنك المحاولة لاحقاً.";
    }
    return reply;
}

export async function* generateV2Stream(
    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number },
    apiKeys: string[],
    requestedModel?: string,
    sessionState?: SessionState | null,
    correctionPrompt?: string,
    meta?: ResponderMeta
): AsyncGenerator<string, void, unknown> {
    const forcedDeterministic = plan.service_degraded_message
        ? buildDeterministicResponse(userMessage, plan, toolResults, sessionState)
        : null;
    if (forcedDeterministic) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(forcedDeterministic);
        return;
    }
    if (visionContext && visionContext.symbols.length === 0 && toolResults.length === 0) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(buildVisionUncertaintyResponse(visionContext));
        return;
    }
    const webSearchResponse = buildWebSearchResponse(userMessage, plan, toolResults);
    if (webSearchResponse) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(webSearchResponse);
        return;
    }
    const newsResponse = buildDeterministicNewsResponse(userMessage, plan, toolResults);
    if (newsResponse) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(newsResponse);
        return;
    }
    const ytdRanking = buildYtdMarketRankingResponse(userMessage, plan, toolResults);
    if (ytdRanking) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(ytdRanking);
        return;
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(fastAdvisor);
        return;
    }
    const dailyHistory = buildDailyChangeHistoryResponse(userMessage, plan, toolResults);
    if (dailyHistory) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(dailyHistory);
        return;
    }
    const singleStockAccDistResponse = buildSingleStockAccumulationDistributionResponse(userMessage, plan, toolResults);
    if (singleStockAccDistResponse) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(singleStockAccDistResponse);
        return;
    }

    const isAnalyticalQueryRegex = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|مكمل|مستمر|جلسه|جلسة|غدا|غداً|اشترى|اشتري|اشتريت|خسران|نازل|عادله|عادلة|تقييم|قيمته|تسوى|تساوي|أهداف|اهداف|احتفاظ|خروج|دخول|بيجمع|ينطلق|مؤشر|مؤشرات|اخبار|أخبار|إيه|ايه|هل|فين|مين|مسح|شروط|\?|؟)/i;
    const isAnalyticalQuery = isAnalyticalQueryRegex.test(userMessage) || userMessage.trim().split(/\s+/).length > 4;
    const needsGuidanceResponse = plan.guidance_intent;
    const deterministic = toolResults.length === 0 && !needsGuidanceResponse && !isAnalyticalQuery
        ? buildDeterministicResponse(userMessage, plan, toolResults, sessionState)
        : null;
    if (deterministic) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(deterministic);
        return;
    }
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(plan.entities.requested_date
            ? `لا توجد بيانات موثقة لهذا الطلب بتاريخ ${plan.entities.requested_date}. لم أستخدم تاريخاً آخر حتى لا أخلط بين البيانات.`
            : "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.");
        return;
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference, sessionState,
        correctionPrompt
    );


    const result = await callResponderLlm(messages, apiKeys, true, requestedModel);
    if (result.streamGen) {
        try {
            let completeResponse = "";
            for await (const token of result.streamGen) completeResponse += token;
            let safeResponse = sanitizeReply(appendVerifiedWebSources(completeResponse, toolResults));
            // Hybrid: append deterministic scan table after LLM qualitative analysis
            const scanTableMd = buildDeterministicTechnicalScanResponse(userMessage, plan, toolResults);
            if (scanTableMd && !safeResponse.includes("|---|")) {
                safeResponse = safeResponse + "\n\n---\n" + scanTableMd;
            }
            if (safeResponse) {
                if (meta) meta.source = "llm";
                yield appendLiveSessionNotices(safeResponse, toolResults);
                return;
            }
        } catch (streamErr: any) {
            console.warn(`[Responder] Stream consumption failed: ${streamErr?.message || streamErr}`);
            // The deterministic response below uses the already-fetched tool data.
        }
    }

    if (meta) {
        meta.source = "deterministic";
        meta.degraded = true;
    }
    yield appendLiveSessionNotices(
        sanitizeReply(buildDeterministicResponse(userMessage, plan, toolResults, sessionState)
            || "عذراً، يبدو أن هناك ضغطاً على خدمة الذكاء الاصطناعي حالياً. يرجى إعادة إرسال رسالتك من جديد."),
        toolResults
    );
}

function buildVisionUncertaintyResponse(vision: VisionContext): string {
    const uncertainty = vision.uncertainties.length > 0
        ? ` السبب: ${vision.uncertainties.join(" ")}`
        : "";
    return `لم أجد في الصورة بيانات مالية مرئية مؤكدة يمكن تحويلها إلى تحليل سهم. لم أستخدم أي رمز أو رقم غير واضح حتى لا أختلق بيانات.${uncertainty}`;
}

export function buildFastConversationalAdvisorResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[],
    sessionState?: SessionState | null
): string | null {
    if (toolResults.some(r => r.tool === "get_price_history" && (Array.isArray(r.data?.market_period_ranking) || Array.isArray(r.data?.market_ytd_ranking)))) {
        return null;
    }
    const normMsg = userMessage.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    const guidanceIntent = plan.guidance_intent;

    const hasSpecificSymbols = Boolean(plan.entities?.symbols?.length);

    // 0. Terms Explanation Query
    const isSpecificLiquidityQuery = /(سيوله|سيولة).{0,30}(ازاي|إزاي|كيف|طريقة|طريقه|علامات|بعد|دخل|عرف)/i.test(normMsg) || /(ازاي|إزاي|كيف|طريقة|طريقه|علامات).{0,30}(سيوله|سيولة|دخلت)/i.test(normMsg);
    if (isSpecificLiquidityQuery) {
        return null; // Yield to LLM for customized expert explanation of post-session liquidity indicators
    }

    if (!hasSpecificSymbols && (guidanceIntent === "terms_explainer" || isTermsDefinitionRequest(userMessage))) {
        const wantsAccumulation = /(تجميع|التجميع)/i.test(normMsg);
        const wantsDistribution = /(تصريف|التصريف)/i.test(normMsg);
        const wantsAssembly = /(جمعيه|جمعية|عموميه|عمومية)/i.test(normMsg);
        const wantsMacd = /(macd|الـ\s*macd)/i.test(normMsg);

        if (!wantsAccumulation && !wantsDistribution && !wantsAssembly && !wantsMacd) {
            return null; // Return null if it's a specific question so LLM generates a tailored response
        }

        const sections: string[] = [];

        if (wantsAccumulation) {
            sections.push("**التجميع:** شراء تدريجي بكميات ملحوظة مع بقاء السعر متماسكاً نسبياً. قد يسبق حركة صاعدة، لكنه لا يضمنها.");
            sections.push("");
        }

        if (wantsAssembly) {
            sections.push("**الجمعية العمومية:** اجتماع المساهمين لمناقشة النتائج والتوزيعات وانتخاب مجلس الإدارة والتصويت على القرارات الرئيسية.");
            sections.push("");
        }

        if (wantsDistribution) {
            sections.push("**التصريف:** بيع تدريجي بكميات ملحوظة، غالباً مع ضعف قدرة السعر على مواصلة الصعود. هو علامة حذر وليس تأكيداً لهبوط قادم.");
            sections.push("");
        }

        if (wantsMacd) {
            sections.push("**مؤشر MACD:** يقارن متوسطين متحركين لقراءة اتجاه الزخم. التقاطع الصاعد إيجابي والتقاطع الهابط سلبي، ويُفضّل تأكيدهما بالسعر والحجم.");
            sections.push("");
        }

        return sections.join("\n");
    }

    if (!hasSpecificSymbols && guidanceIntent === "product_explainer") {
        const mentionsThndr = /(ثاندر|ثندر|thndr)/i.test(normMsg);
        const mentionsFund = /(صندوق|صناديق|دخل ثابت|عائد يومي|شهاده|وديعه|حساب توفير|سوق المال)/i.test(normMsg);
        if (mentionsThndr || mentionsFund) {
            return [
                "أنا مساعد متخصص في تحليل أسعار ومؤشرات البورصة المصرية فقط.",
                "لا أملك بيانات أو وصولاً لمنتجات التطبيقات المالية مثل صناديق ثاندر أو غيره من صناديق الاستثمار أو أدوات الدخل الثابت، لذلك لا أستطيع تقييمها أو مقارنتها أو إعطاء توصيات بشأنها.",
                "لو عندك سهم أو قطاع معين في البورصة المصرية، أقدر أحلله لك بناءً على البيانات المتاحة."
            ].join("\n");
        }
    }

    if (!hasSpecificSymbols && guidanceIntent === "allocation" && /(ثاندر|ثندر|thndr|صندوق|صناديق|دخل ثابت|عائد يومي|شهاده|وديعه|حساب توفير|سوق المال)/i.test(normMsg)) {
        return [
            "أنا مساعد متخصص في تحليل أسعار ومؤشرات البورصة المصرية فقط.",
            "لا أملك بيانات أو وصولاً لمنتجات التطبيقات المالية مثل صناديق ثاندر أو غيره من صناديق الاستثمار أو أدوات الدخل الثابت، لذلك لا أستطيع تقييمها أو مقارنتها أو إعطاء توصيات بشأنها.",
            "لو عندك سهم أو قطاع معين في البورصة المصرية، أقدر أحلله لك بناءً على البيانات المتاحة."
        ].join("\n");
    }

    const allocationBetweenNamedStocks = guidanceIntent === "allocation"
        && plan.entities.symbols.length >= 2
        && /(احط|اوزع|قسم|استثمر).{0,30}(مين|فيهم|بينهم|الاتنين|السهمين)/i.test(normMsg);
    if (allocationBetweenNamedStocks) {
        const stocks = toolResults.filter(result => result.tool === "get_stock" && result.data?.symbol);
        const comparison = stocks.map(result => {
            const data = result.data;
            const rsi = data.rsi_14 ?? data.rsi;
            const volumeRatio = data.volume_ratio ?? (data.vol_sma20 && data.volume != null ? Number(data.volume) / Number(data.vol_sma20) : null);
            const facts = [
                rsi != null ? `RSI ${Number(rsi).toFixed(1)}` : null,
                volumeRatio != null ? `الحجم ${Number(volumeRatio).toFixed(2)}x من المتوسط` : null,
                data.change_pct != null ? `تغير الجلسة ${Number(data.change_pct) >= 0 ? "+" : ""}${Number(data.change_pct).toFixed(2)}%` : null
            ].filter(Boolean).join("، ");
            return `- ${data.symbol}: ${facts || "البيانات المتاحة لا تكفي للمفاضلة"}.`;
        });
        return [
            `المبلغ المسجل ${sessionState?.investment_budget ? `${sessionState.investment_budget.toLocaleString("ar-EG")} جنيه` : "غير محدد"}، لكن لا يصح أن أختار نسبة بين ${plan.entities.symbols.join(" و")} من جلسة واحدة فقط.`,
            ...comparison,
            "السهم الأعلى زخماً ليس بالضرورة الأنسب إذا كان في تشبع شرائي، والسهم الأهدأ ليس أفضل تلقائياً لمجرد انخفاض RSI.",
            "حدد مدة الاستثمار ومستوى المخاطرة وسعر دخولك إن كنت مالكاً للسهمين؛ بعدها يمكن وضع نطاقات توزيع استرشادية بدلاً من نسبة 60/40 أو 80/20 غير مبررة."
        ].join("\n");
    }

    // 1. Allocation & Product Distribution Queries (e.g. "لو هوزع المبلغ ده، تنصحني بأي نسبة بين الأسهم والصناديق؟")
    const isAllocationRatioQuery = !hasSpecificSymbols && (
        /(توزيع|نسبة|نسبه|اوزع|أوزع|اوزعها|قسم|تقسيم).{0,35}(أسهم|اسهم).{0,35}(صناديق|صندوق|دخل ثابت|ادخار)/i.test(normMsg)
        || /(توزيع|نسبة|نسبه).{0,30}(بين|مابين).{0,30}(أسهم|اسهم|صناديق|صندوق)/i.test(normMsg)
        || (plan.guidance_intent === "allocation" && /(نسبة|نسبه|صناديق|صندوق)/i.test(normMsg))
    );

    if (isAllocationRatioQuery) {
        const budgetStr = sessionState?.investment_budget ? ` لمبلغ ${sessionState.investment_budget.toLocaleString("ar-EG")} جنيه` : "";
        const risk = sessionState?.risk_tolerance;
        if (!risk) {
            return [
                `أقدر أضع إطار توزيع${budgetStr}، لكن نسبة الأسهم لا ينبغي افتراضها قبل معرفة قدرتك على تحمل الهبوط المؤقت.`,
                "حدّد أولاً هل مستوى المخاطرة منخفض أم متوسط أم مرتفع، وهل لديك احتياطي طوارئ منفصل؛ بعدها يمكن عرض نطاق استرشادي مناسب بدلاً من نسبة ثابتة مضللة."
            ].join("\n\n");
        }
        const riskStr = risk === "low" ? "المحافظة" : risk === "high" ? "عالية المخاطر" : "المتوازنة";
        const allocation = risk === "low"
            ? { stocks: 30, fixedIncome: 50, cash: 20 }
            : risk === "high"
                ? { stocks: 70, fixedIncome: 20, cash: 10 }
                : { stocks: 50, fixedIncome: 35, cash: 15 };

        return [
            `بناءً على استراتيجية الاستثمار ${riskStr}${budgetStr}، فهذا إطار مبدئي قابل للتعديل بعد مراعاة التزاماتك واحتياطي الطوارئ:`,
            "",
            "📊 **إطار التوزيع الاسترشادي المقترح:**",
            `1. **${allocation.stocks}% أسهم:** توزع على أكثر من سهم وقطاع، مع دخول متدرج بدل تنفيذ الحصة كاملة في جلسة واحدة.`,
            `2. **${allocation.fixedIncome}% أدوات دخل ثابت / صناديق نقدية:** لتقليل تذبذب المحفظة، بعد مراجعة العائد والرسوم وشروط الاسترداد من المصدر الرسمي.`,
            `3. **${allocation.cash}% سيولة واحتياطي:** يظل خارج المخاطرة السوقية للطوارئ أو الفرص التي تتوافق لاحقاً مع خطتك.`,
            "",
            "هذا توزيع تعليمي وليس نسبة مثالية للجميع؛ إذا لم يكن لديك احتياطي طوارئ منفصل، تكون الأولوية لبنائه قبل زيادة حصة الأسهم.",
            "",
            "الخطوة التالية هي تحديد مدة الاستثمار وقدرتك الفعلية على تحمل هبوط مؤقت قبل تحويل الإطار إلى نطاقات أكثر دقة."
        ].join("\n");
    }

    // 2. Sector Stock Selection & Best Buy Queries (e.g. "طيب أشتري إيه من القطاع ده بناءً على الأرقام الحالية؟")
    const isSectorBuyQuery = /(أشتري|اشتري|ادخل|ترشح|أفضل|افضل|ايه).{0,25}(?:سهم|أسهم|فرصة|فرصه).{0,20}(?:القطاع|قطاع)/i.test(normMsg)
        || /(طيب|طب)?\s*(أشتري|اشتري|ادخل|أدخل)\s*(إيه|ايه|في\s+إيه|في\s+ايه)\s*من\s*(القطاع|قطاع)/i.test(normMsg);
    if ((isSectorBuyQuery || isBestBuyStockQuestion(userMessage)) && !hasSpecificSymbols) {
        const recResult = toolResults.find(r => r.tool === "get_recommendations" || r.tool === "get_signals");
        const recs = Array.isArray(recResult?.data) ? recResult.data : [];
        if (recs.length > 0) {
            return null;
        }

        const sectorResult = toolResults.find(r => r.tool === "get_sector");
        const fairValueScan = toolResults.find(r => r.tool === "get_fair_value_scan");
        const liveStocks = toolResults
            .filter(result => result.tool === "get_stock" && result.data?.symbol)
            .map(result => ({ symbol: result.data.symbol, name: result.data.name, tech: result.data }));
        const stocks = Array.isArray(sectorResult?.data?.stocks)
            ? sectorResult.data.stocks
            : Array.isArray(fairValueScan?.data?.stocks)
                ? fairValueScan.data.stocks
                : liveStocks;

        if (!stocks || stocks.length === 0) {
            const reqDist = fairValueScan?.data?.require_distribution;
            const reqAcc = fairValueScan?.data?.require_accumulation;
            const dir = fairValueScan?.data?.direction;
            const signalStr = reqDist ? "إشارة تصريف" : reqAcc ? "إشارة تجميع" : "";
            const valueStr = dir === "below" ? "تحت القيمة الفنية الوسطية" : dir === "above" ? "فوق القيمة الفنية الوسطية" : "";
            const details = [signalStr, valueStr].filter(Boolean).join(" و");
            return `لا توجد أسهم مطابقة في أحدث مسح متاح حالياً${details ? ` تجمع بين (${details})` : ""}. يمكنك تجربة تعديل معايير البحث أو اختيار قطاع آخر.`;
        }

        let greeting = "بين الأسهم المتاحة في المسح، المقارنة الحالية كالتالي:";
        if (sessionState?.investment_budget || sessionState?.risk_tolerance) {
            greeting = `وفق البيانات الحالية${sessionState.investment_budget ? ` وميزانيتك المسجلة ${sessionState.investment_budget.toLocaleString("ar-EG")} جنيه` : ""}، المقارنة بين الأسهم المتاحة كالتالي:`;
        }

        const levelBySymbol = new Map(toolResults
            .filter(result => result.tool === "get_stock_levels" && result.data?.symbol)
            .map(result => [String(result.data.symbol), result.data]));

        const topStocksList = stocks.slice(0, 5).map((s: any) => {
            const sym = s.symbol;
            const tech = s.tech || s;
            const rawPrice = tech.price ?? tech.close ?? s.close ?? s.price;
            const price = rawPrice != null && Number.isFinite(Number(rawPrice)) ? `${Number(rawPrice).toFixed(2)} جنيه` : "غير متاح";
            const changeVal = tech.change_pct != null ? Number(String(tech.change_pct).replace("%", "")) : 0;
            const changeStr = changeVal !== 0 ? `${changeVal > 0 ? "+" : ""}${changeVal.toFixed(2)}%` : "استقرار";
            const rawRsi = tech.rsi_14 ?? tech.rsi;
            const rsiVal = rawRsi != null && Number.isFinite(Number(rawRsi)) ? Number(rawRsi).toFixed(1) : null;
            const premium = s.premium_pct != null && Number.isFinite(Number(s.premium_pct)) ? Number(s.premium_pct) : null;
            const volumeRatio = s.volume_ratio ?? (tech.vol_ratio != null ? Number(String(tech.vol_ratio).replace("x", "")) : (tech.vol_sma20 && tech.volume != null ? Number(tech.volume) / Number(tech.vol_sma20) : null));
            const accumulationScore = s.accumulation_score ?? s.accumulationScore ?? s.acc_score ?? null;
            const level: any = levelBySymbol.get(String(sym));
            const facts: string[] = [];
            if (rsiVal && Number(rsiVal) >= 45 && Number(rsiVal) <= 68) {
                facts.push(`RSI عند ${rsiVal} ويقع في نطاق زخم متوسط`);
            } else if (rsiVal) {
                facts.push(`RSI عند ${rsiVal}`);
            }
            if (premium !== null) facts.push(`السعر ${premium >= 0 ? "أعلى" : "أقل"} من القيمة الوسطية الفنية بـ ${Math.abs(premium).toFixed(1)}%`);
            if (volumeRatio != null && Number.isFinite(Number(volumeRatio))) facts.push(`حجم التداول ${Number(volumeRatio).toFixed(2)}x من المتوسط`);
            if (accumulationScore != null && Number.isFinite(Number(accumulationScore))) facts.push(`درجة التجميع المسجلة ${Number(accumulationScore).toFixed(1)}`);
            if (level?.support != null && level?.resistance != null) facts.push(`الدعم الحسابي ${Number(level.support).toFixed(2)} والمقاومة ${Number(level.resistance).toFixed(2)} جنيه`);
            if (changeVal !== 0) facts.push(`تغير الجلسة ${changeStr}`);
            const reason = facts.length ? facts.join("، ") : "لا تتوفر مؤشرات كافية لتفسير ترتيبه خارج البيانات المعروضة";

            return `- **${sym}** عند ${price}: ${reason}.`;
        }).join("\n\n");

        const rankedStocks = stocks.map((stock: any) => {
            const tech = stock.tech || stock;
            const rsi = Number(tech.rsi_14 ?? tech.rsi);
            const volumeRatio = Number(String(stock.volume_ratio ?? tech.vol_ratio ?? (tech.vol_sma20 && tech.volume != null ? Number(tech.volume) / Number(tech.vol_sma20) : 0)).replace("x", ""));
            const change = Number(String(tech.change_pct || 0).replace("%", ""));
            const rsiScore = Number.isFinite(rsi) ? (rsi >= 50 && rsi <= 68 ? 3 : rsi >= 45 && rsi < 70 ? 2 : rsi >= 70 ? -1 : 0) : 0;
            const volumeScore = Number.isFinite(volumeRatio) ? Math.min(volumeRatio, 2) : 0;
            return { symbol: stock.symbol, score: rsiScore + volumeScore + Math.max(-1, Math.min(1, change / 5)) };
        }).sort((a: { score: number }, b: { score: number }) => b.score - a.score);
        const bestStockLine = rankedStocks[0]?.symbol
            ? `الأقوى نسبياً الآن هو **${rankedStocks[0].symbol}**؛ توازنه بين الزخم والحجم أفضل من بقية النتائج المتاحة.`
            : null;

        return [
            greeting,
            "",
            bestStockLine || "",
            bestStockLine ? "" : "",
            topStocksList || "• الأسهم الموضحة بالجدول أعلاه تعكس أحدث حركة للسيولة والزخم السعري للقطاع.",
            "",
            "الترتيب نسبي داخل النتائج المتاحة فقط. غياب دعم واضح أو حجم مؤكد يجعل الانتظار أكثر تحفظاً من مطاردة الحركة."
        ].join("\n");
    }

    return null;
}

export function buildDeterministicTechnicalScanResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const techScan = toolResults.find(r => r.tool === "get_technical_scan");
    if (!techScan?.data) return null;

    const data = techScan.data;
    const stocks: any[] = Array.isArray(data.stocks) ? data.stocks : [];
    const presetNameAr = data.preset_name_ar || "الماسح الفني";
    const descAr = data.description_ar || "";
    const dataTime = techScan.data_time || "أحدث جلسة";

    const lines: string[] = [
        `### نتائج ${presetNameAr}`,
        descAr ? `*${descAr}* (جلسة ${dataTime})\n` : `(جلسة ${dataTime})\n`
    ];

    if (stocks.length === 0) {
        lines.push(`لا توجد أسهم تحقق الشروط الدقيقة لهذا الفلتر حالياً في جلسة ${dataTime}.`);
        lines.push(`\nيمكنك تجربة فلتر آخر من قوالب الماسح الفني مثل التقاطع الذهبي لـ MACD أو تدفق الأموال الذكية.`);
        return lines.join("\n");
    }

    lines.push(`تم رصد **${stocks.length} أسهم** تطابق معايير هذا القالب:\n`);
    lines.push("| # | السهم | الاسم | السعر | التغير | RSI | حجم نسبي | تفاصيل فنية أخرى |");
    lines.push("|---|---|---|---|---|---|---|---|");

    stocks.slice(0, 15).forEach((s: any, idx: number) => {
        const changeStr = Number(s.change_pct) >= 0 ? `+${s.change_pct}%` : `${s.change_pct}%`;
        const extraDetails: string[] = [];
        if (s.ema_50 && s.ema_50 !== "N/A") extraDetails.push(`EMA 50: ${s.ema_50}`);
        if (s.ema_200 && s.ema_200 !== "N/A") extraDetails.push(`EMA 200: ${s.ema_200}`);
        if (s.divergence_summary) extraDetails.push(s.divergence_summary);
        const detailText = extraDetails.length > 0 ? extraDetails.join(" ، ") : "-";

        lines.push(`| ${idx + 1} | **${s.symbol}** | ${s.name || s.symbol} | ${s.close} ج.م | ${changeStr} | ${s.rsi || "N/A"} | ${s.r_vol || "1.00"}x | ${detailText} |`);
    });

    lines.push(`\n⚠️ *ملاحظة: هذه البيانات مستخرجة رقمياً من المؤشرات الفنية لجلسة ${dataTime}، وليست توصية شراء أو بيع مباشرة.*`);
    return lines.join("\n");
}

export function buildBothAccumulationDistributionResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const accScan = toolResults.find(r => r.tool === "get_accumulation_stocks");
    const distScan = toolResults.find(r => r.tool === "get_distribution_stocks");
    if (!accScan || !distScan) return null;
    if (plan.entities.symbols.length > 0) return null;

    const accStocks: any[] = Array.isArray(accScan.data?.stocks) ? accScan.data.stocks : [];
    const distStocks: any[] = Array.isArray(distScan.data?.stocks) ? distScan.data.stocks : [];
    const scanDate = accScan.data_time || "أحدث جلسة";

    const lines: string[] = [
        `### ملخص مسح التجميع والتصريف (جلسة ${scanDate})\n`,
        `🟢 **أهم أسهم التجميع المؤسسي (Accumulation):**\n`
    ];

    if (accStocks.length > 0) {
        lines.push("| # | السهم | الاسم | درجة التجميع | حجم السيولة | مرحلة وايكوف |");
        lines.push("|---|---|---|---|---|---|");
        accStocks.slice(0, 8).forEach((s: any, idx: number) => {
            const vol = s.vol_ratio ? `${s.vol_ratio}x` : "-";
            const wyckoff = s.wyckoff_phase || "-";
            lines.push(`| ${idx + 1} | **${s.symbol}** | ${s.name || s.symbol} | ${s.acc_score}/100 | ${vol} | ${wyckoff} |`);
        });
    } else {
        lines.push(`- لا توجد أسهم تجميع مسجلة بدرجات مرتفعة اليوم.`);
    }

    lines.push(`\n🔴 **أهم أسهم التصريف والضغط البيعي (Distribution):**\n`);
    if (distStocks.length > 0) {
        lines.push("| # | السهم | الاسم | درجة التصريف | حجم السيولة | مرحلة وايكوف |");
        lines.push("|---|---|---|---|---|---|");
        distStocks.slice(0, 8).forEach((s: any, idx: number) => {
            const vol = s.vol_ratio ? `${s.vol_ratio}x` : "-";
            const wyckoff = s.wyckoff_phase || "-";
            lines.push(`| ${idx + 1} | **${s.symbol}** | ${s.name || s.symbol} | ${s.dist_score}/100 | ${vol} | ${wyckoff} |`);
        });
    } else {
        lines.push(`- لا توجد أسهم تصريف حاد مسجلة اليوم.`);
    }

    lines.push(`\n⚠️ *البيانات وصفية مستخرجة من تتبع السيولة المؤسسية ونموذج وايكوف وليست توصية شراء أو بيع.*`);
    return lines.join("\n");
}

export function buildSingleStockAccumulationDistributionResponse(
    userMessage: string,
    plan: IntentPlan,
    toolResults: ToolResult[]
): string | null {
    const normMsg = userMessage.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    if (!/(?:تجميع|تصريف|وايكوف|wyckoff)/i.test(normMsg)) return null;

    const singleStock = toolResults.find(result => result.tool === "get_stock" && result.data?.symbol);
    if (!singleStock?.data) return null;

    const data = singleStock.data;
    const wyckoff = data.wyckoff_phase || "غير محدد";
    const accScore = data.acc_score != null ? `${data.acc_score}/100` : "غير متوفر";
    const distScore = data.dist_score != null ? `${data.dist_score}/100` : "غير متوفر";
    const price = data.price ?? "N/A";
    const change = data.change_pct ?? "N/A";
    const rsi = data.rsi_14 ?? "N/A";
    const volRatio = data.vol_ratio ?? "1.00x";

    let verdict = "";
    if (data.acc_score != null && data.dist_score != null) {
        if (data.acc_score >= 50 && data.acc_score > data.dist_score) {
            verdict = `السهم يمر بحالة **تجميع مؤسسي (Accumulation)**، حيث تتفوق درجة التجميع (${accScore}) على درجة التصريف (${distScore}).`;
        } else if (data.dist_score >= 50 && data.dist_score > data.acc_score) {
            verdict = `السهم يواجه **ضغط تصريف بيعي (Distribution)**، حيث تتفوق درجة التصريف (${distScore}) على درجة التجميع (${accScore}).`;
        } else {
            verdict = `حالة السهم متوازنة بين التجميع (${accScore}) والتصريف (${distScore}) دون سيطرة مطلقة لأحدهما.`;
        }
    } else {
        verdict = `حالة وايكوف المسجلة للسهم: **${wyckoff}**.`;
    }

    const priceLine = data.is_live_intraday
        ? `- السعر اللحظي (مباشر من الجلسة): **${price} ج.م** (${change}) 🟢 *(محدث ${data.live_update_time})*`
        : `- السعر الحالي: **${price} ج.م** (${change})`;

    const failNotice = data.live_refresh_failed
        ? `\n\n> ⚠️ **ملاحظة:** تم إجراء محاولة لتحديث بيانات السهم لحظياً من جلسة التداول، ولكن تعذر جلب السعر المباشر حالياً بسبب بطء الاستجابة. تم الاعتماد على آخر إغلاق رسمي مسجل. سيتم تحديث جميع البيانات تلقائياً بعد إغلاق الجلسة بساعة، أو يمكنك المحاولة لاحقاً.`
        : "";

    return [
        `### تحليل التجميع والتصريف لسهم ${data.symbol} (${data.name || data.symbol}):\n`,
        `${verdict}\n`,
        `**المؤشرات الفنية والسيولة:**`,
        priceLine,
        `- مرحلة وايكوف (Wyckoff): **${wyckoff}**`,
        `- درجة التجميع (Accumulation Score): **${accScore}**`,
        `- درجة التصريف (Distribution Score): **${distScore}**`,
        `- حجم التداول النسبي: **${volRatio}** من المتوسط`,
        `- مؤشر القوة النسبية (RSI): **${rsi}**`,
        `\n⚠️ *هذه البيانات وصفية لرصد السيولة المؤسسية وليست توصية مباشرة بالشراء أو البيع.*${failNotice}`
    ].join("\n");
}

export function buildDeterministicResponse(userMessage: string, plan: IntentPlan, toolResults: ToolResult[], sessionState?: SessionState | null): string | null {
    const normMsg = userMessage.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    const asksForAdvice = /(?:انصحني|تنصحني|اعمل ايه|أعمل ايه|شاري|شريت|شريته|معايا بسعر|لو معايا|بمتوسط|رايك|رأيك|ايه العمل|ايه الحل)/i.test(normMsg);
    if (asksForAdvice) {
        return null; // Yield to LLM for customized expert response
    }
    if (plan.unresolved_stock && plan.service_degraded_message) {
        return plan.service_degraded_message;
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) return fastAdvisor;

    // Technical scan templates
    const techScanRes = buildDeterministicTechnicalScanResponse(userMessage, plan, toolResults);
    if (techScanRes) return techScanRes;

    // Both accumulation & distribution
    const bothAccDistRes = buildBothAccumulationDistributionResponse(userMessage, plan, toolResults);
    if (bothAccDistRes) return bothAccDistRes;

    // Single stock accumulation / distribution
    const singleStockAccDistRes = buildSingleStockAccumulationDistributionResponse(userMessage, plan, toolResults);
    if (singleStockAccDistRes) return singleStockAccDistRes;

    const scan = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
    if (scan?.source === "validation" || scan?.data?.validation?.ok === false) {
        const direction = scan.data?.direction === "distribution" ? "التصريف" : "التجميع";
        const symbols = plan.entities.symbols.length ? ` للسهم ${plan.entities.symbols.join(" و")}` : "";
        return `أحدث سجل متاح لمسح ${direction}${symbols} بتاريخ ${scan.data_time}، لكنه قديم ولا يصلح لوصف الحالة الحالية. لم أخلط هذه الإشارة مع مؤشرات التداول الأحدث؛ يلزم تحديث المسح قبل الحكم على وجود ${direction} الآن.`;
    }
    if (scan && scan.data?.stocks && !plan.tools.includes("get_fair_value_scan") && plan.entities.symbols.length === 0) {
        const stocks = scan.data.stocks;
        const direction = scan.data.direction === "distribution" ? "تصريف" : "تجميع";
        const oppositeDirection = scan.data.direction === "distribution" ? "تجميع" : "تصريف";
        const actionAr = scan.data.direction === "distribution" ? "التصريف" : "التجميع";
        const scoreField = scan.data.direction === "distribution" ? "dist_score" : "acc_score";
        const oppScoreField = scan.data.direction === "distribution" ? "acc_score" : "dist_score";
        const consecutiveField = scan.data.direction === "distribution" ? "consecutive_dist_days" : "consecutive_acc_days";

        if (stocks.length === 0) {
            if (!plan.entities?.symbols?.length) {
                return "لا توجد أسهم مطابقة للشروط في أحدث مسح متاح.";
            }
        }

        if (stocks.length > 0) {
        const countWord = stocks.length === 1 ? "سهم واحد" : stocks.length === 2 ? "سهمان" : `${stocks.length} أسهم`;
        const lines = [`المسح الحالي يعرض ${countWord} بإشارة ${actionAr}:`];

        stocks.slice(0, 15).forEach((stock: any) => {
            const score = stock[scoreField];
            const oppScore = stock[oppScoreField] || 0;
            const vol = stock.vol_ratio;
            const consecutiveDays = stock[consecutiveField];
            const wyckoff = stock.wyckoff_phase;
            const rsi = stock.rsi_14;

            const details = [
                `درجة ${actionAr} ${score}/100 مقابل ${oppositeDirection} ${oppScore}/100`,
                vol != null ? `الحجم ${vol}x من المتوسط` : null,
                consecutiveDays != null ? `الإشارة مستمرة ${consecutiveDays} أيام` : null,
                rsi != null ? `RSI ${rsi}` : null,
                wyckoff ? `مرحلة Wyckoff: ${wyckoff}` : null
            ].filter(Boolean);
            lines.push(`- **${stock.symbol}**${stock.name && stock.name !== stock.symbol ? ` (${stock.name})` : ""}: ${details.join("، ")}.`);
        });

        lines.push(`البيانات بتاريخ ${scan.data_time}. الإشارة تصف المسح الفني ولا تكفي وحدها لاتخاذ قرار شراء أو بيع.`);

        return lines.join("\n");
        }
    }
    if (plan.intent === "clarification" && !userMessage.trim() && plan.service_degraded_message) {
        return "تعذر قراءة الصورة المرفقة بوضوح هذه المرة، لذلك لم أستخرج منها أسهماً أو أرقاماً حتى لا أخمّن. أرسل نسخة أوضح أو اكتب اسم السهم وما تريد تحليله، وسأعتمد على السؤال النصي مباشرة.";
    }

    if (plan.intent === "clarification" && /(?:اقوى|أقوى)\s+(?:الاسهم|الأسهم)/i.test(userMessage)) {
        return "تقصد أقوى الأسهم بأي معيار: أعلى ارتفاع في آخر جلسة، أعلى سيولة، أقوى زخم فني، أم أفضل أداء خلال أسبوع؟ حدّد المعيار والفترة حتى لا أخلط بين القوة السعرية والسيولة.";
    }
    const levelResults = toolResults.filter(result => result.tool === "get_stock_levels");
    const stockResults = toolResults.filter(result => result.tool === "get_stock" && result.data?.symbol);
    const compoundNews = toolResults.find(result => result.tool === "get_news");
    const asksForNews = /(?:اخبار|أخبار|خبر(?!ة)|عناوين|news)/i.test(userMessage);
    if (asksForNews && !compoundNews) {
        return "لا توجد نتيجة أخبار موثقة لهذا الطلب في البيانات الحالية، لذلك لن أفترض أن السيولة ارتفعت بسبب أرباح أو عقود أو خبر معين. أستطيع عرض الأخبار فقط عند توفر سجلات أخبار مرتبطة بالقطاع أو الأسهم المطلوبة.";
    }
    if (isUsageLimitQuestion(userMessage)) {
        return "لا أستطيع تأكيد عدد الرسائل المتبقية من سياق السهم السابق. راجع عداد الاستخدام الظاهر في المحادثة، ولن أستخدم بيانات سهم للإجابة عن سؤال الحساب.";
    }
    if (isEarningsDataRequest(userMessage) && plan.entities.symbols.length > 0) {
        return `لا تتوفر لدي حالياً بيانات أرباح موثقة للفترة المطلوبة للسهم ${plan.entities.symbols.join("، ")}. لذلك لن أستبدل سؤال الأرباح بالسعر أو RSI. يمكنني تحليل السعر فنياً، أو عرض الأرباح عند إضافة مصدر قوائم مالية مؤرخ للنظام.`;
    }
    if (stockResults.length >= 2 && /(?:حلل|تحليل|بيانات|مؤشرات|مسح)/i.test(userMessage)) {
        const lines = stockResults.map(result => {
            const data = result.data;
            const level = levelResults.find(item => String(item.data?.symbol || item.symbols?.[0] || "").toUpperCase() === String(data.symbol).toUpperCase())?.data;
            const rsi = Number(data.rsi_14);
            const momentum = Number.isFinite(rsi) ? rsi >= 70 ? "تشبع شرائي" : rsi >= 50 ? "زخم إيجابي" : rsi <= 30 ? "تشبع بيعي" : "زخم محايد" : "الزخم غير متاح";
            return `${data.symbol}: ${data.change_pct ?? "التغير غير متاح"}، RSI ${data.rsi_14 ?? "غير متاح"} (${momentum})، حجم ${data.vol_ratio ?? "غير متاح"}، MACD ${data.macd_signal ?? "غير متاح"}${level?.support != null && level?.resistance != null ? `، دعم ${Number(level.support).toFixed(2)} ومقاومة ${Number(level.resistance).toFixed(2)}` : ""}.`;
        });
        return ["ملخص فني مختصر للبيانات الحالية:", ...lines, "الأرقام وصفية وليست توصية شراء أو بيع."].join("\n");
    }
    const priceHistories = toolResults.filter(result => result.tool === "get_price_history" && result.data?.symbol);
    const forecastRequest = /(توقعات|توقع|متوقع|تقعات|وقعات).{0,35}(?:5|خمس|الخمسه|الخمسة|15|خمستاشر|خمسة عشر).{0,15}(جلسات|جلسه|جلسة|يوم)|(?:5|خمس|الخمسه|الخمسة|15|خمستاشر|خمسة عشر).{0,15}(جلسات|جلسه|جلسة|يوم).{0,35}(توقعات|توقع|متوقع|تقعات|وقعات)/i.test(userMessage);
    const yearEndForecast = /(متوقع|توقع|توقعات|سعر).{0,25}(اخر|آخر|نهايه|نهاية).{0,15}(السنه|السنة|العام)/i.test(userMessage);
    if ((forecastRequest || yearEndForecast) && priceHistories.length > 0) {
        const historyField = forecastRequest && /15|خمستاشر|خمسة عشر/i.test(userMessage) ? "recent_15_sessions" : "recent_5_sessions";
        const lines = priceHistories.flatMap(history => {
            const data = history.data;
            const recent = Array.isArray(data[historyField]) ? data[historyField] : [];
            const closes = recent.map((row: any) => Number(row.close)).filter(Number.isFinite);
            const latestClose = closes[0] ?? Number(data.latest?.close);
            const oldestClose = closes[closes.length - 1];
            const periodChange = closes.length >= 2 && oldestClose !== 0 ? ((latestClose - oldestClose) / oldestClose) * 100 : null;
            const level = levelResults.find(result => String(result.data?.symbol || result.symbols[0]).toUpperCase() === String(data.symbol).toUpperCase())?.data || {};
            const stock = stockResults.find(result => String(result.data?.symbol).toUpperCase() === String(data.symbol).toUpperCase())?.data || {};
            const momentum = periodChange == null ? "الاتجاه غير محسوم لعدم اكتمال البيانات" : periodChange > 2 ? "الاتجاه صاعد" : periodChange < -2 ? "الاتجاه هابط" : "الاتجاه عرضي";
            return [
                `${data.symbol}: ${momentum}${periodChange == null ? "" : `؛ التغير خلال آخر ${closes.length} جلسات ${periodChange >= 0 ? "+" : ""}${periodChange.toFixed(2)}%`}، وآخر إغلاق ${Number(latestClose).toFixed(2)} جنيه بتاريخ ${history.data_time}.`,
                stock.rsi_14 != null || stock.vol_ratio != null ? `- الزخم: RSI ${stock.rsi_14 ?? "غير متاح"}، والحجم ${stock.vol_ratio ?? "غير متاح"} من المتوسط.` : null,
                level.support != null && level.resistance != null ? `- النطاق الفني: دعم ${Number(level.support).toFixed(2)} ومقاومة ${Number(level.resistance).toFixed(2)} جنيه.` : null
            ].filter(Boolean) as string[];
        });
        lines.push(`لا يمكن تحديد سعر مؤكد ${yearEndForecast ? "حتى نهاية السنة" : "للفترة المطلوبة"}؛ هذه قراءة اتجاهية مبنية على آخر بيانات وليست توصية شراء أو بيع.`);
        return lines.join("\n");
    }
    const priceHistory = priceHistories[0];
    if (priceHistory?.data?.symbol) {
        const data = priceHistory.data;
        if (isDailyPriceLimitQuestion(userMessage)) {
            const close = data.latest?.close == null ? NaN : Number(data.latest.close);
            if (!Number.isFinite(close)) return `${data.symbol}: \u0644\u0627 \u064a\u062a\u0648\u0641\u0631 \u0622\u062e\u0631 \u0625\u063a\u0644\u0627\u0642 \u0645\u0648\u062b\u0651\u0642 \u0644\u0644\u0633\u0647\u0645\u060c \u0644\u0630\u0644\u0643 \u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0642\u064a\u064a\u0645 \u0642\u0631\u0628\u0647 \u0645\u0646 \u0627\u0644\u062d\u062f \u0627\u0644\u0633\u0639\u0631\u064a \u0627\u0644\u064a\u0648\u0645\u064a.`;
            return `${data.symbol}: \u0622\u062e\u0631 \u0625\u063a\u0644\u0627\u0642 \u0645\u062a\u0627\u062d ${close.toFixed(2)} \u062c\u0646\u064a\u0647 \u0628\u062a\u0627\u0631\u064a\u062e ${priceHistory.data_time}. \u0644\u0627 \u062a\u062d\u062a\u0648\u064a \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u0645\u062a\u0627\u062d\u0629 \u0639\u0644\u0649 \u0627\u0644\u062d\u062f \u0627\u0644\u0633\u0639\u0631\u064a \u0627\u0644\u0641\u0639\u0644\u064a \u0644\u0644\u062c\u0644\u0633\u0629 \u0623\u0648 \u0642\u0648\u0627\u0639\u062f\u0647 \u0627\u0644\u062e\u0627\u0635\u0629 \u0628\u0627\u0644\u0633\u0647\u0645\u060c \u0644\u0630\u0644\u0643 \u0644\u0627 \u064a\u0645\u0643\u0646\u0646\u064a \u062d\u0633\u0627\u0628 \u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0625\u0644\u064a\u0647 \u0628\u0623\u0645\u0627\u0646 \u0623\u0648 \u0627\u0641\u062a\u0631\u0627\u0636 \u0646\u0633\u0628\u0629 \u062b\u0627\u0628\u062a\u0629. \u0631\u0627\u062c\u0639 \u0627\u0644\u062d\u062f \u0627\u0644\u0638\u0627\u0647\u0631 \u0644\u062f\u0649 \u0627\u0644\u0628\u0648\u0631\u0635\u0629 \u0623\u0648 \u0627\u0644\u0648\u0633\u064a\u0637 \u0644\u0647\u0630\u0647 \u0627\u0644\u062c\u0644\u0633\u0629.`;
            const upper = data.upper_limit_20pct == null ? NaN : Number(data.upper_limit_20pct);
            const lower = data.lower_limit_20pct == null ? NaN : Number(data.lower_limit_20pct);
            if (![close, upper, lower].every(Number.isFinite)) {
                return `${data.symbol}: لا يتوفر إغلاق سابق موثق يكفي لحساب المسافة من الحد السعري اليومي. لن أستخدم صفراً أو نسبة افتراضية بدل البيانات الناقصة.`;
            }
            const upperDistance = Number.isFinite(close) && Number.isFinite(upper) ? ((upper - close) / close) * 100 : null;
            const lowerDistance = Number.isFinite(close) && Number.isFinite(lower) ? ((close - lower) / close) * 100 : null;
            return `${data.symbol}: آخر إغلاق ${close.toFixed(2)} جنيه بتاريخ ${priceHistory.data_time}. الحد السعري الحسابي التقريبي وفق ±20% من إغلاق الجلسة السابقة: صعود ${upper.toFixed(2)} جنيه وهبوط ${lower.toFixed(2)} جنيه. السهم بعيد عن حد الصعود بنحو ${upperDistance?.toFixed(1)}% وعن حد الهبوط بنحو ${lowerDistance?.toFixed(1)}%. تحقّق من قواعد وحدود الجلسة الفعلية لدى البورصة/الوسيط لأن النسبة قد تختلف حسب حالة الورقة.`;
        }
        if (/(?:أ|ا)عل[ىي].{0,15}(?:سعر|قم[هة])/i.test(userMessage)) {
            return `${data.symbol}: أعلى سعر مسجل في آخر ${250} جلسة متاحة هو ${Number(data.highest_250_sessions.price).toFixed(2)} جنيه بتاريخ ${data.highest_250_sessions.date}. الفترة محددة بآخر 250 جلسة وليست أعلى سعر تاريخي منذ الإدراج.`;
        }
    }
    const fairValueRequest = /(قيمه عادله|قيمة عادلة|القيمة العادلة|القيمه العادله|fair value|عادله|عادلة)/i.test(userMessage);
    const compoundMessage = /\n|\s+(?:هات|جيب|اعرض|حلل|شوف|قارن|لو\s+كسر)(?:\s|$)|[،,]\s*(?:و\s*)?(?:مين|ايه|إيه|هات|جيب|شوف|حلل)(?:\s|$)/i.test(userMessage);
    const fairValueScan = toolResults.find(result => result.tool === "get_fair_value_scan");
    const isCompoundWithOtherTools = compoundMessage && (levelResults.length > 0 || stockResults.length > 0 || !!compoundNews);
    if (fairValueScan && !isBestBuyStockQuestion(userMessage) && !isCompoundWithOtherTools) {
        const stocks = Array.isArray(fairValueScan.data?.stocks) ? fairValueScan.data.stocks : [];
        const direction = fairValueScan.data?.direction || plan.entities.fair_value_direction || "above";
        const requiresDistribution = Boolean(fairValueScan.data?.require_distribution || plan.entities.require_distribution);
        const requiresAccumulation = Boolean(fairValueScan.data?.require_accumulation || plan.entities.require_accumulation);
        const relation = direction === "below" ? "تحت" : "فوق";
        const relativeWord = direction === "below" ? "أقل" : "أعلى";
        const signalSuffix = requiresDistribution ? " وتحقق إشارة تصريف" : requiresAccumulation ? " وتحقق إشارة تجميع" : "";
        if (fairValueScan.error || fairValueScan.source === "error") {
            return `فهمت أنك تريد تقاطع التداول ${relation} القيمة الوسطية الفنية${requiresAccumulation ? " مع تجميع حديث" : requiresDistribution ? " مع تصريف حديث" : ""}، لكن تعذر إكمال المسح الحالي ضمن المهلة. لم أستخدم قائمة قديمة أو أعلن عدم وجود فرص لأن نتيجة التقاطع لم تكتمل.`;
        }
        if (fairValueScan.source === "validation" || fairValueScan.data?.validation?.ok === false) {
            return `تعذر الاعتماد على بيانات المسح لهذا الطلب لأن البيانات المتاحة لم تجتز فحص الحداثة المطلوب. لم أعرض جدول تجميع قديم بديلاً عن تقاطع الشروط الحالي.`;
        }
        if (!stocks.length) {
            return [
                `فهمت طلبك: تريد أسهماً تحقق تقاطع شرطين معاً (التداول ${relation} القيمة الوسطية الفنية لنطاق 60 جلسة${requiresAccumulation ? " مع وجود تجميع حديث" : requiresDistribution ? " مع وجود تصريف حديث" : ""}).`,
                `بحسب أحدث بيانات تداول متاحة، لا توجد حالياً نتائج موثقة تحقق هذين الشرطين الصارمين معاً بفرز تام في أحدث جلسة.`,
                "💡 للحصول على أفضل الفرص المتاحة حالياً، يمكنك طلب أي من المسحين بشكل مستقل:",
                "1. اكتب: 'هات الأسهم اللي عليها تجميع' لعرض كافة الأسهم ذات التجميع الشرائي النشط.",
                "2. اكتب: 'أرخص الأسهم تحت القيمة الوسطية' لعرض الأسهم المتداولة بأكبر خصم فني عن متوسطها السعري."
            ].join("\n\n");
        }
        const weeklyForecast = /(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع|يصعد).{0,45}(?:الأسبوع|الاسبوع|اسبوع|الأيام الجاية|الايام الجايه|الفترة الجاية|الفتره الجايه)/i.test(userMessage);
        if (weeklyForecast && !requiresDistribution && !requiresAccumulation) {
            const ranked = stocks
                .filter((stock: any) => Number(stock.vol_ratio || 0) >= 1)
                .sort((left: any, right: any) => Number(right.vol_ratio || 0) - Number(left.vol_ratio || 0))
                .slice(0, 5);
            return [
                `لا يمكن ضمان سهم سيرتفع خلال أسبوع، لكن أقوى المرشحين فنياً في أحدث البيانات هم الأسهم المتداولة فوق متوسط نطاق 60 جلسة مع حجم تداول مؤكد:`,
                ...ranked.map((stock: any, index: number) => `${index + 1}. ${stock.symbol}: السعر ${Number(stock.close).toFixed(2)} جنيه، أعلى من القيمة الوسطية بـ ${Math.abs(Number(stock.premium_pct)).toFixed(1)}%، والحجم ${Number(stock.vol_ratio).toFixed(2)}x من المتوسط.`),
                "هذه قائمة مراقبة وليست توقعاً مؤكداً؛ راجع الدعم والمقاومة والزخم قبل أي دخول."
            ].join("\n");
        }
        return [
            `فهمت طلبك: هذه فقط الأسهم التي حققت الشرطين معاً، التداول ${relation} القيمة الوسطية الفنية لنطاق 60 جلسة${signalSuffix}، وفق أحدث تداول متاح:`,
            ...stocks.slice(0, 15).map((stock: any, index: number) => {
                const distribution = requiresDistribution && stock.dist_score != null
                    ? `، درجة التصريف ${Number(stock.dist_score).toFixed(1)}/100`
                    : "";
                const accumulation = requiresAccumulation && stock.acc_score != null ? `، درجة التجميع ${Number(stock.acc_score).toFixed(1)}/100` : "";
                const scanDate = stock.scan_date ? `، إشارة المسح بتاريخ ${stock.scan_date}` : "";
                const volume = stock.vol_ratio != null ? `، الحجم ${Number(stock.vol_ratio).toFixed(2)}x من المتوسط` : "";
                return `${index + 1}. ${stock.symbol}: السعر ${Number(stock.close).toFixed(2)} جنيه، القيمة الوسطية ${Number(stock.midpoint).toFixed(2)} جنيه، ${relativeWord} منها بـ ${Math.abs(Number(stock.premium_pct)).toFixed(1)}%${distribution}${accumulation}${volume}${scanDate}.`;
            }),
            "ابدأ بالمقارنة بين قوة التجميع والسيولة وقرب السعر من الدعم، واتخذ قرار الشراء أو الانتظار وفقاً لتأكيد الإشارة على الرسم البياني.",
            "تنبيه تقييم فني: المقصود هنا قيمة وسطية فنية وليست قيمة عادلة مالية؛ القيمة الجوهرية تحتاج أرباحاً وتدفقات نقدية ومكررات قطاع موثقة."
        ].join("\n");
    }
    if (isFairValueScanRequest(userMessage)
        && !toolResults.some(result => result.tool === "get_fair_value_scan")) {
        const filters = getFairValueFilters(userMessage);
        const condition = filters.require_distribution ? " مع تصريف" : filters.require_accumulation ? " مع تجميع" : "";
        return `تعذر تنفيذ مسح الأسهم ${filters.fair_value_direction === "below" ? "تحت" : "فوق"} القيمة الوسطية${condition} لعدم توفر بيانات الأسعار والمسح الفني الكافية ضمن المهلة. لم أستخدم أسماء أو أرقاماً مخمّنة.`;
    }
    if (compoundMessage && (levelResults.length > 0 || stockResults.length > 0 || compoundNews)) {
        const parts: string[] = [];
        for (const result of stockResults) {
            const data = result.data;
            parts.push(`${data.symbol}: السعر ${data.price ?? "غير متاح"} جنيه، التغير ${data.change_pct ?? "غير متاح"}، RSI ${data.rsi_14 ?? "غير متاح"}، نسبة الحجم ${data.vol_ratio ?? "غير متاحة"}.`);
        }
        for (const result of levelResults) {
            const data = result.data || {};
            parts.push(data.support == null ? `${data.symbol || result.symbols[0]}: لا توجد بيانات مستويات كافية.` : `${data.symbol}: الدعم ${Number(data.support).toFixed(2)} جنيه، المقاومة ${Number(data.resistance).toFixed(2)} جنيه.`);
        }
        if (fairValueRequest) parts.push(...buildTechnicalValuationLines(stockResults, levelResults));
        if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(userMessage)) {
            for (const result of levelResults) {
                const data = result.data || {};
                if (data.support != null) parts.push(`${data.symbol}: كسر الدعم عند ${Number(data.support).toFixed(2)} جنيه يزيد المخاطر الفنية، ويحتاج تأكيد إغلاق وحجم قبل اتخاذ قرار.`);
            }
        }
        if (compoundNews) {
            const newsItems = Array.isArray(compoundNews.data) ? compoundNews.data : [];
            parts.push(newsItems.length
                ? `الأخبار: تم العثور على ${newsItems.length} سجل للأسهم ${compoundNews.symbols.join("، ")}.`
                : `الأخبار: لا توجد أخبار مسجلة حالياً للأسهم ${compoundNews.symbols.join("، ") || "المطلوبة"}.`);
        }
        const scan = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
        if (scan?.data?.stocks?.length) {
            const requestedSet = new Set((plan.entities.symbols || []).map(s => s.toUpperCase()));
            const relevantStocks = requestedSet.size > 0
                ? scan.data.stocks.filter((stock: any) => requestedSet.has(String(stock.symbol || "").toUpperCase()))
                : scan.data.stocks;
            if (relevantStocks.length > 0) {
                parts.push(`التجميع/التصريف: ${relevantStocks.slice(0, 8).map((stock: any) => stock.symbol).join("، ")}.`);
            }
        }
        
        const fairValueScan = toolResults.find(result => result.tool === "get_fair_value_scan");
        if (fairValueScan) {
            const stocks = Array.isArray(fairValueScan.data?.stocks) ? fairValueScan.data.stocks : [];
            const direction = fairValueScan.data?.direction || plan.entities.fair_value_direction || "above";
            const requiresDistribution = Boolean(fairValueScan.data?.require_distribution || plan.entities.require_distribution);
            const requiresAccumulation = Boolean(fairValueScan.data?.require_accumulation || plan.entities.require_accumulation);
            const relation = direction === "below" ? "تحت" : "فوق";
            const relativeWord = direction === "below" ? "أقل" : "أعلى";
            const signalSuffix = requiresDistribution ? " وتحقق إشارة تصريف" : requiresAccumulation ? " وتحقق إشارة تجميع" : "";
            
            if (stocks.length > 0) {
                parts.push(`مسح التقييم الفني (الأسهم ${relation} القيمة الوسطية لنطاق 60 جلسة${signalSuffix}):`);
                stocks.slice(0, 15).forEach((stock: any, index: number) => {
                    const distribution = requiresDistribution && stock.dist_score != null
                        ? `، درجة التصريف ${Number(stock.dist_score).toFixed(1)}/100`
                        : "";
                    const accumulation = requiresAccumulation && stock.acc_score != null ? `، درجة التجميع ${Number(stock.acc_score).toFixed(1)}/100` : "";
                    const scanDate = stock.scan_date ? `، إشارة المسح بتاريخ ${stock.scan_date}` : "";
                    const volume = stock.vol_ratio != null ? `، الحجم ${Number(stock.vol_ratio).toFixed(2)}x من المتوسط` : "";
                    parts.push(`${index + 1}. ${stock.symbol}: السعر ${Number(stock.close).toFixed(2)} جنيه، القيمة الوسطية ${Number(stock.midpoint).toFixed(2)} جنيه، ${relativeWord} منها بـ ${Math.abs(Number(stock.premium_pct)).toFixed(1)}%${distribution}${accumulation}${volume}${scanDate}.`);
                });
            } else {
                parts.push(`مسح التقييم الفني: لم أجد أي أسهم تحقق تقاطع شرطين معاً (التداول ${relation} القيمة الوسطية لنطاق 60 جلسة${signalSuffix}) في أحدث جلسة.`);
            }
        }
        if (parts.length) return Array.from(new Set(parts)).join("\n");
    }
    if (plan.intent === "general_chat" && toolResults.length === 0) {
        if (/^\s*(?:كمل|كمّل|تابع)\s*[!؟?.]*$/i.test(userMessage)) {
            return "التحليل السابق مكتمل في الملخص والجدول. لن أكرر بيانات سهم واحد أو أضيف تفاصيل غير موثقة؛ اذكر اسم السهم أو المؤشر المطلوب إذا أردت نقطة محددة.";
        }
        if (/^\s*(?:جدع|عاش|تمام|تسلم|شكرا|شكراً|حلو|ممتاز|برافو)\s*[!؟?.]*$/i.test(userMessage)) {
            return "تسلم. المهم أن يظل التحليل مرتبطاً بالبيانات والمخاطر، وليس مجرد اختيار نسبة أو سهم بلا مبرر. لو عندك سهم معين، قارن بين المؤشرات واختر الأقوى.";
        }
        if (/(?:عرف|عرّف|يعني ايه|ما هو|ما هي).{0,40}(?:التجميع|الجمعيه العموميه|الجمعية العمومية)/i.test(userMessage)) {
            return [
                "التجميع: مرحلة يزيد فيها الشراء تدريجياً، وقد تظهر في صورة أحجام تداول مرتفعة وتماسك سعري وامتصاص للبيع. لا يمكن إثباتها من الحجم وحده، ويجب ربطها بالسعر والاتجاه وعدة جلسات.",
                "الجمعية العمومية: اجتماع رسمي لمساهمي الشركة لمناقشة واعتماد أمور مثل القوائم المالية، توزيعات الأرباح، انتخاب مجلس الإدارة، أو قرارات زيادة رأس المال وفق جدول الأعمال والإفصاح الرسمي.",
                "الفرق: التجميع مفهوم فني متعلق بسلوك التداول، أما الجمعية العمومية فهي حدث قانوني وإداري للشركة."
            ].join("\n\n");
        }
        if (/(معنديش|ما عنديش).{0,20}(خبره|خبرة).{0,40}(اسهم|الاسهم)|(?:ابني|اعمل|ابدأ).{0,25}(محفظه|محفظة)|صناديق.{0,20}(دخل ثابت|عائد يومي)|(?:اول|أول)\s+يوم.{0,20}(البورصه|البورصة)|عايز\s+افهم\s+اعمل/i.test(userMessage)) {
            return [
                "بما إنك مبتدئ وكل أموالك حالياً في أدوات دخل ثابت، الأفضل تتعلم وتنتقل للأسهم تدريجياً بدل نقل المحفظة كلها مرة واحدة.",
                "1. احتفظ أولاً بصندوق طوارئ يغطي 3 إلى 6 أشهر من مصروفاتك في أداة منخفضة المخاطر وسهلة السحب.",
                "2. حدد مدة الاستثمار وقدرتك على تحمل هبوط مؤقت؛ الأموال المطلوبة خلال سنة أو سنتين لا تناسبها مخاطرة أسهم مرتفعة.",
                "3. ابدأ بنسبة صغيرة تجريبية من الأموال المخصصة للاستثمار، ووزع الشراء على دفعات زمنية بدلاً من الدخول في يوم واحد.",
                "4. نوّع بين قطاعات وشركات مختلفة، ولا تجعل سهماً واحداً أو قطاعاً واحداً يمثل معظم جزء الأسهم.",
                "5. قبل شراء أي سهم راجع الربحية والديون والتدفقات النقدية والتقييم والسيولة، ثم ضع سبباً واضحاً للشراء وحداً للمخاطرة.",
                "6. قارن العائد المتوقع بعد المخاطر بعائد صندوق الدخل الثابت؛ ارتفاع العائد المحتمل في الأسهم يأتي مع احتمال خسارة وتقلب أعلى.",
                "يمكنك البدء تعليمياً بطلب: تحليل قطاع البنوك، مقارنة COMI وEAST، أو شرح مكرر الربحية والقيمة الدفترية. هذه خطوات تعليمية عامة وليست توزيعاً شخصياً لمحفظتك."
            ].join("\n");
        }
        if (/(انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(userMessage)) {
            return "أنا مساعد EGX Bots لتحليل بيانات البورصة المصرية. أستخدم نموذج الذكاء الاصطناعي الذي تختاره من واجهة الشات لصياغة الرد، مع الاعتماد على بيانات النظام وأدواته عند تحليل الأسهم.";
        }
        if (/(انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(userMessage)) {
            return "أنا مساعد EGX Bots لتحليل بيانات البورصة المصرية. أستخدم نموذج الذكاء الاصطناعي الذي تختاره من واجهة الشات لصياغة الرد، مع الاعتماد على بيانات النظام وأدواته عند تحليل الأسهم.";
        }
        if (/(ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم)/i.test(userMessage)) {
            return "أهلاً بك. أقدر أساعدك في تحليل سهم، مقارنة سهمين، أخبار الشركات، أو تحليل قطاعات البورصة المصرية باستخدام البيانات المتاحة.";
        }
        const decision = /(أبيع|ابيع|ابيعه|أبيعه|بيع|أشتري|اشتري|شراء|احتفظ|أحتفظ|اخرج|أخرج)/i.test(userMessage);
        const isOwnedStockAdviceQuery = /(اشتريت.*نزل|نازل بيا|خسران|اشتريت.*سهم|اشتريت اليوم|اشتريت.*ونزل)/i.test(userMessage);
        if (decision || isOwnedStockAdviceQuery) {
            return [
                "أفهم تماماً صعوبة موقفك وشعورك بالضغط من هذه الخسارة، ولكن القرار الاستثماري ينبغي أن يقوم على قواعد إدارة المخاطر وتحديد السهم بدقة وليس على الانفعال.",
                "",
                "💡 **مبادئ هامة لإدارة الموقف الحالي:**",
                "1. **حدد اسم أو رمز السهم:** أرجو تزويدي برمز أو اسم السهم الذي تمتلكه (مثل: COSG، أسمنت سيناء، أو ABUK) لنستخرج فوراً مستويات الدعم والمقاومة الفنية ونحدد نقاط الارتداد المتوقعة.",
                "2. **قواعد الحفاظ على رأس المال:** لا تسمح لصفقة واحدة بأكل أرباح الشهور السابقة. إن لم تكن قادراً على تحمل المزيد من المخاطرة، فإن الحفاظ على ما تبقى من رأس المال هو الأولوية.",
                "3. **احتمالية الارتداد الفني:** الارتداد عادة ما يحدث عند ملامسة مناطق دعم حسابية قوية أو وصول المؤشر لمناطق تشبع بيعي (RSI أقل من 30) مع زيادة في أحجام التداول الإيجابية.",
                "",
                "يرجى كتابة اسم أو رمز السهم لنزودك فوراً بقراءته الفنية المحدثة ومستويات الدعم الخاصة به."
            ].join("\n");
        }
        return null;
    }
    if (/\bCLOUD\b/i.test(userMessage) && /(قارن|مقارن|مقارنة|سهم|سعر|تحليل|اخبار|أخبار)/i.test(userMessage)) {
        return "CLOUD المذكور كمنتج ادخاري داخل تطبيق Thndr ليس رمز سهم EGX موثقاً في قاعدة بيانات الأسهم، لذلك لا تصح مقارنته فنياً بسهم COMI. يمكن مقارنة العائد والسيولة والمخاطر والرسوم بين المنتج وصندوق دخل ثابت، أو مقارنة COMI بسهم بورصة آخر.";
    }

    if (/(سبب|ليه|لماذا).{0,20}(هبوط|يهبط|نزل|ينزل)/i.test(userMessage) && stockResults.length > 0) {
        const data = stockResults[0].data;
        const levelData = levelResults.find(result => String(result.data?.symbol || result.symbols[0]).toUpperCase() === String(data.symbol).toUpperCase())?.data || {};
        const news = toolResults.find(result => result.tool === "get_news");
        const newsItems = Array.isArray(news?.data) ? news.data : [];
        const stockHeadlines = newsItems.filter((item: any) => String(item.symbol || "").toUpperCase() === String(data.symbol).toUpperCase() && (item.title || item.headline));
        const factors = [
            data.change_pct != null ? `التغير الأخير ${data.change_pct}` : null,
            data.vol_ratio != null ? `نسبة الحجم ${data.vol_ratio} من المتوسط` : null,
            data.rsi_14 != null ? `RSI ${data.rsi_14}` : null,
            levelData.resistance != null && Number(data.price) < Number(levelData.resistance) ? `السعر ما زال أسفل المقاومة الحسابية ${Number(levelData.resistance).toFixed(2)} جنيه` : null,
        ].filter(Boolean);
        return [
            stockHeadlines.length
                ? `الأخبار المسجلة لا تثبت وحدها سبب الهبوط. أحدث العناوين المتاحة: ${stockHeadlines.slice(0, 3).map((item: any) => item.title || item.headline).join("؛ ")}.`
                : `لا توجد في البيانات الحالية أخبار مؤكدة تثبت سبباً جوهرياً لهبوط ${data.symbol}.`,
            factors.length ? `أقرب التفسيرات الفنية المتاحة: ${factors.join("، ")}.` : "لا تكفي البيانات الكمية لتفسير الحركة بدقة.",
            "انخفاض حجم التداول لا يثبت وحده وجود خبر سلبي؛ قد يكون تراجعاً فنياً أو ضعف طلب مؤقت. راجع أخبار الشركة والقوائم المالية قبل استنتاج سبب أساسي.",
            levelData.support != null ? `الدعم الحسابي ${Number(levelData.support).toFixed(2)} جنيه؛ كسره بإغلاق وحجم أعلى من المعتاد يزيد المخاطر الفنية، لكنه لا يحدد سبب الهبوط وحده.` : null,
            "هذا تحليل للبيانات المتاحة وليس توصية بيع أو شراء."
        ].filter(Boolean).join("\n");
    }

    const news = toolResults.find(result => result.tool === "get_news");
    if (news && stockResults.length === 0 && levelResults.length === 0) {
        const items = Array.isArray(news.data) ? news.data : [];
        const rangeLabel = plan.entities.requested_start_date && plan.entities.requested_end_date
            ? ` من ${plan.entities.requested_start_date} إلى ${plan.entities.requested_end_date}`
            : " الحالية";
        if (items.length === 0 && !(compoundMessage && (stockResults.length || levelResults.length))) {
            return `لا توجد أخبار أو بيانات معنويات مسجلة خلال الفترة${rangeLabel}${news.symbols.length ? ` للأسهم ${news.symbols.join("، ")}` : ""}.`;
        }
        const headlines = items.filter((item: any) => item?.title).slice(0, 5);
        const sentiment = items.filter((item: any) => item?.sentiment_score != null).slice(0, 3);
        const lines = [`تم العثور على ${items.length} سجل أخبار ومعنويات من قاعدة البيانات خلال الفترة${rangeLabel}.`];
        headlines.forEach((item: any) => lines.push(`- ${item.symbol || "السهم"}: ${item.title} (${String(item.published_at || item.date || "").slice(0, 10)})`));
        sentiment.forEach((item: any) => lines.push(`- معنويات ${item.symbol}: ${Number(item.sentiment_score) > 0.15 ? "إيجابية" : Number(item.sentiment_score) < -0.15 ? "سلبية" : "محايدة"}، عدد الأخبار ${item.news_count || 0}.`));
        return lines.join("\n");
    }

    const recommendations = toolResults.find(result => result.tool === "get_recommendations" || result.tool === "get_signals");
    if (recommendations) {
        const rows = Array.isArray(recommendations.data) ? recommendations.data : [];
        if (rows.length === 0) return recommendations.error
            ? `${recommendations.error} لا أعرض إشارة قديمة أو متناقضة على أنها توصية حالية.`
            : "لا توجد إشارات تاريخية مسجلة يمكن تقييمها حالياً.";
        const evaluated = rows.filter((row: any) => row.return_pct != null);
        const profitable = evaluated.filter((row: any) => Number(row.return_pct) > 0).length;
        const average = evaluated.length ? evaluated.reduce((sum: number, row: any) => sum + Number(row.return_pct), 0) / evaluated.length : null;
        return [
            "هذه إشارات فنية تاريخية مسجلة بالنظام وليست توصيات جديدة.",
            `تم تقييم ${evaluated.length} من ${rows.length} إشارة مقابل آخر سعر متاح: ${profitable} رابحة غير محققة و${evaluated.length - profitable} خاسرة غير محققة.`,
            average == null ? "لا يتوفر سعر حالي كافٍ لحساب العائد." : `متوسط العائد الحسابي غير الموزون: ${average >= 0 ? "+" : ""}${average.toFixed(2)}%. لا يشمل عمولات أو أوزان المحفظة.`,
            ...rows.slice(0, 10).map((row: any) => row.return_pct == null ? `- ${row.symbol}: السعر الحالي غير متاح.` : `- ${row.symbol}: الدخول ${row.entry_price}، الحالي ${row.current_price}، العائد ${row.return_pct >= 0 ? "+" : ""}${Number(row.return_pct).toFixed(2)}%، ${row.status}.`),
            "بلوغ الهدف أو وقف الخسارة يحتاج بيانات أسعار تغطي الفترة كاملة؛ العائد هنا مقارنة بآخر سعر متاح فقط."
        ].join("\n");
    }

    const historical = toolResults.find(result => result.tool === "get_historical_facts");
    if (plan.intent === "historical_recall" && historical?.data?.prior_response) {
        const prior = String(historical.data.prior_response);
        const symbol = historical.symbols[0] || "السهم المشار إليه";
        const price = prior.match(/(?:السعر|price)\s*(?:(?:=|:)\s*)?([0-9]+(?:\.[0-9]+)?)/i)?.[1];
        if (price) return `آخر سعر موثق ظهر في الرد السابق للسهم ${symbol} كان ${price} جنيه. هذه قيمة تاريخية من رد سابق وليست سعراً حياً.`;
        return `وجدت رداً سابقاً موثقاً للسهم ${symbol}، لكن السعر غير ظاهر بشكل قابل للاستخراج منه. لا أستطيع اختراع قيمة غير موجودة.`;
    }

    const levels = levelResults[0];
    if (levels && /(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(userMessage)) {
        const data = levels.data || {};
        if (data.support == null) return `لا توجد بيانات كافية لتحديد دعم حسابي للسهم ${data.symbol || levels.symbols[0]}.`;
        return `إذا أغلق ${data.symbol || levels.symbols[0]} أسفل الدعم الحسابي ${Number(data.support).toFixed(2)} جنيه، فهذا يزيد المخاطر الفنية ولا يضمن استمرار الهبوط. راجع حجم مركزك وحد الخسارة الذي يناسب تحملك، وانتظر تأكيد الإغلاق والحجم بدلاً من الاعتماد على كسر لحظي. هذه قراءة فنية وليست أمراً بالبيع.`;
    }
    if (levelResults.length && /(مقاوم|مقوام|دعم|support|resistance)/i.test(userMessage)) {
        const lines = levelResults.map(result => {
            const data = result.data || {};
            return data.support == null || data.resistance == null
                ? `${data.symbol || result.symbols[0]}: لا توجد بيانات سعرية كافية لحساب الدعم والمقاومة.`
                : `${data.symbol}: الدعم الحسابي ${Number(data.support).toFixed(2)} جنيه، المقاومة الحسابية ${Number(data.resistance).toFixed(2)} جنيه، والإغلاق ${Number(data.close).toFixed(2)} جنيه بتاريخ ${result.data_time} (${data.lookback_sessions} جلسة).`;
        });
        return [...lines, "هذه مستويات نطاقية حسابية وليست ضماناً لحركة السعر أو توصية بيع وشراء."].join("\n");
    }

    const decision = /(أبيع|ابيع|ابيعه|أبيعه|بيع|أشتري|اشتري|شراء|احتفظ|أحتفظ|اخرج|أخرج)/i.test(userMessage);
    const isOwnedStockAdviceQuery = /(اشتريت.*نزل|نازل بيا|خسران|اشتريت.*سهم|اشتريت اليوم|اشتريت.*ونزل)/i.test(userMessage);
    const entryTiming = /(ينصح|داخل|دخول|ادخل|أدخل|بكره|بكرة|يصحح|تصحيح|مستهدف|هدف|اخر الاسبوع|آخر الأسبوع|المحفظه|المحفظة|مليون)/i.test(userMessage);
    const stockData = toolResults.filter(result => result.tool === "get_stock" && result.data?.symbol);
    const riskQuestion = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskQuestion && stockData.length > 0) {
        const scan = toolResults.find(result => result.tool === "get_distribution_stocks");
        const data = stockData[0].data;
        const scanRow = scan?.data?.scan_rows?.find((row: any) => String(row.symbol).toUpperCase() === String(data.symbol).toUpperCase());
        const unitText = (value: unknown, unit: string) => `${String(value).replace(new RegExp(`\\${unit}+$`), "")}${unit}`;
        const requestedLoss = userMessage.match(/(?:اكتر|أكتر|اكثر|أكثر|من)?\s*(\d+(?:\.\d+)?)\s*%?/i)?.[1];
        const riskFactors = [
            data.change_pct != null ? `التغير الأخير ${unitText(data.change_pct, "%")}` : null,
            data.vol_ratio != null ? `نسبة الحجم ${unitText(data.vol_ratio, "x")}` : null,
            data.rsi_14 != null ? `RSI ${data.rsi_14}` : null,
            scanRow?.dist_score != null ? `درجة التصريف المسجلة ${scanRow.dist_score}/100` : null,
            scanRow?.consecutive_dist_days != null ? `أيام التصريف المتتالية ${scanRow.consecutive_dist_days}` : null
        ].filter(Boolean);
        return [
            `نعم، من الناحية النظرية يمكن أن يخسر ${data.symbol}${requestedLoss ? ` أكثر من ${requestedLoss}%` : " أكثر"}؛ لا توجد بيانات تضمن سقفاً للخسارة أو تنفيه.`,
            riskFactors.length ? `عوامل الخطر الظاهرة في البيانات: ${riskFactors.join("، ")}.` : "لا توجد عوامل كمية كافية في البيانات الحالية لتقدير احتمال الخسارة.",
            "وجود إشارة تصريف أو هبوط سابق يرفع الحذر، لكنه لا يتنبأ بنسبة هبوط محددة. استخدم مستوى المخاطر وخطة وقف الخسارة الخاصة بك، فهذا ليس توصية استثمارية."
        ].join("\n");
    }
    if (decision && stockData.length > 0) {
        const levelData = levels?.data;
        const compoundScan = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
        const compoundScanStocks = Array.isArray(compoundScan?.data?.stocks) ? compoundScan.data.stocks.slice(0, 8) : [];
        const scanDirection = compoundScan?.tool === "get_distribution_stocks" ? "التصريف" : "التجميع";
        const lines = stockData.map(result => {
            const data = result.data;
            return `- ${data.symbol}: السعر الحالي ${data.price} جنيه، التغير ${data.change_pct}، RSI ${data.rsi_14}، MACD ${data.macd_signal}، نسبة الحجم ${data.vol_ratio}.`;
        });
        const levelSymbol = levelData?.symbol || levels?.symbols?.[0] || stockData[0]?.data?.symbol;
        return [
            "لا أستطيع اتخاذ قرار البيع بدلاً منك، لكن يمكن ربط القرار بالمستويات السعرية الفعلية.",
            ...lines,
            levelData?.support != null && levelData?.resistance != null
                ? `الدعم الحسابي (لسهم ${levelSymbol}) ${Number(levelData.support).toFixed(2)} جنيه، والمقاومة الحسابية ${Number(levelData.resistance).toFixed(2)} جنيه، محسوبان من آخر ${levelData.lookback_sessions} جلسة حتى ${levels?.data_time}. كسر الدعم قد يزيد المخاطر، والاقتراب من المقاومة قد يستدعي مراجعة خطتك أو جني جزء من الربح حسب تحملك للمخاطر.`
                : "لا توجد بيانات سعرية كافية لحساب دعم ومقاومة يمكن الاستناد إليها، لذلك لن أحدد سعراً للبيع.",
            "هذه قراءة فنية وليست توصية بيع أو شراء.",
            compoundScanStocks.length ? "" : null,
            compoundScanStocks.length ? `أبرز أسهم ${scanDirection} حسب المسح المؤرخ ${compoundScan?.data_time}:` : null,
            ...compoundScanStocks.map((stock: any) => `- ${stock.symbol}: درجة ${scanDirection} ${stock[compoundScan?.tool === "get_distribution_stocks" ? "dist_score" : "acc_score"] ?? "غير متاحة"}/100، نسبة الحجم ${stock.vol_ratio ?? "غير متاحة"}x.`)
        ].filter(Boolean).join("\n");
    }
    if ((decision || isOwnedStockAdviceQuery) && stockData.length === 0) {
        return [
            "أفهم تماماً صعوبة موقفك وشعورك بالضغط من هذه الخسارة، ولكن القرار الاستثماري ينبغي أن يقوم على قواعد إدارة المخاطر وتحديد السهم بدقة وليس على الانفعال.",
            "",
            "💡 مبادئ هامة لإدارة الموقف الحالي:",
            "1. حدد اسم أو رمز السهم: أرجو تزويدي برمز أو اسم السهم الذي تمتلكه (مثل: COSG، أسمنت سيناء، أو ABUK) لنستخرج فوراً مستويات الدعم والمقاومة الفنية ونحدد نقاط الارتداد المتوقعة.",
            "2. قواعد الحفاظ على رأس المال: لا تسمح لصفقة واحدة بأكل أرباح الشهور السابقة. إن لم تكن قادراً على تحمل المزيد من المخاطرة، فإن الحفاظ على ما تبقى من رأس المال هو الأولوية.",
            "3. احتمالية الارتداد الفني: الارتداد عادة ما يحدث عند ملامسة مناطق دعم حسابية قوية أو وصول المؤشر لمناطق تشبع بيعي (RSI أقل من 30) مع زيادة في أحجام التداول الإيجابية.",
            "",
            "يرجى كتابة اسم أو رمز السهم لنزودك فوراً بقراءته الفنية المحدثة ومستويات الدعم الخاصة به."
        ].filter(Boolean).join("\n");
    }
    if (entryTiming && stockData.length > 0) {
        const levelMap = new Map(levelResults.map(result => [String(result.data?.symbol || result.symbols[0]).toUpperCase(), result.data || {}]));
        const lines = stockData.flatMap(result => {
            const data = result.data;
            const levelData = levelMap.get(String(data.symbol).toUpperCase()) || {};
            const rsi = Number(data.rsi_14);
            const volRatio = Number(String(data.vol_ratio ?? "").replace(/x$/i, ""));
            const isExtended = Number.isFinite(rsi) && rsi >= 70;
            return [
                `${data.symbol}: السعر ${data.price} جنيه، التغير ${data.change_pct}، RSI ${data.rsi_14}، ونسبة الحجم ${data.vol_ratio}.`,
                isExtended ? `- مخاطرة مرتفعة نسبياً: تشبع شرائي مرتفع${Number.isFinite(volRatio) && volRatio > 1.5 ? " وحجم أعلى من المتوسط" : ""}.` : "- لا توجد إشارة كمية مؤكدة على تصحيح أو صعود خلال أسبوع.",
                levelData.support != null && levelData.resistance != null ? `- الدعم الحسابي ${Number(levelData.support).toFixed(2)} جنيه، والمقاومة الحسابية الحالية ${Number(levelData.resistance).toFixed(2)} جنيه؛ المقاومة مستوى اختبار وليست مستهدفاً جديداً مضموناً.` : "- لا تتوفر مستويات كافية لهذا السهم."
            ];
        });
        return [
            ...lines,
            "لا توجد بيانات مستقبلية موثقة تسمح بحساب قيمة المحفظة في نهاية الأسبوع، لذلك لن أفترض عائداً أو سعراً مستهدفاً.",
            "الدخول بالمبلغ كله في ثلاثة أسهم مرتفعة الزخم يرفع مخاطر التركّز والتوقيت؛ هذه قراءة مخاطر وليست توصية شراء أو توزيع محفظة."
        ].join("\n");
    }

    const comparison = toolResults.find(result => result.tool === "get_comparison");
    if (comparison?.data?.sym1 && comparison?.data?.sym2) {
        const entries = [comparison.data.sym1, comparison.data.sym2];
        const describe = (entry: any, fallback: string) => {
            const symbol = entry.info?.symbol || fallback;
            const price = entry.price?.close ?? "غير متاح";
            const change = entry.tech?.change_pct ?? "غير متاح";
            const rsi = entry.tech?.rsi_14 ?? "غير متاح";
            const ratio = entry.tech?.volume && entry.tech?.vol_sma20 ? Number(entry.tech.volume) / Number(entry.tech.vol_sma20) : null;
            return `- ${symbol}: السعر ${price} جنيه، التغير ${change}%، RSI ${rsi}${ratio != null ? `، حجم التداول ${ratio.toFixed(2)}x من المتوسط` : ""}.`;
        };
        const dateLabel = plan.entities.requested_date
            ? `مقارنة مباشرة من البيانات المتاحة بتاريخ ${plan.entities.requested_date}:`
            : "مقارنة مباشرة من أحدث بيانات متاحة:";
        const missing = entries
            .map((entry, index) => ({ entry, symbol: comparison.symbols[index] }))
            .filter(({ entry }) => !entry.price && !entry.tech)
            .map(({ symbol }) => symbol);
        const missingNote = missing.length > 0
            ? `لا توجد بيانات مسجلة لـ ${missing.join(" و")} في قاعدة البيانات لهذا التاريخ؛ لم أستخدم تاريخاً آخر.`
            : "ارتفاع RSI يعكس قوة الزخم فقط ولا يكفي منفرداً لاتخاذ قرار.";
        return [dateLabel, describe(entries[0], comparison.symbols[0]), describe(entries[1], comparison.symbols[1]), missingNote].join("\n");
    }

    const sectorLiquidity = toolResults.find(result => result.tool === "get_sector_liquidity");
    if (sectorLiquidity) {
        const sectors = Array.isArray(sectorLiquidity.data?.sectors) ? sectorLiquidity.data.sectors : [];
        if (sectors.length === 0) return sectorLiquidity.data?.requested_sector
            ? `لا توجد بيانات حجم وسعر مكتملة لقطاع ${sectorLiquidity.data.requested_sector} بتاريخ ${sectorLiquidity.data_time}.`
            : `لا توجد بيانات حجم وسعر مكتملة تكفي لمقارنة سيولة القطاعات بتاريخ ${sectorLiquidity.data_time}.`;
        const top = sectors[0];
        const formatMillions = (value: number) => `${(Number(value) / 1_000_000).toFixed(2)} مليون جنيه`;
        const sectorNameAr = (value: unknown): string => ({
            "Finance": "البنوك والخدمات المالية",
            "Process Industries": "الصناعات التحويلية",
            "Distribution Services": "خدمات التوزيع واللوجستيات",
            "Consumer Non-Durables": "الأغذية والسلع الاستهلاكية",
            "Industrial Services": "الخدمات الصناعية",
            "Producer Manufacturing": "التصنيع والإنتاج",
            "Non-Energy Minerals": "مواد البناء والتعدين",
            "Consumer Durables": "العقارات والسلع المعمرة",
            "Technology Services": "التكنولوجيا والاتصالات",
            "Transportation": "النقل والشحن",
            "Utilities": "المرافق العامة",
            "Energy Minerals": "البترول والطاقة"
            ,"Health Technology": "التكنولوجيا الصحية والأدوية"
            ,"Health Services": "الخدمات الصحية"
            ,"Commercial Services": "الخدمات التجارية"
            ,"Consumer Services": "خدمات المستهلكين"
            ,"Retail Trade": "تجارة التجزئة"
            ,"Electronic Technology": "الإلكترونيات والتقنية"
            ,"Communications": "الاتصالات والإعلام"
            ,"Miscellaneous": "متنوع"
        }[String(value)] || String(value));
        const activeSectors = sectors.filter((sector: any) => Number(sector.average_volume_ratio) >= 1);
        const strongestActive = [...activeSectors].sort((left: any, right: any) => Number(right.average_volume_ratio) - Number(left.average_volume_ratio))[0];
        const requestedSectors = Array.isArray(sectorLiquidity.data?.requested_sectors) ? sectorLiquidity.data.requested_sectors : [];
        if (/(?:ليه|لماذا|سبب|ايه اللي|إيه اللي).{0,30}(?:السيول|السيوله|سيوله).{0,30}(?:عالي|عاليه|مرتفع|زادت)|(?:السيول|السيوله|سيوله).{0,30}(?:ليه|لماذا|سبب)/i.test(userMessage)) {
            return [
                `قطاع ${sectorNameAr(top.sector)} سجل متوسط حجم ${top.average_volume_ratio == null ? "غير متاح" : `${Number(top.average_volume_ratio).toFixed(2)}x`} وقيمة تداول تقديرية ${formatMillions(top.traded_value)} بتاريخ ${sectorLiquidity.data_time}.`,
                "هذا يثبت أن أحجام التداول أعلى من متوسطها، لكنه لا يثبت سبب الارتفاع وحده.",
                "تحديد السبب يحتاج أخباراً أو إفصاحات موثقة مرتبطة بأسهم القطاع؛ لا يجوز افتراض نتائج أعمال أو عقود من بيانات الحجم فقط."
            ].join("\n");
        }
        if (sectorLiquidity.data?.requested_sector) {
            return [
                `سيولة قطاع ${sectorNameAr(top.sector)} بلغت نحو ${formatMillions(top.traded_value)} بتاريخ ${sectorLiquidity.data_time}، محسوبة من ${top.stock_count} سهم متاح البيانات.`,
                top.average_volume_ratio != null ? `متوسط نسبة الحجم لأسهم القطاع: ${Number(top.average_volume_ratio).toFixed(2)}x.` : null,
                sectorLiquidity.data?.excluded_sectors?.length ? `تم استبعاد: ${sectorLiquidity.data.excluded_sectors.join(" و")} من المقارنة.` : null,
                "الحساب تقديري على أساس السعر × حجم التداول، وليس توصية شراء أو بيع."
            ].filter(Boolean).join("\n");
        }
        if (requestedSectors.length > 1) {
            return [
                `مقارنة السيولة بين ${requestedSectors.join(" و")} بتاريخ ${sectorLiquidity.data_time}:`,
                ...sectors.map((sector: any, index: number) => `${index + 1}. ${sectorNameAr(sector.sector)}: ${formatMillions(sector.traded_value)}، متوسط الحجم ${sector.average_volume_ratio == null ? "غير متاح" : `${Number(sector.average_volume_ratio).toFixed(2)}x`}، عبر ${sector.stock_count} سهم.`),
                sectors.length < requestedSectors.length ? "بعض القطاعات المطلوبة لم تتوفر لها بيانات تصنيف وحجم مكتملة في الجلسة الحالية." : null,
                "الأفضل هنا يعني الأقوى سيولة في الجلسة فقط، وليس الأفضل استثمارياً أو الأقل مخاطرة."
            ].filter(Boolean).join("\n");
        }
        return [
            describeDatedFallback(plan.entities.requested_date, sectorLiquidity.data_time),
            `السيولة الأوضح بتاريخ ${sectorLiquidity.data_time} كانت في قطاع ${sectorNameAr(top.sector)}: نحو ${formatMillions(top.traded_value)} عبر ${top.stock_count} سهم متاح البيانات.`,
            ...sectors.slice(1, 5).map((sector: any, index: number) => `${index + 2}. ${sectorNameAr(sector.sector)}: ${formatMillions(sector.traded_value)} عبر ${sector.stock_count} سهم.`),
            strongestActive ? `للمراقبة مع السيولة النشطة، يبرز قطاع ${sectorNameAr(strongestActive.sector)} بمتوسط حجم ${Number(strongestActive.average_volume_ratio).toFixed(2)}x؛ أما ${sectorNameAr(top.sector)} فهو الأكبر بالقيمة، ومتوسط الحجم فيه ${Number(top.average_volume_ratio).toFixed(2)}x.` : null,
            sectorLiquidity.data?.excluded_sectors?.length ? `تم استبعاد: ${sectorLiquidity.data.excluded_sectors.join(" و")} من المقارنة.` : null,
            "لا أستطيع اختيار سهم بعينه من ترتيب القطاعات وحده؛ راجع أسهم القطاع المرشح على حدة قبل أي دخول."
        ].filter(Boolean).join("\n");
    }

    const sectorList = toolResults.find(result => result.tool === "get_sector_list");
    if (sectorList) {
        const sectors = Array.isArray(sectorList.data?.sectors) ? sectorList.data.sectors : [];
        if (sectors.length === 0) return "لا توجد أسماء قطاعات مسجلة حالياً في بيانات الشركات.";
        const sectorNames: Record<string, string> = {
            Miscellaneous: "متنوع",
            Finance: "بنوك وخدمات مالية",
            Communications: "اتصالات وإعلام",
            "Electronic Technology": "إلكترونيات وتكنولوجيا"
        };
        return [`القطاعات المسجلة في بيانات البورصة المصرية (${sectors.length} قطاع):`, ...sectors.map((item: any, index: number) => `${index + 1}. ${sectorNames[item.sector] || item.sector} (${item.stock_count} سهم)`) ].join("\n");
    }

    const sector = toolResults.find(result => result.tool === "get_sector");
    if (sector?.data?.stocks?.length) {
        const stocks = sector.data.stocks as any[];
        const largest = [...stocks].sort((a, b) => Number(b.tech?.close || 0) * Number(b.tech?.volume || 0) - Number(a.tech?.close || 0) * Number(a.tech?.volume || 0))[0];
        if (/اكبر|أكبر|largest|biggest/i.test(userMessage)) {
            const value = Number(largest?.tech?.close || 0) * Number(largest?.tech?.volume || 0);
            return `أكبر سهم في قطاع ${sector.data.sector} من حيث قيمة التداول التقديرية بتاريخ ${sector.data_time} هو ${largest.symbol} (${largest.name || largest.symbol})، بقيمة تقارب ${(value / 1000000).toFixed(2)} مليون جنيه. المقياس المستخدم هو السعر × حجم التداول، وليس القيمة السوقية أو توصية استثمارية.`;
        }
        const advancing = stocks.filter(stock => Number(stock.tech?.change_pct || 0) > 0).length;
        const declining = stocks.filter(stock => Number(stock.tech?.change_pct || 0) < 0).length;
        const strongest = [...stocks].sort((a, b) => Number(b.tech?.change_pct || 0) - Number(a.tech?.change_pct || 0)).slice(0, 3);
        return [
            `تحليل قطاع ${sector.data.sector} مبني على ${stocks.length} سهماً في أحدث بيانات بتاريخ ${sector.data_time}.`,
            `- مرتفعة: ${advancing}، منخفضة: ${declining}.`,
            `- الأفضل أداءً ضمن العينة: ${strongest.map(stock => `${stock.symbol} (${Number(stock.tech?.change_pct || 0).toFixed(2)}%)`).join("، ")}.`,
            "راجع الجدول للتفاصيل؛ المؤشرات الفنية تصف الزخم والسيولة ولا تمثل توصية استثمارية."
        ].join("\n");
    }

    const scanResult = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
    if (scanResult) {
        if (toolResults.some(r => r.source === "performance_evaluator") || /(?:نجح|خسر|نجاح|خسارة|خساره|نسبة\s*نجاح|نسبه\s*نجاح|أداء|اداء|كام\s*في\s*المية|كام\s*%|كم\s*%)/i.test(userMessage)) {
            return null;
        }
        const direction = plan.entities.scan_direction || scanResult.data?.direction || (scanResult.tool === "get_distribution_stocks" ? "distribution" : "accumulation");
        const directionAr = direction === "distribution" ? "التصريف" : "التجميع";
        const scoreField = direction === "distribution" ? "dist_score" : "acc_score";
        const oppositeScoreField = direction === "distribution" ? "acc_score" : "dist_score";
        const consecutiveField = direction === "distribution" ? "consecutive_dist_days" : "consecutive_acc_days";
        const stocks = Array.isArray(scanResult.data?.stocks) ? scanResult.data.stocks as any[] : [];
        const scanRows = Array.isArray(scanResult.data?.scan_rows) ? scanResult.data.scan_rows as any[] : [];

        if (plan.entities.symbols.length > 0) {
            const requestedSymbols = plan.entities.symbols.map(symbol => symbol.toUpperCase());
            const rows = scanRows.filter(item => requestedSymbols.includes(String(item.symbol || "").toUpperCase()));
            const matchedStocks = stocks.filter(item => requestedSymbols.includes(String(item.symbol || "").toUpperCase()));

            if (rows.length > 0 || matchedStocks.length > 0) {
                const symbolSet = rows.length > 0 ? rows : matchedStocks;
                const verdicts = symbolSet.map((row: any) => {
                    const score = Number(row[scoreField] || 0);
                    const oppositeScore = Number(row[oppositeScoreField] || 0);
                    const matchesDirection = row.signal === direction || score >= 50;
                    const oppositeDirectionAr = direction === "distribution" ? "التجميع" : "التصريف";
                    const sym = String(row.symbol || requestedSymbols[symbolSet.indexOf(row)] || "السهم").toUpperCase();
                    const evidence = [
                        `الإشارة المسجلة: ${row.signal || "محايدة"}`,
                        `درجة ${directionAr}: ${row[scoreField] ?? "غير متاحة"}/100`,
                        `درجة ${oppositeDirectionAr}: ${row[oppositeScoreField] ?? "غير متاحة"}/100`,
                        row.vol_ratio != null ? `نسبة الحجم: ${row.vol_ratio}x` : null,
                        row[consecutiveField] != null ? `أيام ${directionAr}: ${row[consecutiveField]}` : null,
                        row.wyckoff_phase ? `مرحلة Wyckoff: ${row.wyckoff_phase}` : null
                    ].filter(Boolean);
                    const verdict = matchesDirection
                        ? `نعم، توجد إشارة ${directionAr} مسجلة على ${sym} في مسح ${scanResult.data_time}.`
                        : row.signal === (direction === "distribution" ? "accumulation" : "distribution") || oppositeScore >= 50
                            ? `لا، أحدث مسح لا يسجل ${directionAr} على ${sym}؛ الإشارة الأقرب هي ${oppositeDirectionAr}.`
                            : `لا توجد إشارة ${directionAr} مؤكدة على ${sym} في أحدث مسح.`;
                    return [verdict, `الدليل: ${evidence.join("، ")}.`].filter(Boolean).join("\n");
                });
                return [describeDatedFallback(plan.entities.requested_date, scanResult.data_time), ...verdicts, "هذه قراءة لمسح فني مسجل وليست توصية شراء أو بيع."].filter(Boolean).join("\n");
            }

            const technicalRow = Array.isArray(scanResult.data?.technical_rows) ? scanResult.data.technical_rows[0] : null;
            const technicalDetails = technicalRow
                ? ` المتاح فنياً: نسبة الحجم ${technicalRow.vol_ratio ?? "غير متاحة"}x، RSI ${technicalRow.rsi_14 ?? "غير متاح"}، MACD ${technicalRow.macd_signal ?? "غير متاح"}.`
                : "";
            const symbol = requestedSymbols[0] || "السهم";
            if (technicalDetails) {
                return `لا توجد بيانات مسح ${directionAr} كافية للسهم ${symbol} بتاريخ ${scanResult.data_time}.${technicalDetails} مؤشرات الحجم وRSI وMACD تصف السيولة والزخم، لكنها لا تثبت ${directionAr} وحدها.`;
            }
            if (plan.entities.requested_date) {
                return `لا توجد بيانات مسح ${directionAr} مسجلة بتاريخ ${plan.entities.requested_date}. لم أستخدم بيانات من تاريخ آخر حتى لا أخلط بين التواريخ.`;
            }
            return [
                `لا توجد إشارات ${directionAr} مطابقة لمعايير المسح في أحدث بيانات متاحة.`,
                "لم أستخدم RSI أو MACD وحدهما لإثبات الإشارة."
            ].join("\n");
        }

        if (stocks.length > 0) {
            const displayed = stocks.slice(0, 8);
            return [
                describeDatedFallback(plan.entities.requested_date, scanResult.data_time),
                `أبرز أسهم ${directionAr} حسب المسح المؤرخ ${scanResult.data_time}:`,
                ...displayed.map(stock => `- ${stock.symbol}: درجة ${directionAr} ${stock[scoreField] ?? "غير متاحة"}/100، نسبة الحجم ${stock.vol_ratio ?? "غير متاحة"}x، ${directionAr} متتالٍ ${stock[consecutiveField] ?? 0} يوم.`),
                "هذه نتائج مسح فني وليست توصية شراء أو بيع."
            ].filter(Boolean).join("\n");
        }

        if (plan.entities.requested_date) {
            return `لا توجد بيانات مسح ${directionAr} مسجلة بتاريخ ${plan.entities.requested_date}. لم أستخدم بيانات من تاريخ آخر حتى لا أخلط بين التواريخ.`;
        }
        return [
            `لا توجد إشارات ${directionAr} مطابقة لمعايير المسح في أحدث بيانات متاحة.`,
            "لم أستخدم RSI أو MACD وحدهما لإثبات الإشارة."
        ].join("\n");
    }

    const stocks = stockData;
    if (stocks.length > 0) {
        const lines = stocks.slice(0, 10).map(result => {
            const data = result.data;
            const facts = [
                data.price != null ? `السعر ${data.price} جنيه` : null,
                data.change_pct != null ? `تغير الجلسة ${data.change_pct}` : null,
                data.rsi_14 != null ? `RSI ${data.rsi_14}` : null,
                data.vol_ratio != null ? `الحجم ${data.vol_ratio} من متوسط 20 جلسة` : null
            ].filter(Boolean);
            return `- **${data.symbol}**${data.name && data.name !== data.symbol ? ` (${data.name})` : ""}: ${facts.join("، ")}.`;
        });
        const levelLines = levelResults.length > 5 ? [] : levelResults
            .map(lvl => {
                const lvlData = lvl?.data;
                const lvlSymbol = lvlData?.symbol || lvl?.symbols?.[0];
                if (lvlData?.support != null && lvlData?.resistance != null) {
                    return `${lvlSymbol}: الدعم ${Number(lvlData.support).toFixed(2)} والمقاومة ${Number(lvlData.resistance).toFixed(2)} جنيه${lvlData.lookback_sessions ? `، محسوبان من آخر ${lvlData.lookback_sessions} جلسة` : ""}.`;
                }
                return null;
            })
            .filter((line): line is string => line !== null);

        const levelFallback = levelResults.length <= 5 && levelLines.length === 0 && levelResults.some(r => r.source === "empty")
            ? "لا توجد بيانات سعرية كافية لحساب الدعم والمقاومة."
            : null;

        const omitted = stocks.length > 10 ? `تم عرض ملخص أول 10 أسهم فقط؛ الجدول المنظم يحتوي على جميع الأسهم المتاحة (${stocks.length}).` : null;
        const opinionLines = stocks.length <= 3 ? stocks.map(result => buildStockOpinion(result, levelResults)) : [];
        return [describeDatedFallback(plan.entities.requested_date, stocks[0]?.data_time), ...lines, ...levelLines, levelFallback, ...opinionLines, ...(fairValueRequest ? buildTechnicalValuationLines(stocks, levelResults) : []), omitted, "هذه أرقام بيانات تداول مباشرة استرشادية من قاعدة البيانات، وليست توصية مباشرة بالشراء أو البيع."].filter(Boolean).join("\n");

    }

    return null;
}

function buildStockOpinion(result: ToolResult, levelResults: ToolResult[]): string {
    const data = result.data || {};
    const symbol = String(data.symbol || result.symbols[0] || "");
    const rsi = Number(data.rsi_14);
    const volume = Number(String(data.vol_ratio || "").replace(/x/i, ""));
    const levels = levelResults.find(level => String(level.data?.symbol || level.symbols[0]).toUpperCase() === symbol.toUpperCase())?.data || {};
    const price = Number(data.price);
    const support = Number(levels.support);
    const resistance = Number(levels.resistance);
    const notes: string[] = [];
    if (Number.isFinite(rsi)) notes.push(rsi >= 70 ? "الزخم مرتفع والسهم في منطقة تشبع شرائي تستدعي الحذر من مطاردة السعر" : rsi <= 30 ? "الزخم ضعيف والسهم قريب من تشبع بيعي، لكن ذلك لا يؤكد الارتداد" : rsi >= 55 ? "الزخم إيجابي بدرجة متوسطة" : rsi <= 45 ? "الزخم ضعيف إلى محايد" : "الزخم متوازن");
    if (Number.isFinite(volume)) notes.push(volume >= 1.5 ? "الحجم أعلى من المتوسط ويدعم أهمية الحركة الحالية" : volume < 0.7 ? "الحجم أقل من المتوسط، لذلك الحركة الحالية تأكيدها ضعيف" : "الحجم قريب من المعتاد");
    if (levels.trading_zone) {
        notes.push(levels.trading_zone);
    } else if ([price, support, resistance].every(Number.isFinite) && resistance > support) {
        const position = (price - support) / (resistance - support);
        const region = position >= 0.8
            ? "منطقة مقاومة وجني أرباح محتمل"
            : position <= 0.25
                ? "منطقة دعم، لكن يلزم ثبات الدعم وحجم داعم"
                : "منطقة حيادية للمراقبة";
        notes.push(region);
    }
    return `${symbol}: ${notes.join("؛ ") || "البيانات الحالية لا تكفي لقراءة فنية موثوقة"}.`;
}

function buildTechnicalValuationLines(stockResults: ToolResult[], levelResults: ToolResult[]): string[] {
    const levelsBySymbol = new Map(levelResults.map(result => [String(result.data?.symbol || result.symbols[0] || "").toUpperCase(), result.data || {}]));
    return stockResults.flatMap(result => {
        const data = result.data || {};
        const symbol = String(data.symbol || result.symbols[0] || "").toUpperCase();
        const levels = levelsBySymbol.get(symbol);
        const values = [Number(data.price), Number(levels?.support), Number(levels?.resistance)];
        if (!values.every(Number.isFinite) || values[2] < values[1]) {
            return [`${symbol}: لا تتوفر بيانات 60 جلسة كاملة لحساب نطاق تقييم فني موثق؛ لم أستخدم نطاق سهم آخر أو قيمة مخمّنة.`];
        }
        const [price, support, resistance] = values;
        const midpoint = (support + resistance) / 2;
        const position = resistance === support ? 50 : ((price - support) / (resistance - support)) * 100;
        return [
            `${symbol}: نطاق التقييم الفني المرجعي ${support.toFixed(2)} إلى ${resistance.toFixed(2)} جنيه، والقيمة الوسطية الحسابية ${midpoint.toFixed(2)} جنيه؛ السعر الحالي عند ${Math.max(0, Math.min(100, position)).toFixed(1)}% من النطاق.`,
            "هذا ليس قيمة عادلة مالية أو توصية؛ القيمة الجوهرية تحتاج أرباحاً وتدفقات نقدية ومكررات قطاع موثقة، ولا يتم اختراعها من RSI أو MACD."
        ];
    });
}

function shouldReturnNoData(
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[]
): boolean {
    if (visionContext || relevantFacts.length > 0) return false;
    if (!plan.needs_live_data && !plan.needs_historical_data) return false;
    return !toolResults.some(result => {
        if (!result.data || result.source === "empty") {
            if ((result.tool === "get_recommendations" || result.tool === "get_signals") && (plan.entities.symbols?.length ?? 0) > 0) {
                return true;
            }
            return false;
        }
        if (result.tool === "search_web" && Array.isArray((result.data as any).results) && (result.data as any).results.length === 0) return false;
        if (Array.isArray(result.data)) {
            if (result.data.length > 0) return true;
            if ((result.tool === "get_recommendations" || result.tool === "get_signals") && (plan.entities.symbols?.length ?? 0) > 0) {
                return true;
            }
            return false;
        }
        return typeof result.data === "object" && Object.keys(result.data).length > 0;
    });
}

export { sanitizeReply } from "./sanitizer";
