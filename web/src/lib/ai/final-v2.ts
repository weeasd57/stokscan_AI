import { IntentPlan, VisionContext, ToolResult, FactSnapshot, SessionState } from "./types";
import { AI_CONFIG } from "./config";
import { describeDatedFallback, getFairValueFilters, getInvestorGuidanceIntent, isBestBuyStockQuestion, isDailyPriceLimitQuestion, isEarningsDataRequest, isFairValueScanRequest, isTermsDefinitionRequest, isUsageLimitQuestion } from "./intent-policy";
import { sanitizeReply } from "./sanitizer";

const MAX_CONTEXT_CHARS = 30000;

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

    const allowedSymbols = Array.from(new Set([
        ...toolResults.flatMap(result => result.symbols || []),
        ...(visionContext?.symbols || []).map(symbol => symbol.symbol)
    ])).filter(Boolean);
    if (allowedSymbols.length > 0) {
        sections.push("=== ALLOWED SYMBOLS ===\n" + allowedSymbols.join(", "));
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
        const liveResults = toolResults.filter(r => r.data_type !== "historical");
        const historicalResults = toolResults.filter(r => r.data_type === "historical");

        if (liveResults.length > 0) {
            sections.push("=== LIVE DATA ===");
            liveResults.forEach(r => {
                sections.push(`الأداة: ${r.tool} | المصدر: ${r.source} | الوقت: ${r.data_time} | نوع: ${r.data_type}`);
                if (typeof r.data === "object" && r.data !== null) {
                    for (const [key, val] of Object.entries(r.data)) {
                        sections.push(`  ${key}: ${formatFactValue(val)}`);
                    }
                }
            });
        }

        if (historicalResults.length > 0) {
            sections.push("=== HISTORICAL DATA ===");
            historicalResults.forEach(r => {
                sections.push(`الأداة: ${r.tool} | المصدر: ${r.source} | الوقت: ${r.data_time} | نوع: ${r.data_type}`);
                if (typeof r.data === "object" && r.data !== null) {
                    for (const [key, val] of Object.entries(r.data)) {
                        sections.push(`  ${key}: ${formatFactValue(val)}`);
                    }
                }
            });
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
    sections.push("- استخدم البيانات التاريخية من === HISTORICAL DATA ===");
    sections.push("- لا تخترع أرقاماً غير موجودة في الأقسام أعلاه");
    sections.push("- لا تعطِ توصيات شراء أو بيع صريحة");
    sections.push("- اذكر مصدر كل رقم (صورة، بيانات حية، بيانات تاريخية)");
    sections.push("- اكتب بعربية واضحة وطبيعية، ويمكن استخدام تعبير مصري خفيف إذا كان مناسباً لأسلوب المستخدم.");
    sections.push("- تحليل السيولة المصاحب: اشرح RSI و MACD ونسبة السيولة من البيانات إن وجدت");
    sections.push("- لا تنشئ جدول Markdown من نفسك؛ سيضيف النظام الجدول المنظم المستخرج من البيانات بعد ردك");
    sections.push("- لا تذكر أو تسرد أي رمز أو اسم شركة غير موجود في مصادر البيانات والجداول أعلاه");
    sections.push("- لا تعيد سرد قوائم الأسهم في النص؛ اشرح الاتجاهات فقط واترك القائمة للجدول المنظم");
    sections.push("- عندما يسأل المستخدم عن سبب هبوط أو صعود أو حركة سهم معين (مثل: ما سبب هبوط/صعود... أو ليه نزل/طلع...):");
    sections.push("  1. إذا كانت هناك أخبار في === LIVE DATA ===، اشرح العوامل والأخبار المرتبطة بالسهم أولاً.");
    sections.push("  2. قدم تحليلاً فنياً ومالياً مفسراً لسبب الحركة (مثل: عمليات جني أرباح فنية طبيعية بعد وصول مؤشر RSI لمناطق تشبع شرائي مرتفعة، أو ضعف السيولة وانخفاض التداول عن المتوسط، أو اختبار مستويات مقاومة وتراجع السعر منها، أو حركات تصحيحية في المسار الصاعد).");
    sections.push("- عندما يسأل المستخدم عن القيمة العادلة أو التقييم لسهم معين (مثل: ما القيمة العادلة لسهم...):");
    sections.push("  1. قدّم تحليلاً شاملاً مستنداً إلى البيانات المتاحة (السعر الحالي، القيمة السوقية، ومستويات الدعم والمقاومة الحسابية).");
    sections.push("  2. وضح نطاق الحركة السعرية ومستويات القيمة العادلة الفنية بين الدعم والمقاومة والقيمة السوقية للشركة.");
    sections.push("  3. اجعل الإجابة مفسرة ومباشرة ترضي استفسار العميل.");
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
    sections.push("- عندما يسأل المستخدم عن وجود توصيات أو إشارات (أو عند العثور على توصيات في البيانات):");
    sections.push("  • إذا توفرت توصيات أو إشارات في بيانات الأدوات (المسترجعة من get_recommendations أو get_signals): قم بعرض تفاصيل كل توصية بوضوح (سعر الدخول، الهدف، وقف الخسارة، ونسبة العائد المتوقعة أو الفعلية والتقييم الفعلي لأدائها).");
    sections.push("  • إذا لم تكن هناك توصيات مسجلة للأسهم المطلوبة في البيانات: ابدأ الرد بإجابة حوارية مباشرة موضحاً أنه لا توجد حالياً توصيات جديدة مسجلة على هذه الأسهم بصفحة التوصيات بالنظام، ثم قدم له قراءة فنية لمستويات الدعم والمقاومة للاسترشاد بها.");
    sections.push("  • 🚫 قاعدة صارمة لتقييم 'الأقوى' أو 'الأفضل' أداءً في التوصيات:");
    sections.push("    1. العائد بقيمة 0.00% يعني تعادلاً تاماً (صفقة راكدة لم تتحرك)، وليس ربحاً ولا ينبغي تسميتها 'مرحلة إيجابية' أو 'صفقة رابحة'.");
    sections.push("    2. الترتيب الصحيح لقوة أداء الصفقات هو: الأعلى ربحاً (الموجب) > الأقرب للتعادل (الأقل خسارة أو 0.00%) > الأكبر خسارة (السالب).");
    sections.push("    3. إذا كانت كل الصفقات/الإشارات خاسرة أو متعادلة، يجب قول ذلك بصدق وصراحة كاملة، مثلاً: 'لا توجد توصية رابحة حالياً من بين الصفقات المسجلة؛ صفقة X متعادلة بـ 0.00%، بينما صفقات Y و Z تسجل خسائر غير محققة بنسبة...'");
    sections.push("    4. يمنع تماماً نعت توصية متعادلة بـ 'الأقوى فنياً' أو 'مرحلة إيجابية' لمجرد أن النسبة صفر أو موجب رمزياً، دون مقارنتها بباقي الصفقات.");
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

    sections.push("=== USER REQUEST ===\n" + (userMessage || "(بدون رسالة)"));

    if (correctionPrompt) {
        sections.push("⚠️ SYSTEM CORRECTION ALERT:\n" + correctionPrompt);
    }

    let contextText = sections.join("\n\n");
    if (contextText.length > MAX_CONTEXT_CHARS) {
        contextText = `...\n\n[تم اقتطاع السياق القديم - تجاوز الحد الأقصى]\n\n` + contextText.slice(-MAX_CONTEXT_CHARS);
    }

    const today = new Date().toISOString().split("T")[0];

    const lengthRule = (plan.intent === "stock_analysis" || plan.intent === "general_chat")
        ? "أجب مباشرة في فقرة قصيرة أو نقطتين إلى أربع نقاط حسب عدد الأرقام المطلوبة، من دون افتتاحية محفوظة أو حشو."
        : "أجب مباشرة وبقدر التفصيل الذي يحتاجه السؤال؛ اجمع الأرقام المتصلة في جمل طبيعية ولا تحوّل كل حقل إلى سطر ثابت.";

    const systemPrompt = `أنت الخبير والمحلل الفني الاحترافي للبورصة المصرية (EGX Bots). اليوم: ${today}.
دورك تقديم قراءة فنية موضوعية ومباشرة تعتمد حكراً على الأرقام الحقيقية في البيانات.

قواعد تحليل وتغطية الأسهم الصارمة:
1. ${lengthRule}
2. يجب تغطية ومقارنة جميع الأسهم المذكورة في البيانات أدناه وعدم تجاهل أي سهم منها.
3. قواعد القراءة الفنية للمؤشرات:
   - RSI أكبر من أو يساوي 70: منطقة تشبع شرائي (Overbought) وتخفيف/جني أرباح، وتعتبر مرتفعة المخاطر للشراء.
   - RSI بين 50 و 68: منطقة زخم صاعد إيجابي وآمن (Bullish Momentum)، وتعتبر الأفضل فنيّاً إذا رافقها حجم تداول جيد فوق المتوسط.
   - RSI بين 40 و 49: منطقة حيادية استقرار.
   - نسبة الحجم (Volume Ratio): أكبر من 1.0x تعني تداولاً كثيفاً فوق المتوسط، وأقل من 1.0x تعني تداولاً أقل من المتوسط.
4. سلامة اللغة والموضوعية:
   - اكتب بلغة عربية فصحى سليمة 100% وبدون أخطاء إملائية أو ركيكة (يمنع استخدام عبارات مثل "يوصي بنا" أو "أن نستثمر").
   - اذكر الجانب الفني لكل سهم وموقعه الموضوعي باختصار شديد. في حالة الاستعلام عن وجود توصيات أو صفقات بالاسم، اعرض تفاصيل التوصية المتوفرة (سعر الدخول، الهدف، وقف الخسارة، ونسبة العائد الفعلي)؛ خلاف ذلك اذكر الجانب الفني دون تقديم أوامر شراء صريحة.`;

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
            const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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

async function callAgentRouterApi(
    modelName: string,
    messages: { role: string; content: any }[],
    stream = false
): Promise<{ response: string | null }> {
    const key = process.env.AGENT_ROUTER_API_KEY || process.env.AGENTROUTER_API_KEY;
    if (!key) return { response: null };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
        const res = await fetch(AI_CONFIG.api.agentRouterBaseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
                "x-api-key": key
            },
            signal: controller.signal,
            body: JSON.stringify({ model: modelName, messages, temperature: 0.15, max_tokens: AI_CONFIG.limits.responseMaxTokens, stream })
        });
        if (!res.ok) return { response: null };
        const data = await res.json();
        return { response: data.choices?.[0]?.message?.content?.trim() || null };
    } catch {
        return { response: null };
    } finally {
        clearTimeout(timeoutId);
    }
}

