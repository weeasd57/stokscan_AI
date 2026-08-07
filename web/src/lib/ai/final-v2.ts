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
    sessionState?: SessionState | null
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
    sections.push("- كن مساعداً مالياً ذكياً ومحاوراً مباشراً وموجزاً يجيب بدقة واختصار دون مقدمات ترحيبية إنشائية.");
    sections.push("- عندما يسأل المستخدم سؤالاً عاماً أو مقارنة عن أفضل أسهم للشراء (مثل: مين أدخله بكرة، أشتري إيه، أفضل سهم للشراء):");
    sections.push("  1. ابدأ الإجابة بالتحليل والمقارنة الفنية المباشرة دون مقدمات إنشائية.");
    sections.push("  2. قارن الأسهم المتاحة وحدد الأقوى فنياً أو الأقرب لمستويات الدعم بوضوح واختصار شديد.");
    sections.push("  3. يمنع تماماً كتابة نصائح عامة أو السؤال عن أفق استثماره أو تقسيم السيولة.");
    sections.push("- استخدم بيانات الصورة فقط إذا كانت موجودة في === IMAGE ANALYSIS ===");
    sections.push("- استخدم نتائج الأدوات الحالية من === LIVE DATA ===");
    sections.push("- استخدم البيانات التاريخية من === HISTORICAL DATA ===");
    sections.push("- لا تخترع أرقاماً غير موجودة في الأقسام أعلاه");
    sections.push("- لا تعطِ توصيات شراء أو بيع صريحة");
    sections.push("- اذكر مصدر كل رقم (صورة، بيانات حية، بيانات تاريخية)");
    sections.push("- اكتب بالعربية الفصحى المفهومة والمحاورة الطليقة");
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
    sections.push("  • مؤشر RSI: النسبة بين 50 و 69 (مثل 64) تعني 'منطقة إيجابية محايدة/صاعدة' وليست 'تشبع شرائي'؛ التشبع الشرائي (Overbought) يبدأ حصرياً من 70 فأعلى.");
    sections.push("  • تقريب الأرقام السعرية ومستويات الدعم والمقاومة إلى رقمين عشريين دائماً (مثال: 0.43 جنيه وليس 0.428684 جنيه).");
    sections.push("  • يمنع تماماً تكرار الجمل التمهيدية (مثل: حسناً دعونا نبدأ... حسناً دعونا نبدأ) أو تكرار الفقرات ذات المعنى المماثل في الرد.");
    sections.push("  • يمنع منعاً باتاً تكرار العبارات الانتقالية المتماثلة مثل (من ناحية أخرى، يظهر أن) أو سرد الجمل بصيغ متكررة؛ اكتب بلغة عربية سلسلة ومتنوعة ومترابطة.");
    sections.push("  • يمنع منعاً باتاً استخدام مقدمات أو أسلوب المقالات أو المدونات (مثل: 'مرحباً بكم في هذا المقال' أو 'سنتحدث اليوم عن'). ابدأ مباشرة بالتحليل والإجابة عن سؤال العميل بأسلوب مساعد مالي ذكي ومباشر.");
    sections.push("  • لا تشرح المفاهيم العامة للمؤشرات الفنية (مثل شرح ما هو RSI أو ما هو MACD) بل طبّق الأرقام مباشرة لوصف حالة السهم الحالية، إلا إذا طلب المستخدم تعريفها صراحة.");
    sections.push("  • نسبة الحجم (Volume Ratio / vol_ratio): إذا كانت أقل من 1.0x (مثل 0.53x) فهذا يعني أن 'التداول والسيولة ضعيفة/أقل من المتوسط'، ويُمنع تماماً وصفها بأنها قوية. لا تعتبر السيولة قوية إلا إذا كانت نسبة الحجم أكبر من 1.5x.");
    sections.push("  • مؤشر MACD: القيمة الرقمية المجردة القريبة من الص الصفر (مثل 0.0089) لا تعني 'إشارات صاعدة' بمفردها؛ صف حركة السهم بناءً على تقاطعه مع خط الإشارة أو اتجاه الـ Histogram إن وجد في البيانات، وإلا اعتبره محايداً.");
    sections.push("  • عندما يسأل المستخدم 'في أي منطقة' أو 'منطقة إيه حالياً' لسهم معين:");
    sections.push("    1. قارن السعر الحالي بمستويات الدعم والمقاومة بدقة وحدد موقعه بينهما.");
    sections.push("    2. صنّف المنطقة فنيّاً وبوضوح إلى واحدة من هذه المناطق فقط: (منطقة دعم / منطقة شراء تميل للإيجابية / منطقة حيادية للمراقبة / منطقة مقاومة / منطقة جني أرباح وتخفيف مضاربي) مع ذكر السبب الفني المباشر باختصار.");
    sections.push("- عندما يسأل المستخدم صراحة عن وجود توصية لسهم معين:");
    sections.push("  • إذا وجدت توصيات أو إشارات لهذا السهم في بيانات الأدوات (المسترجعة من get_recommendations أو get_signals): قم بعرض تفاصيل التوصية بوضوح (سعر الدخول، الهدف، وقف الخسارة، ونسبة العائد المتوقعة).");
    sections.push("  • إذا لم تكن هناك توصيات مسجلة لهذا السهم في البيانات: ابدأ الرد بإجابة حوارية مباشرة موضحاً أنه لا توجد حالياً توصية جديدة مسجلة على هذا السهم بصفحة التوصيات بالنظام، ثم قدم له قراءة فنية لمستويات الدعم والمقاومة للاسترشاد بها.");
    sections.push("  • في نهاية الرد، يجب دائماً كتابة جملة إخلاء المسؤولية الثابتة بالحرف في سطر منفصل: 'الرأي مبني على السعر والزخم والحجم والمستويات الفنية المتاحة، وليس توصية شراء أو بيع.'");
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
    sections.push("    2. اشرح النتيجة بوضوح مستنداً لتلك الأرقام والتواريخ (مثال: السهم في مرحلة تجميع قوي بدرجة 80.3 بناءً على مسح Wyckoff بتاريخ...).");
    sections.push("    3. يمنع تماماً تجاهل بيانات التجميع الفنية المتاحة أو استخدام مؤشر RSI كبديل للتعبير عن التجميع.");
    sections.push("  • يمنع تكرار نفس التفسير أو الجملة اللفظية لأكثر من سؤال أو مؤشر (مثل تكرار جملة 'هذا يعني أن السهم في مرحلة تشبع... ويمكن أن يبدأ في هبوط قريباً'). صِف كل مؤشر وقيمته الرقمية بشكل منفصل وبتفسير فني دقيق ومتنوع.");
    sections.push("  • تقريب الأرقام السعرية ومستويات الدعم والمقاومة إلى رقمين عشريين دائماً (مثال: 0.43 جنيه وليس 0.428684 جنيه).");
    sections.push("  • يمنع تماماً تكرار الجمل التمهيدية (مثل: حسناً دعونا نبدأ... حسناً دعونا نبدأ) أو تكرار الفقرات ذات المعنى المماثل في الرد.");
    sections.push("- عندما يسأل المستخدم صراحة عن وجود توصية لسهم معين:");
    sections.push("  • إذا وجدت توصيات أو إشارات لهذا السهم في بيانات الأدوات (المسترجعة من get_recommendations أو get_signals): قم بعرض تفاصيل التوصية بوضوح (سعر الدخول، الهدف، وقف الخسارة، ونسبة العائد المتوقعة).");
    sections.push("  • إذا لم تكن هناك توصيات مسجلة لهذا السهم في البيانات: ابدأ الرد بإجابة حوارية مباشرة موضحاً أنه لا توجد حالياً توصية جديدة مسجلة على هذا السهم بصفحة التوصيات بالنظام، ثم قدم له قراءة فنية لمستويات الدعم والمقاومة للاسترشاد بها.");

    sections.push("=== USER REQUEST ===\n" + (userMessage || "(بدون رسالة)"));

    let contextText = sections.join("\n\n");
    if (contextText.length > MAX_CONTEXT_CHARS) {
        contextText = `...\n\n[تم اقتطاع السياق القديم - تجاوز الحد الأقصى]\n\n` + contextText.slice(-MAX_CONTEXT_CHARS);
    }

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `أنت الخبير والاستشاري المالي الاحترافي للبورصة المصرية (EGX Bots). اليوم: ${today}.
دورك تقديم استشارات فنية موجزة وعمليّة ومباشرة تفيد المستثمر وتساعده على إدارة مخاطره بذكاء وحكمة دون مقدمات إنشائية أو كتابة مقالات.
أجب مباشرة واختصار ودقة عن سؤال المستثمر دون مقدمات طويلة كالمقالات (مثل: مرحباً بكم في هذا المقال). لا تشرح المعنى العام للمؤشرات بل طبّق قيمتها الرقمية مباشرة على حالة السهم الفنية الحالية.
اعتمد على أقوى الأدلة والمؤشرات المتاحة في البيانات أولاً (مثل درجة التجميع ومرحلة Wyckoff وأيام التجميع لوصف التجميع، بدلاً من استخدام RSI كبديل).
قدم تحليلاً فنياً وموضوعياً يستند للبيانات المتاحة فقط، دون إعطاء وعود جازمة بمكسب، مع مراعاة الحفاظ على أسلوب استشاري رفيع ومحاور خبير وموجز.`;

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

