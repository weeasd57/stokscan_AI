"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Language = "en" | "ar";

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
    dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<string, Record<Language, string>> = {
    "app.title": { en: "Artoro", ar: "Artoro" },
    "app.subtitle": { 
        en: "AI-powered stock insights to help you spot opportunities with confidence", 
        ar: "رؤى الأسهم المدعومة بالذكاء الاصطناعي لمساعدتك على رصد الفرص الاستثمارية بثقة" 
    },
    "ticker.label": { en: "Ticker", ar: "الرمز" },
    "ticker.placeholder": { en: "AAPL", ar: "AAPL" },
    "btn.run": { en: "Run prediction", ar: "تشغيل التوقع" },
    "btn.running": { en: "Running...", ar: "جاري التشغيل..." },
    "btn.browse": { en: "Browse", ar: "تصفح" },
    "browse.title": { en: "Browse Symbols", ar: "تصفح الرموز" },
    "dialog.country": { en: "Country", ar: "الدولة" },
    "dialog.select_country": { en: "Select a country...", ar: "اختر دولة..." },
    "dialog.search_placeholder": { en: "Search by symbol or name...", ar: "ابحث بالرمز أو الاسم..." },
    "dialog.search_btn": { en: "Search", ar: "بحث" },
    "result.precision": { en: "Precision", ar: "الدقة" },
    "result.window": { en: "Test window", ar: "نافذة الاختبار" },
    "result.last_close": { en: "Last Close", ar: "آخر سعر إغلاق" },
    "result.date": { en: "Date", ar: "التاريخ" },
    "result.signal": { en: "Tomorrow Signal", ar: "إشارة الغد" },
    "chart.title": { en: "{symbol} Chart Analysis", ar: "تحليل مخطط {symbol}" },
    "signal.up": { en: "Up (buy candidate)", ar: "صعود (مرشح للشراء)" },
    "signal.down": { en: "Down/flat (avoid)", ar: "هبوط/استقرار (تجنب)" },
    "nav.scanner.ai": { en: "AI Scanner", ar: "الماسح الذكي" },
    "nav.scanner.tech": { en: "Technical Scanner", ar: "الماسح الفني" },
    "nav.scanner.compare": { en: "Comparison", ar: "المقارنة" },
    "nav.home": { en: "Home", ar: "الرئيسية" },
    "nav.leaderboard": { en: "Leaderboard", ar: "لوحة الصدارة" },
    "nav.pricing": { en: "Pricing", ar: "الأسعار" },
    "nav.profile": { en: "Profile", ar: "الملف الشخصي" },
    "auth.login": { en: "Login", ar: "تسجيل الدخول" },
    "auth.logout": { en: "Logout", ar: "تسجيل الخروج" },
    "header.pro_analysis": { en: "Pro Analysis", ar: "التحليل الاحترافي" },
    "account.label": { en: "Account", ar: "الحساب" },
    "compare.symbol": { en: "Symbol", ar: "الرمز" },
    "compare.precision": { en: "AI Precision", ar: "دقة الذكاء الاصطناعي" },
    "compare.rsi": { en: "RSI Stats", ar: "إحصائيات RSI" },
    "compare.macd": { en: "MACD Stats", ar: "إحصائيات MACD" },
    "compare.ema": { en: "EMA Cross", ar: "تقاطع EMA" },
    "compare.bb": { en: "Bollinger", ar: "بولنجر" },
    "compare.actions": { en: "Actions", ar: "الإجراءات" },
    "compare.empty": { en: "Add symbols to compare their performance statistics.", ar: "أضف رموزاً لمقارنة إحصائيات أدائها." },
    "compare.fetching": { en: "Fetching historical data and calculating statistics...", ar: "جاري جلب البيانات التاريخية وحساب الإحصائيات..." },
    "compare.winrate_info": { 
        en: "Win rates are calculated by matching indicator signals against actual next-day price movement (UP/DOWN).", 
        ar: "يتم حساب نسب النجاح بمطابقة إشارات المؤشرات مع حركة السعر الفعلية لليوم التالي (صعود/هبوط)." 
    },
    "tech.title": { en: "Technical Scanner", ar: "الماسح الفني" },
    "tech.subtitle": { en: "Advanced technical screener with real-time indicators.", ar: "فاحص فني متقدم مع مؤشرات فورية." },
    "tech.config": { en: "Scanner Config", ar: "إعدادات الماسح" },
    "tech.market": { en: "Market", ar: "السوق" },
    "tech.rsi": { en: "RSI (14)", ar: "RSI (14)" },
    "tech.adx": { en: "ADX (14)", ar: "ADX (14)" },
    "tech.atr": { en: "ATR (14)", ar: "ATR (14)" },
    "tech.stoch": { en: "Stoch %K (14)", ar: "Stoch %K (14)" },
    "tech.roc": { en: "ROC (12)", ar: "ROC (12)" },
    "tech.price_above_ema50": { en: "Price > EMA 50", ar: "السعر > EMA 50" },
    "tech.price_above_ema200": { en: "Price > EMA 200", ar: "السعر > EMA 200" },
    "tech.golden_cross": { en: "Golden Cross (50 > 200)", ar: "التقاطع الذهبي (50 > 200)" },
    "tech.price_above_vwap20": { en: "Price > VWAP 20", ar: "السعر > VWAP 20" },
    "tech.volume_spike": { en: "Volume Spike (> SMA20)", ar: "طفرة في حجم التداول (> SMA20)" },
    "tech.start_scan": { en: "Start Scan", ar: "بدء الفحص" },
    "tech.stop_scan": { en: "Stop Scanning", ar: "إيقاف الفحص" },
    "tech.quick_search": { en: "Quick search...", ar: "بحث سريع..." },
    "tech.found_matches": { en: "Found {count} matches", ar: "تم العثور على {count} من المطابقات" },
    "tech.clear_results": { en: "Clear Results", ar: "مسح النتائج" },
    "tech.restore_last": { en: "Restore Last", ar: "استعادة الأخير" },
    "tech.ready": { en: "Ready to scan. Configure filters and press Start.", ar: "جاهز للفحص. قم بتهيئة الفلاتر واضغط بدء." },
    "tech.no_matches": { en: "No stocks match your criteria.", ar: "لا توجد أسهم تطابق المعايير الخاصة بك." },
    "tech.table.symbol": { en: "Symbol", ar: "الرمز" },
    "tech.table.price": { en: "Price", ar: "السعر" },
    "tech.table.momentum": { en: "Momentum", ar: "الزخم" },
    "tech.table.save": { en: "Save", ar: "حفظ" },
    "pagination.page": { en: "Page", ar: "الصفحة" },
    "dash.title": { en: "Market Strategy Dashboard", ar: "لوحة تحكم استراتيجية السوق" },
    "dash.subtitle": { 
        en: "Aggregate success rates for key technical indicators across {country} market listings.", 
        ar: "معدلات النجاح الإجمالية للمؤشرات الفنية الرئيسية عبر قوائم سوق {country}." 
    },
    "dash.winrate": { en: "Avg Win Rate", ar: "متوسط نسبة النجاح" },
    "dash.signals": { en: "Total Signals", ar: "إجمالي الإشارات" },
    "dash.scanned": { en: "Scanned {count} tickers", ar: "تم فحص {count} رمزاً" },
    "dash.refresh": { en: "Refreshed {time} ago", ar: "تم التحديث منذ {time}" },
    "dash.filter_market": { en: "Filter Market", ar: "تصفية السوق" },
    "ai.title": { en: "AI Market Scanner", ar: "الماسح الذكي للسوق" },
    "ai.subtitle": { 
        en: "Scans the market using the Random Forest model to find high-probability BUY signals.", 
        ar: "يفحص السوق باستخدام نموذج الغابة العشوائية للعثور على إشارات شراء عالية الاحتمالية." 
    },
    "ai.scan_all": { en: "Scan All Market", ar: "فحص السوق بالكامل" },
    "ai.start_scan": { en: "Start AI Scan", ar: "بدء الفحص الذكي" },
    "ai.stop_scan": { en: "Stop Analysis", ar: "إيقاف التحليل" },
    "ai.model_preset": { en: "Model Preset", ar: "النموذج المسبق" },
    "ai.model_options": { en: "Model Options", ar: "خيارات النموذج" },
    "ai.precision_info": { 
        en: "Precision means: among all signals produced in backtest, how many were correct. High precision usually indicates higher quality.", 
        ar: "الدقة تعني: من بين جميع الإشارات المنتجة في الباك تيست، كم منها كان صحيحاً. الدقة العالية تشير عادة إلى جودة أعلى." 
    },
    "ai.matches": { en: "Matches", ar: "المطابقات" },
    "ai.table.symbol": { en: "Symbol", ar: "الرمز" },
    "ai.table.name": { en: "Name", ar: "الاسم" },
    "ai.table.price": { en: "Last Price", ar: "آخر سعر" },
    "ai.table.precision": { en: "AI Precision", ar: "دقة الذكاء الاصطناعي" },
    "ai.table.save": { en: "Save", ar: "حفظ" },
    "ai.no_matches": { en: "No high-confidence opportunities found in this batch.", ar: "لم يتم العثور على فرص عالية الثقة في هذه الدفعة." },
    "ai.chart_ctrl": { en: "Chart View", ar: "عرض المخطط" },
    "ai.indicators": { en: "Indicators", ar: "المؤشرات" },
    "scanner.templates.kicker": { en: "One-Click Strategies", ar: "استراتيجيات بنقرة واحدة" },
    "scanner.templates.title": { en: "Scanner Templates", ar: "قوالب الماسح" },
    "scanner.templates.subtitle": { en: "Pick a strategy to launch a focused scan instantly.", ar: "اختر استراتيجية لإطلاق فحص مركز على الفور." },
    "scanner.templates.ai_growth.title": { en: "AI Smart Pick", ar: "الاختيار الذكي للذكاء الاصطناعي" },
    "scanner.templates.ai_growth.desc": { 
        en: "AI expects upside based on a Random Forest model trained on two years of data.", 
        ar: "يتوقع الذكاء الاصطناعي صعوداً بناءً على نموذج الغابة العشوائية المدرب على بيانات عامين." 
    },
    "scanner.templates.macd_cross.title": { en: "MACD Golden Cross", ar: "التقاطع الذهبي لـ MACD" },
    "scanner.templates.macd_cross.desc": { en: "Classic entry when MACD crosses its signal line to the upside.", ar: "دخول كلاسيكي عندما يتقاطع خط MACD مع خط الإشارة الخاص به للأعلى." },
    "scanner.templates.rsi_oversold.title": { en: "RSI Oversold", ar: "RSI منطقة ذروة البيع" },
    "scanner.templates.rsi_oversold.desc": { en: "Find tickers under RSI 30 that may be ready to rebound.", ar: "ابحث عن الرموز الأقل من RSI 30 والتي قد تكون جاهزة للارتداد." },
    "scanner.templates.volume_breakout.title": { en: "Volume Breakout", ar: "اختراق حجم التداول" },
    "scanner.templates.volume_breakout.desc": { en: "Detect unusual volume spikes signaling institutional interest.", ar: "رصد الارتفاعات غير العادية في حجم التداول التي تشير إلى اهتمام المؤسسات." },
    "scanner.templates.sma_200_breakout.title": { en: "Trend Breakout", ar: "اختراق الاتجاه" },
    "scanner.templates.sma_200_breakout.desc": { en: "Price breaks above the 200-day SMA to confirm a long-term uptrend.", ar: "يخترق السعر خط SMA لـ 200 يوم لتأكيد اتجاه صعودي طويل المدى." },
    "scanner.templates.risk.low": { en: "Low Risk", ar: "مخاطر منخفضة" },
    "scanner.templates.risk.medium": { en: "Medium Risk", ar: "مخاطر متوسطة" },
    "scanner.templates.risk.high": { en: "High Risk", ar: "مخاطر عالية" },
    "scanner.templates.risk.very_high": { en: "Very High Risk", ar: "مخاطر عالية جداً" },
    "profile.track": { en: "Track positions, targets, stop-loss and performance.", ar: "تتبع المراكز والأهداف ووقف الخسارة والأداء." },
    "profile.stats.open": { en: "Open", ar: "المفتوحة" },
    "profile.stats.wins": { en: "Wins", ar: "الرابحة" },
    "profile.stats.losses": { en: "Losses", ar: "الخاسرة" },
    "profile.stats.winrate": { en: "Win Rate", ar: "نسبة النجاح" },
    "profile.defaults.title": { en: "Trading Defaults", ar: "القيم الافتراضية للتداول" },
    "profile.defaults.subtitle": { en: "Used when saving a new symbol to your watchlist.", ar: "تستخدم عند حفظ رمز جديد في قائمة المراقبة." },
    "profile.defaults.target": { en: "Default Target %", ar: "الهدف الافتراضي %" },
    "profile.defaults.stop": { en: "Default Stop-Loss %", ar: "وقف الخسارة الافتراضي %" },
    "profile.ai.title": { en: "AI Assistant Settings", ar: "إعدادات مساعد الذكاء الاصطناعي" },
    "profile.ai.subtitle": { en: "Configure API keys for the smart chat assistant.", ar: "تكوين مفاتيح واجهة برمجة التطبيقات لمساعد الدردشة الذكي." },
    "profile.ai.gemini": { en: "Gemini API Key", ar: "مفتاح Gemini API" },
    "profile.ai.rules": { en: "Custom Rules / Instructions", ar: "القواعد المخصصة / التعليمات" },
    "profile.positions.title": { en: "Trading Positions", ar: "مراكز التداول" },
    "profile.positions.subtitle": { en: "Manage your open and closed positions. Evaluation updates status to Win/Loss.", ar: "إدارة مراكزك المفتوحة والمغلقة. التقييم يحدث الحالة إلى ربح/خسارة." },
    "profile.positions.evaluate": { en: "Evaluate Open Positions", ar: "تقييم المراكز المفتوحة" },
    "profile.table.symbol": { en: "Symbol", ar: "الرمز" },
    "profile.table.added": { en: "Added", ar: "تاريخ الإضافة" },
    "profile.table.status": { en: "Status", ar: "الحالة" },
    "profile.table.entry": { en: "Entry", ar: "سعر الدخول" },
    "profile.table.target": { en: "Target", ar: "الهدف" },
    "profile.table.stop": { en: "Stop", ar: "وقف الخسارة" },
    "profile.table.actions": { en: "Actions", ar: "الإجراءات" },
    "home.insights.title": { en: "Smart AI Insights", ar: "رؤى الذكاء الاصطناعي الذكية" },
    "home.insights.subtitle": { en: "Combined Fundamental & Technical Analysis", ar: "التحليل الفني والأساسي المشترك" },
    "home.insights.valuation": { en: "Valuation", ar: "التقييم" },
    "home.insights.volatility": { en: "Volatility Risk", ar: "مخاطر التقلب" },
    "home.insights.mcap": { en: "Market Cap", ar: "القيمة السوقية" },
    "home.insights.undervalued": { en: "Undervalued. Good value stock candidate.", ar: "أقل من قيمته الحقيقية. مرشح كقيمة جيدة لسهم." },
    "home.insights.fair": { en: "Fair Valuation. Market standard.", ar: "تقييم عادل. معيار السوق." },
    "home.insights.expensive": { en: "Growth/Expensive. Expect volatility.", ar: "نمو/مرتفع القيمة. توقع تقلبات." },
    "home.insights.bubble": { en: "Very Expensive (Bubble risk?). AI is cautious.", ar: "غالٍ جداً (خطر فقاعة؟). الذكاء الاصطناعي حذر." },
    "home.insights.low_vol": { en: "Low Volatility. Defensive / Safe haven.", ar: "تقلب منخفض. دفاعي / ملاذ آمن." },
    "home.insights.avg_vol": { en: "Average Market Risk.", ar: "مخاطر سوق متوسطة." },
    "home.insights.high_vol": { en: "High Volatility. High risk/reward.", ar: "تقلبات عالية. مخاطرة وعائد مرتفعان." },
    "home.insights.large_cap": { en: "Large Cap. Stable & Established.", ar: "قيمة سوقية ضخمة. مستقر وراسخ." },
    "home.insights.mid_cap": { en: "Mid Cap. Balanced Growth.", ar: "قيمة سوقية متوسطة. نمو متوازن." },
    "home.insights.small_cap": { en: "Small Cap. Higher growth potential but risky.", ar: "قيمة سوقية صغيرة. إمكانية نمو أعلى ولكن محفوفة بالمخاطر." },
    "home.insights.strong_buy": { en: "Strong Buy Signal: Technical Uptrend + Reasonable Valuation.", ar: "إشارة شراء قوية: اتجاه فني صاعد + تقييم معقول." },
    "home.insights.cautious_buy": { en: "Cautious Buy: Technical Uptrend, but Valuation is expensive.", ar: "شراء حذر: اتجاه فني صاعد، لكن التقييم مرتفع." },
    "home.chart.title": { en: "Price & AI Buy Signals", ar: "الأسعار وإشارات الشراء للذكاء الاصطناعي" },
    "home.chart.subtitle": { en: "Green dots are model buy predictions", ar: "النقاط الخضراء هي توقعات شراء النموذج" },
    "home.fundamentals.title": { en: "Fundamentals", ar: "البيانات الأساسية" },
    "home.footer.disclaimer": { en: "Model output is not financial advice.", ar: "مخرجات النموذج ليست نصيحة مالية." },
    "dash.days.30": { en: "Last 30 Days", ar: "آخر 30 يوماً" },
    "dash.days.60": { en: "Last 60 Days", ar: "آخر 60 يوماً" },
    "dash.days.90": { en: "Last 90 Days", ar: "آخر 90 يوماً" },
    "compare.save": { en: "Save", ar: "حفظ" },
    "compare.saved": { en: "Saved", ar: "تم الحفظ" },
    "compare.chart": { en: "Chart", ar: "المخطط" },
    "chart.close": { en: "Close", ar: "إغلاق" },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<Language>("ar"); // Default is Arabic

    useEffect(() => {
        const stored = localStorage.getItem("app-language") as Language;
        const defaultLang = stored === "en" || stored === "ar" ? stored : "ar";
        setLanguageState(defaultLang);
        document.documentElement.dir = defaultLang === "ar" ? "rtl" : "ltr";
        document.documentElement.lang = defaultLang;
    }, []);

    const setLanguage = (lang: Language) => {
        setLanguageState(lang);
        localStorage.setItem("app-language", lang);
        document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
        document.documentElement.lang = lang;
    };

    const dir = language === "ar" ? "rtl" : "ltr";

    const t = (key: string) => {
        const entry = translations[key];
        if (!entry) return key;
        return entry[language] || entry["en"];
    };

    return (
        <LanguageContext.Provider
            value={{
                language,
                setLanguage,
                t,
                dir,
            }}
        >
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error("useLanguage must be used within a LanguageProvider");
    }
    return context;
}