const NVIDIA_RESPONDER_MODELS = [
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "meta/muse-glimmer-30b"
];

// Reasoning models spend part of max_tokens on reasoning_content — a small
// budget yields empty content. Give them a bigger budget and longer timeout;
// nemotron-lightning additionally gets reasoning_effort capped so it stops
// dumping deliberation into content.
const NVIDIA_MODEL_TUNING: Record<string, { maxTokens: number; timeoutMs: number; reasoningEffort?: string }> = {
    "nvidia/nemotron-3.5-lightning-30b-a3b": { maxTokens: 2500, timeoutMs: 12000, reasoningEffort: "none" },
    "meta/muse-glimmer-30b": { maxTokens: 2500, timeoutMs: 12000 }
};

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
): Promise<{ response: string | null; streamGen?: AsyncGenerator<string>; provider: "nvidia" | "none" }> {
    const nvidiaKeys = Array.from(new Set([
        ...apiKeys,
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_SECONDARY_API_KEY,
        process.env.NVIDIA_NIM_API_KEY
    ].filter((k): k is string => Boolean(k))));

    // 1) النموذج المختار من الواجهة له الأولوية
    if (requestedModel) {
        const tuning = NVIDIA_MODEL_TUNING[requestedModel];
        const n = await callNvidiaApi(requestedModel, messages, nvidiaKeys, stream, tuning?.maxTokens, tuning?.timeoutMs, tuning?.reasoningEffort);
        if (n.response || n.streamGen) return { ...n, provider: "nvidia" };
        console.warn(`[Responder] Requested model ${requestedModel} unavailable — using auto chain`);
    }

    // 2) السلسلة التلقائية على NVIDIA NIM
    if (Date.now() < nvidiaCooldownUntil) {
        console.warn("[Responder] NVIDIA NIM in congestion cooldown — skipping to deterministic fallback");
    } else {
    for (const model of NVIDIA_RESPONDER_MODELS) {
        if (nvidiaKeys.length === 0) break;
        const tuning = NVIDIA_MODEL_TUNING[model];
        const nvidia = await callNvidiaApi(model, messages, nvidiaKeys, stream, tuning?.maxTokens, tuning?.timeoutMs, tuning?.reasoningEffort);
        if (nvidia.response || nvidia.streamGen) return { ...nvidia, provider: "nvidia" };
        if (nvidia.aborted) {
            nvidiaCooldownUntil = Date.now() + 60_000;
            console.warn(`[Responder] NVIDIA NIM congested (timeout on ${model}) — skipping remaining NVIDIA models`);
            break;
        }
        console.warn(`[Responder] NVIDIA model ${model} unavailable — trying next model`);
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
    const lines = text.split("\n");
    const output: string[] = [];
    let inTable = false;

    for (const line of lines) {
        const trimmed = line.trim();
        const tableRow = trimmed.startsWith("|") && trimmed.endsWith("|");
        const separator = tableRow && /^\|[\s:|-]+\|$/.test(trimmed);
        if (tableRow || separator) {
            inTable = true;
            continue;
        }
        if (inTable && !trimmed) {
            inTable = false;
            continue;
        }
        inTable = false;
        output.push(line);
    }

    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
    const normMsg = userMessage.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const asksForNews = /(?:اخبار|أخبار|خبر(?!ه)|عناوين|news)/i.test(normMsg);
    if (!asksForNews) return null;

    const newsResult = toolResults.find(r => r.tool === "get_news");
    if (!newsResult) return null;

    const items = Array.isArray(newsResult.data) ? newsResult.data : [];
    const rangeLabel = plan.entities.requested_start_date && plan.entities.requested_end_date
        ? ` من ${plan.entities.requested_start_date} إلى ${plan.entities.requested_end_date}`
        : " الحالية";

    if (items.length === 0) {
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

    return lines.join("\n");
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
    const newsResponse = buildDeterministicNewsResponse(userMessage, plan, toolResults);
    if (newsResponse) {
        if (meta) meta.source = "deterministic";
        return newsResponse;
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) {
        if (meta) meta.source = "deterministic";
        return fastAdvisor;
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
        return sanitizeReply(removeModelTables(result.response));
    }
    if (meta) {
        meta.source = "deterministic";
        meta.degraded = true;
    }
    return sanitizeReply(buildDeterministicResponse(userMessage, plan, toolResults, sessionState) || "عذراً، لم أتمكن من إنشاء الرد.");
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
    const newsResponse = buildDeterministicNewsResponse(userMessage, plan, toolResults);
    if (newsResponse) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(newsResponse);
        return;
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) {
        if (meta) meta.source = "deterministic";
        yield sanitizeReply(fastAdvisor);
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
            const safeResponse = sanitizeReply(removeModelTables(completeResponse));
            if (safeResponse) {
                if (meta) meta.source = "llm";
                yield safeResponse;
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
    yield sanitizeReply(buildDeterministicResponse(userMessage, plan, toolResults, sessionState)
        || "عذراً، يبدو أن هناك ضغطاً على خدمة الذكاء الاصطناعي حالياً. يرجى إعادة إرسال رسالتك من جديد.");
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
    const normMsg = userMessage.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const guidanceIntent = plan.guidance_intent;

    const hasSpecificSymbols = Boolean(plan.entities?.symbols?.length);

    if (/شريع|sharia/i.test(normMsg)) {
        return [
            "لا أستطيع تسمية أسهم متوافقة مع الشريعة اعتماداً على البيانات الحالية، لأن قاعدة البيانات لا تحتوي تصنيفاً شرعياً موثقاً أو نسب الديون والإيرادات غير المباحة اللازمة للفحص.",
            "للاستثمار طويل الأجل، استخدم قائمة حديثة من هيئة رقابة شرعية أو صندوق شرعي مرخص، ثم أرسل لي رموز الأسهم الموجودة فيها لأقارنها فنياً ومالياً من البيانات المتاحة.",
            "التوافق الشرعي يتغير مع القوائم المالية، لذلك لا يصح افتراضه من اسم الشركة أو قطاعها فقط."
        ].join("\n");
    }

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

export function buildDeterministicResponse(userMessage: string, plan: IntentPlan, toolResults: ToolResult[], sessionState?: SessionState | null): string | null {
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) return fastAdvisor;
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
        return [describeDatedFallback(plan.entities.requested_date, stocks[0]?.data_time), ...lines, ...levelLines, levelFallback, ...opinionLines, ...(fairValueRequest ? buildTechnicalValuationLines(stocks, levelResults) : []), omitted, "هذه قراءة فنية للبيانات المتاحة، وليست توصية شراء أو بيع."].filter(Boolean).join("\n");
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
        if (!result.data) return false;
        if (Array.isArray(result.data)) return result.data.length > 0;
        return typeof result.data === "object" && Object.keys(result.data).length > 0;
    });
}

export { sanitizeReply } from "./sanitizer";