async function callNvidiaApi(
    modelName: string,
    messages: { role: string; content: any }[],
    apiKeys: string[],
    stream: boolean = false
): Promise<{ response: string | null; streamGen?: AsyncGenerator<string> }> {
    let keyIndex = 0;
    while (keyIndex < apiKeys.length) {
        const key = apiKeys[keyIndex];
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

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
                    max_tokens: AI_CONFIG.limits.responseMaxTokens,
                    stream
                })
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                const reply = data.choices?.[0]?.message?.content?.trim();
                if (reply) return { response: reply };
                keyIndex++;
            } else {
                keyIndex++;
            }
        } catch (err: any) {
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
    sessionState?: SessionState | null
): Promise<string> {
    if (visionContext && visionContext.symbols.length === 0 && toolResults.length === 0) {
        return buildVisionUncertaintyResponse(visionContext);
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) return fastAdvisor;

    const isAnalyticalQuery = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|اشتريت|خسران|نازل)/i.test(userMessage);
    const needsGuidanceResponse = plan.guidance_intent;
    const deterministic = !needsGuidanceResponse && !isAnalyticalQuery ? buildDeterministicResponse(userMessage, plan, toolResults, sessionState) : null;
    if (deterministic) return deterministic;
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        const requestedDate = plan.entities.requested_date;
        return requestedDate
            ? `لا توجد بيانات موثقة لهذا الطلب بتاريخ ${requestedDate}. لم أستخدم تاريخاً آخر حتى لا أخلط بين البيانات.`
            : "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference, sessionState
    );

    const allowedModels = new Set([...(AI_CONFIG.models.response.allowedUserModels || []), AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks, ...AI_CONFIG.models.response.agentRouter]);
    const safeRequestedModel = requestedModel && allowedModels.has(requestedModel) ? requestedModel : undefined;
    const textModels = safeRequestedModel ? [safeRequestedModel, ...AI_CONFIG.models.response.fallbacks] : [AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks];
    for (const m of textModels) {
        const result = m === "gpt-5.6-sol"
            ? await callAgentRouterApi(m, messages)
            : await callNvidiaApi(m, messages, apiKeys);
        if (result?.response) {
            return sanitizeReply(removeModelTables(result.response));
        }
    }
    return buildDeterministicResponse(userMessage, plan, toolResults, sessionState) || "عذراً، لم أتمكن من إنشاء الرد.";
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
    sessionState?: SessionState | null
): AsyncGenerator<string, void, unknown> {
    const forcedDeterministic = plan.service_degraded_message || plan.tools.includes("get_fair_value_scan")
        ? buildDeterministicResponse(userMessage, plan, toolResults, sessionState)
        : null;
    if (forcedDeterministic) {
        yield forcedDeterministic;
        return;
    }
    if (visionContext && visionContext.symbols.length === 0 && toolResults.length === 0) {
        yield buildVisionUncertaintyResponse(visionContext);
        return;
    }
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) {
        yield fastAdvisor;
        return;
    }

    const isAnalyticalQueryRegex = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|مكمل|مستمر|جلسه|جلسة|غدا|غداً|اشترى|اشتري|اشتريت|خسران|نازل|عادله|عادلة|تقييم|قيمته|تسوى|تساوي|أهداف|اهداف|احتفاظ|خروج|دخول|بيجمع|ينطلق|مؤشر|مؤشرات|اخبار|أخبار|إيه|ايه|هل|فين|مين|مسح|شروط|\?|؟)/i;
    const isAnalyticalQuery = isAnalyticalQueryRegex.test(userMessage) || userMessage.trim().split(/\s+/).length > 4;
    const needsGuidanceResponse = plan.guidance_intent;
    const deterministic = !needsGuidanceResponse && !isAnalyticalQuery ? buildDeterministicResponse(userMessage, plan, toolResults, sessionState) : null;
    if (deterministic) {
        yield deterministic;
        return;
    }
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        yield plan.entities.requested_date
            ? `لا توجد بيانات موثقة لهذا الطلب بتاريخ ${plan.entities.requested_date}. لم أستخدم تاريخاً آخر حتى لا أخلط بين البيانات.`
            : "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
        return;
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference, sessionState
    );


    const allowedModels = new Set([...(AI_CONFIG.models.response.allowedUserModels || []), AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks, ...AI_CONFIG.models.response.agentRouter]);
    const safeRequestedModel = requestedModel && allowedModels.has(requestedModel) ? requestedModel : undefined;
    const textModels = safeRequestedModel ? [safeRequestedModel, ...AI_CONFIG.models.response.fallbacks] : [AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks];

    if (textModels[0] === "gpt-5.6-sol") {
        const result = await callAgentRouterApi(textModels[0], messages, false);
        if (result.response) {
            yield sanitizeReply(removeModelTables(result.response));
            return;
        }
        yield "عذراً، نموذج AgentRouter غير متاح حالياً. تحقق من مفتاح AGENTROUTER_API_KEY.";
        return;
    }

    for (const model of textModels) {
        let keyIndex = 0;
        while (keyIndex < apiKeys.length) {
            const key = apiKeys[keyIndex];
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.limits.responseTimeoutMs);

                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature: 0.15,
                        max_tokens: AI_CONFIG.limits.responseMaxTokens,
                        stream: true
                    })
                });
                clearTimeout(timeoutId);

                if (res.ok && res.body) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let providerDone = false;

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
                                    continue;
                                }
                                try {
                                    const parsed = JSON.parse(dataStr);
                                    if (parsed.choices?.[0]?.finish_reason) providerDone = true;
                                    const token = parsed.choices?.[0]?.delta?.content || "";
                                    if (token) yield token;
                                } catch {}
                            }
                        }
                    }
                    if (providerDone) return;
                    throw new Error("LLM stream ended before provider completion marker");
                } else {
                    if (res.status === 401 || res.status === 403 || res.status === 429) {
                        keyIndex++;
                        continue;
                    }
                    break;
                }
            } catch {
                keyIndex++;
            }
        }
    }

    yield "عذراً، يبدو أن هناك ضغطاً على السيرفرات حالياً أو أن نماذج الذكاء الاصطناعي لم تستجب للطلب. يرجى إعادة إرسال رسالتك من جديد.";
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
        sections.push("أهلاً بك! إليك الشرح المبسط للمفاهيم التي طلبتها في البورصة:");
        sections.push("");

        if (wantsAccumulation) {
            sections.push("🔹 **التجميع (Accumulation):**\nهو قيام المستثمرين الكبار والمؤسسات بشراء كميات كبيرة من السهم بشكل هادئ وتدريجي على فترات ممتدة، دون رفع السعر كبيراً، لبناء مركز مالي قوي قبل بدء موجة الصعود الرئيسية.");
            sections.push("");
        }

        if (wantsAssembly) {
            sections.push("🔹 **الجمعية العمومية (General Assembly):**\nهي الاجتماع الرسمي المباشر لمساهمي الشركة لمناقشة نتائج الأعمال السنوية، والاهتمام بإقرار توزيعات الأرباح النقدية أو المجانية، وانتخاب مجلس الإدارة، والتصويت على قرارات الشركة المصيرية.");
            sections.push("");
        }

        if (wantsDistribution) {
            sections.push("🔹 **التصريف (Distribution):**\nهو عكس التجميع؛ حيث يبدأ كبار المستثمرين في بيع وتصريف كمياتهم تدريجياً لجمهور المستثمرين الأفراد عند قمم الأسعار المرتفعة، استعداداً لبدء مرحلة هبوط أو تصحيح للسعر.");
            sections.push("");
        }

        if (wantsMacd) {
            sections.push("🔹 **مؤشر MACD (تقاطع المتوسطات المتحركة والزخم):**\nهو مؤشر فني يقيس اتجاه وقوة زخم الحركة السعرية عبر تتبع تقاطع متوسطين متحركين (سريع وبطيء). تقاطع خط الـ MACD لأعلى يُعد إشارة إيجابية لبداية صعود، والتقاطع لأسفل إشارة سلبية لصالح البائعين.");
            sections.push("");
        }

        sections.push("❓ **سؤال تفاعلي:** هل تحب نطبق هذه المفاهيم على سهم معين حالياً ونحلل مؤشراته الفنية؟");

        return sections.join("\n");
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
        || /(توزيع|نسبة|نسبه).{0,30}(بين|مابين).{0,30}(أسهم|اسهم|صناديق)/i.test(normMsg)
        || (plan.guidance_intent === "allocation" && /(نسبة|نسبه|صناديق)/i.test(normMsg))
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
    if (isSectorBuyQuery || isBestBuyStockQuestion(userMessage)) {
        const sectorResult = toolResults.find(r => r.tool === "get_sector");
        const fairValueScan = toolResults.find(r => r.tool === "get_fair_value_scan");
        const stocks = Array.isArray(sectorResult?.data?.stocks) ? sectorResult.data.stocks : (Array.isArray(fairValueScan?.data?.stocks) ? fairValueScan.data.stocks : []);

        let greeting = "بناءً على البيانات الحية المتاحة، هذه مقارنة فنية بين أبرز الأسهم الظاهرة في المسح، وليست أمراً بالشراء:";
        if (sessionState?.investment_budget || sessionState?.risk_tolerance) {
            greeting = `استكمالاً لتحليل قطاعك ووفق تفضيلاتك المسجلة (${sessionState.investment_budget ? `ميزانية ${sessionState.investment_budget.toLocaleString("ar-EG")} جنيه` : "دون ميزانية محددة"})، هذه مقارنة فنية للأسهم الظاهرة في البيانات وليست توصية شخصية:`;
        }

        const levelBySymbol = new Map(toolResults
            .filter(result => result.tool === "get_stock_levels" && result.data?.symbol)
            .map(result => [String(result.data.symbol), result.data]));

        const topStocksList = stocks.slice(0, 5).map((s: any) => {
            const sym = s.symbol;
            const tech = s.tech || s;
            const rawPrice = tech.close ?? s.close ?? s.price;
            const price = rawPrice != null && Number.isFinite(Number(rawPrice)) ? `${Number(rawPrice).toFixed(2)} جنيه` : "غير متاح";
            const changeVal = tech.change_pct != null ? Number(tech.change_pct) : 0;
            const changeStr = changeVal !== 0 ? `${changeVal > 0 ? "+" : ""}${changeVal.toFixed(2)}%` : "استقرار";
            const rawRsi = tech.rsi_14 ?? tech.rsi;
            const rsiVal = rawRsi != null && Number.isFinite(Number(rawRsi)) ? Number(rawRsi).toFixed(1) : null;
            const premium = s.premium_pct != null && Number.isFinite(Number(s.premium_pct)) ? Number(s.premium_pct) : null;
            const volumeRatio = s.volume_ratio ?? (tech.vol_sma20 && tech.volume != null ? Number(tech.volume) / Number(tech.vol_sma20) : null);
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

            return `• **${sym}** (السعر ${price} | ${changeStr}):\n  **البيانات الداعمة للمقارنة:** ${reason}.`;
        }).join("\n\n");

        return [
            greeting,
            "",
            topStocksList || "• الأسهم الموضحة بالجدول أعلاه تعكس أحدث حركة للسيولة والزخم السعري للقطاع.",
            "",
            "📌 **إدارة المخاطر:**",
            "1. لا تحوّل ترتيب المسح وحده إلى قرار شراء؛ راجع سيولة السهم واتجاهه ومستوياته الفعلية.",
            "2. لا يمكن اشتقاق وقف خسارة ثابت دون دعم فعلي وتذبذب السهم وحجم المركز؛ استخدم مستوى الدعم الموثق فقط إن ظهر في البيانات.",
            "",
            "يمكن بعد ذلك مقارنة الدعم والمقاومة الفعليين للأسهم التي اجتازت هذه التصفية."
        ].join("\n");
    }

    return null;
}

export function buildDeterministicResponse(userMessage: string, plan: IntentPlan, toolResults: ToolResult[], sessionState?: SessionState | null): string | null {
    const fastAdvisor = buildFastConversationalAdvisorResponse(userMessage, plan, toolResults, sessionState);
    if (fastAdvisor) return fastAdvisor;
    const scan = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
    if (scan && scan.data?.stocks) {
        const stocks = scan.data.stocks;
        const direction = scan.data.direction === "distribution" ? "تصريف" : "تجميع";
        const oppositeDirection = scan.data.direction === "distribution" ? "تجميع" : "تصريف";
        const actionAr = scan.data.direction === "distribution" ? "التصريف" : "التجميع";
        const scoreField = scan.data.direction === "distribution" ? "dist_score" : "acc_score";
        const oppScoreField = scan.data.direction === "distribution" ? "acc_score" : "dist_score";
        const consecutiveField = scan.data.direction === "distribution" ? "consecutive_dist_days" : "consecutive_acc_days";

        if (stocks.length === 0) {
            return `عذراً، لم أجد أي أسهم تطابق الشروط التي حددتها حالياً في قاعدة البيانات.`;
        }

        const countWord = stocks.length === 1 ? "سهم واحد" : stocks.length === 2 ? "سهمين" : `${stocks.length} أسهم`;
        const lines = [
            `تم العثور على ${countWord} يطابق الشروط المحددة:`
        ];

        stocks.slice(0, 15).forEach((stock: any) => {
            const score = stock[scoreField];
            const oppScore = stock[oppScoreField] || 0;
            const vol = stock.vol_ratio;
            const consecutiveDays = stock[consecutiveField];
            const wyckoff = stock.wyckoff_phase;
            const rsi = stock.rsi_14;

            lines.push("");
            lines.push(`📌 **${stock.symbol} (${stock.name || stock.symbol})**`);
            lines.push(`✅ درجة ${actionAr}: ${score}/100`);
            lines.push(`✅ نسبة الحجم: ${vol}x`);
            lines.push(`✅ لا يوجد ${oppositeDirection} (درجة ${oppositeDirection === "تصريف" ? "التصريف" : "التجميع"}: ${oppScore})`);
            lines.push(`✅ ${actionAr} مستمر: ${consecutiveDays} أيام متتالية`);
            if (rsi) lines.push(`• RSI: ${rsi}`);
            if (wyckoff) lines.push(`• مرحلة Wyckoff: ${wyckoff}`);
        });

        lines.push("");
        lines.push(`الخلاصة: وفقاً للشروط التي حددتها، ${stocks.length === 1 ? `سهم ${stocks[0].symbol} هو السهم الوحيد المطابق حالياً.` : `هذه هي الأسهم المطابقة حالياً في قاعدة البيانات.`}`);
        lines.push("");
        lines.push("الرأي مبني على السعر والزخم والحجم والمستويات الفنية المتاحة، وليس توصية شراء أو بيع.");

        return lines.join("\n");
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
    if (isUsageLimitQuestion(userMessage)) {
        return "لا أستطيع تأكيد عدد الرسائل المتبقية من سياق السهم السابق. راجع عداد الاستخدام الظاهر في المحادثة، ولن أستخدم بيانات سهم للإجابة عن سؤال الحساب.";
    }
    if (isEarningsDataRequest(userMessage) && plan.entities.symbols.length > 0) {
        return `لا تتوفر لدي حالياً بيانات أرباح موثقة للفترة المطلوبة للسهم ${plan.entities.symbols.join("، ")}. لذلك لن أستبدل سؤال الأرباح بالسعر أو RSI. يمكنني تحليل السعر فنياً، أو عرض الأرباح عند إضافة مصدر قوائم مالية مؤرخ للنظام.`;
    }
    const priceHistory = toolResults.find(result => result.tool === "get_price_history");
    if (priceHistory?.data?.symbol) {
        const data = priceHistory.data;
        if (isDailyPriceLimitQuestion(userMessage)) {
            const close = data.latest?.close == null ? NaN : Number(data.latest.close);
            const upper = data.upper_limit_20pct == null ? NaN : Number(data.upper_limit_20pct);
            const lower = data.lower_limit_20pct == null ? NaN : Number(data.lower_limit_20pct);
            if (![close, upper, lower].every(Number.isFinite)) {
                return `${data.symbol}: لا يتوفر إغلاق سابق موثق يكفي لحساب المسافة من الحد السعري اليومي. لن أستخدم صفراً أو نسبة افتراضية بدل البيانات الناقصة.`;
            }
            const upperDistance = Number.isFinite(close) && Number.isFinite(upper) ? ((upper - close) / close) * 100 : null;
            const lowerDistance = Number.isFinite(close) && Number.isFinite(lower) ? ((close - lower) / close) * 100 : null;
            return `${data.symbol}: آخر إغلاق ${close.toFixed(2)} جنيه بتاريخ ${priceHistory.data_time}. الحد السعري الحسابي التقريبي وفق ±20% من إغلاق الجلسة السابقة: صعود ${upper.toFixed(2)} جنيه وهبوط ${lower.toFixed(2)} جنيه. السهم بعيد عن حد الصعود بنحو ${upperDistance?.toFixed(1)}% وعن حد الهبوط بنحو ${lowerDistance?.toFixed(1)}%. تحقّق من قواعد وحدود الجلسة الفعلية لدى البورصة/الوسيط لأن النسبة قد تختلف حسب حالة الورقة.`;
        }
        if (/(اعلى|أعلى).{0,15}(سعر|قمه|قمة)/i.test(userMessage)) {
            return `${data.symbol}: أعلى سعر مسجل في آخر ${250} جلسة متاحة هو ${Number(data.highest_250_sessions.price).toFixed(2)} جنيه بتاريخ ${data.highest_250_sessions.date}. الفترة محددة بآخر 250 جلسة وليست أعلى سعر تاريخي منذ الإدراج.`;
        }
    }
    const fairValueRequest = /(قيمه عادله|قيمة عادلة|القيمة العادلة|القيمه العادله|fair value|عادله|عادلة)/i.test(userMessage);
    const compoundMessage = /\n|\s+(?:هات|جيب|اعرض|حلل|شوف|قارن|لو\s+كسر)(?:\s|$)|[،,]\s*(?:و\s*)?(?:مين|ايه|إيه|هات|جيب|شوف|حلل)(?:\s|$)/i.test(userMessage);
    const fairValueScan = toolResults.find(result => result.tool === "get_fair_value_scan");
    if (fairValueScan && !isBestBuyStockQuestion(userMessage)) {
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
            "ابدأ بالمقارنة بين قوة التجميع والسيولة وقرب السعر من الدعم، ولا تعتبر وجود السهم في القائمة أمراً بالشراء.",
            "تنبيه: المقصود هنا قيمة وسطية فنية وليست قيمة عادلة مالية؛ القيمة الجوهرية تحتاج أرباحاً وتدفقات نقدية ومكررات قطاع موثقة."
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
        if (scan?.data?.stocks?.length) parts.push(`التجميع/التصريف: ${scan.data.stocks.slice(0, 8).map((stock: any) => stock.symbol).join("، ")}.`);
        if (parts.length) return Array.from(new Set(parts)).join("\n");
    }
    if (plan.intent === "general_chat" && toolResults.length === 0) {
        if (/^\s*(?:جدع|عاش|تمام|تسلم|شكرا|شكراً|حلو|ممتاز|برافو)\s*[!؟?.]*$/i.test(userMessage)) {
            return "تسلم. المهم أن يظل التحليل مرتبطاً بالبيانات والمخاطر، وليس مجرد اختيار نسبة أو سهم بلا مبرر.";
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

    const decision = /(أبيع|ابيع|بيع|أشتري|اشتري|شراء|احتفظ|أحتفظ|اخرج|أخرج)/i.test(userMessage);
    const isOwnedStockAdviceQuery = /(اشتريت.*نزل|نازل بيا|خسران|اشتريت.*سهم|اشتريت اليوم|اشتريت.*ونزل)/i.test(userMessage);
    if (isOwnedStockAdviceQuery) return null;
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
            "هذه قراءة فنية وليست توصية بيع أو شراء."
        ].join("\n");
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
        if (sectorLiquidity.data?.requested_sector) {
            return [
                `سيولة قطاع ${top.sector} بتاريخ ${sectorLiquidity.data_time}:`,
                `قيمة التداول التقديرية ${formatMillions(top.traded_value)} عبر ${top.stock_count} سهم متاح البيانات.`,
                top.average_volume_ratio != null ? `متوسط نسبة الحجم لأسهم القطاع: ${Number(top.average_volume_ratio).toFixed(2)}x.` : null,
                "المقياس المستخدم هو مجموع السعر × حجم التداول لأسهم القطاع فقط."
            ].filter(Boolean).join("\n");
        }
        return [
            describeDatedFallback(plan.entities.requested_date, sectorLiquidity.data_time),
            `أكبر قطاع من حيث قيمة التداول التقديرية بتاريخ ${sectorLiquidity.data_time} هو ${top.sector}.`,
            `قيمة التداول التقديرية: ${formatMillions(top.traded_value)} عبر ${top.stock_count} سهم متاح البيانات.`,
            ...sectors.slice(1, 5).map((sector: any, index: number) => `${index + 2}. ${sector.sector}: ${formatMillions(sector.traded_value)} عبر ${sector.stock_count} سهم.`),
            "المقياس المستخدم هو مجموع السعر × حجم التداول لأسهم القطاع في الجلسة، وليس RSI أو درجة التجميع."
        ].filter(Boolean).join("\n");
    }

    const sectorList = toolResults.find(result => result.tool === "get_sector_list");
    if (sectorList) {
        const sectors = Array.isArray(sectorList.data?.sectors) ? sectorList.data.sectors : [];
        if (sectors.length === 0) return "لا توجد أسماء قطاعات مسجلة حالياً في بيانات الشركات.";
        return [`القطاعات المسجلة في بيانات البورصة المصرية (${sectors.length} قطاع):`, ...sectors.map((item: any, index: number) => `${index + 1}. ${item.sector} (${item.stock_count} سهم)`) ].join("\n");
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
            const row = scanRows.find(item => requestedSymbols.includes(String(item.symbol || "").toUpperCase())) || stocks[0];
            const symbol = row?.symbol || plan.entities.symbols[0];
            if (row) {
                const score = Number(row[scoreField] || 0);
                const oppositeScore = Number(row[oppositeScoreField] || 0);
                const matchesDirection = row.signal === direction || score >= 50;
                const oppositeDirectionAr = direction === "distribution" ? "التجميع" : "التصريف";
                const verdict = matchesDirection
                    ? `نعم، توجد إشارة ${directionAr} مسجلة على ${symbol} في مسح ${scanResult.data_time}.`
                    : row.signal === (direction === "distribution" ? "accumulation" : "distribution") || oppositeScore >= 50
                        ? `لا، أحدث مسح لا يسجل ${directionAr} على ${symbol}؛ الإشارة الأقرب هي ${oppositeDirectionAr}.`
                        : `لا توجد إشارة ${directionAr} مؤكدة على ${symbol} في أحدث مسح.`;
                const evidence = [
                    `الإشارة المسجلة: ${row.signal || "محايدة"}`,
                    `درجة ${directionAr}: ${row[scoreField] ?? "غير متاحة"}/100`,
                    `درجة ${oppositeDirectionAr}: ${row[oppositeScoreField] ?? "غير متاحة"}/100`,
                    row.vol_ratio != null ? `نسبة الحجم: ${row.vol_ratio}x` : null,
                    row[consecutiveField] != null ? `أيام ${directionAr}: ${row[consecutiveField]}` : null,
                    row.wyckoff_phase ? `مرحلة Wyckoff: ${row.wyckoff_phase}` : null
                ].filter(Boolean);
                return [describeDatedFallback(plan.entities.requested_date, scanResult.data_time), verdict, `الدليل: ${evidence.join("، ")}.`, "هذه قراءة لمسح فني مسجل وليست توصية شراء أو بيع."].filter(Boolean).join("\n");
            }

            const technicalRow = Array.isArray(scanResult.data?.technical_rows) ? scanResult.data.technical_rows[0] : null;
            const technicalDetails = technicalRow
                ? ` المتاح فنياً: نسبة الحجم ${technicalRow.vol_ratio ?? "غير متاحة"}x، RSI ${technicalRow.rsi_14 ?? "غير متاح"}، MACD ${technicalRow.macd_signal ?? "غير متاح"}.`
                : "";
            return `لا توجد بيانات مسح ${directionAr} كافية للسهم ${symbol} بتاريخ ${scanResult.data_time}.${technicalDetails} مؤشرات الحجم وRSI وMACD تصف السيولة والزخم، لكنها لا تثبت ${directionAr} وحدها.`;
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
            return `- ${data.symbol} (${data.name}): السعر ${data.price} جنيه، التغير ${data.change_pct}، RSI ${data.rsi_14}، MACD ${data.macd_signal}، حجم التداول ${data.vol_ratio} من متوسط 20 جلسة.`;
        });
        const levelLines = levelResults.length > 5 ? [] : levelResults
            .map(lvl => {
                const lvlData = lvl?.data;
                const lvlSymbol = lvlData?.symbol || lvl?.symbols?.[0];
                if (lvlData?.support != null && lvlData?.resistance != null) {
                    return `الدعم الحسابي: ${Number(lvlData.support).toFixed(2)} جنيه، المقاومة الحسابية: ${Number(lvlData.resistance).toFixed(2)} جنيه (لسهم ${lvlSymbol})، من آخر ${lvlData.lookback_sessions} جلسة حتى ${lvl.data_time}.`;
                }
                return null;
            })
            .filter((line): line is string => line !== null);

        const levelFallback = levelResults.length <= 5 && levelLines.length === 0 && levelResults.some(r => r.source === "empty")
            ? "لا توجد بيانات سعرية كافية لحساب الدعم والمقاومة."
            : null;

        const omitted = stocks.length > 10 ? `تم عرض ملخص أول 10 أسهم فقط؛ الجدول المنظم يحتوي على جميع الأسهم المتاحة (${stocks.length}).` : null;
        const opinionLines = stocks.length <= 3 ? stocks.map(result => buildStockOpinion(result, levelResults)) : [];
        return [describeDatedFallback(plan.entities.requested_date, stocks[0]?.data_time), "ملخص أحدث البيانات المتاحة:", ...lines, omitted, ...levelLines, levelFallback, ...opinionLines, ...(fairValueRequest ? buildTechnicalValuationLines(stocks, levelResults) : []), "الرأي مبني على السعر والزخم والحجم والمستويات المتاحة، وليس توصية شراء أو بيع. لو ذكرت هدفك ومدة الاستثمار وسعر دخولك أقدر أربط التحليل بوضعك بشكل أوضح."].filter(Boolean).join("\n");
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
    if ([price, support, resistance].every(Number.isFinite) && resistance > support) {
        const position = (price - support) / (resistance - support);
        notes.push(position >= 0.8 ? "السعر قريب من المقاومة، فالأفضل انتظار اختراق مؤكد أو تراجع أفضل" : position <= 0.25 ? "السعر قريب من الدعم، لكن يلزم ثباته وحجم داعم" : "السعر في منتصف النطاق ولا توجد أفضلية واضحة من الموقع وحده");
    }
    return `${symbol} - رأيي الفني: ${notes.join("؛ ") || "البيانات الحالية لا تكفي لرأي فني موثوق"}.`;
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
