"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { 
    Brain, 
    BarChart3, 
    Activity, 
    Bell, 
    ArrowRight, 
    Play, 
    Cpu, 
    TrendingUp, 
    Sliders, 
    CheckCircle2, 
    Sparkles, 
    ChevronRight,
    ArrowLeftRight,
    Globe,
    Zap,
    Shield,
    Users
} from "lucide-react";

export default function HomePage() {
    const { language, t } = useLanguage();
    const { user } = useAuth();
    const isAr = language === "ar";

    // Interactive Bot Simulator State
    const [targetProfit, setTargetProfit] = useState(5);
    const [stopLoss, setStopLoss] = useState(3);
    const [threshold, setThreshold] = useState(0.5);

    // Calculated Mock Simulator Metrics
    const [trades, setTrades] = useState(69);
    const [winRate, setWinRate] = useState(39);
    const [pnl, setPnl] = useState(73.6);

    useEffect(() => {
        // Calculate interactive mock metrics based on sliders
        const rawTrades = Math.max(8, Math.round(180 - (threshold * 120) - (targetProfit * 3) - (stopLoss * 4)));
        const rawWinRate = Math.max(15, Math.min(92, Math.round(38 + (stopLoss * 4.5) - (targetProfit * 1.5) + (threshold * 22))));
        
        // Simple P/L expectation calculation
        const winningTrades = rawTrades * (rawWinRate / 100);
        const losingTrades = rawTrades - winningTrades;
        const rawPnl = (winningTrades * targetProfit) - (losingTrades * stopLoss);
        
        setTrades(rawTrades);
        setWinRate(rawWinRate);
        setPnl(parseFloat(rawPnl.toFixed(1)));
    }, [targetProfit, stopLoss, threshold]);

    // Localized content object for easy formatting
    const content = {
        badge: isAr ? "⚡ عصر جديد للتداول الكمي بالذكاء الاصطناعي في البورصة المصرية" : "⚡ A new era of AI quant trading on the EGX",
        title1: isAr ? "ضاعف قوة تداولاتك" : "Supercharge Your Trading",
        title2: isAr ? "بالذكاء الاصطناعي الكمي" : "With Quantitative Machine Learning",
        desc: isAr 
            ? "منصة متطورة تدمج نماذج الغابة العشوائية (Random Forest) والتحليل الفني والأساسي لتوليد إشارات شراء فورية ومحاكاة دقيقة لاستراتيجيات التداول."
            : "An advanced platform combining Random Forest models with technical and fundamental analysis to deliver real-time buy signals and precise strategy backtesting.",
        btnExplore: isAr ? "استكشف البوتات" : "Explore Bots",
        btnSimulator: isAr ? "محاكي الاستراتيجيات" : "Strategy Simulator",
        btnDashboard: isAr ? "لوحة التحكم" : "Dashboard",
        
        featuresTitle: isAr ? "ميزات متطورة تم تصميمها للمستثمر العصري" : "Cutting-Edge Features Built for Modern Investors",
        featuresSubtitle: isAr ? "كل ما تحتاجه للسيطرة على السوق بقرارات مدعومة بالبيانات" : "Everything you need to outperform the market using data-driven decisions",
        
        feature1Title: isAr ? "بوتات تداول ذكية" : "AI Trading Bots",
        feature1Desc: isAr ? "بوتات مؤتمتة مثل NANO و KING مبنية على نماذج تعلم آلي لحساب احتمالية الصعود بدقة." : "Automated bots like NANO and KING powered by ML models to compute upside probability.",
        
        feature2Title: isAr ? "محاكاة تاريخية دقيقة" : "Backtest Strategy Simulator",
        feature2Desc: isAr ? "اختبر أفكارك وسلوك البوتات بإعدادات مخصصة (الهدف، الوقف، الأيام) على بيانات السوق التاريخية." : "Test custom parameters (Target, Stop, Days) on historical market data with detailed trade logging.",
        
        feature3Title: isAr ? "ماسح فني متكامل" : "Technical Indicator Screener",
        feature3Desc: isAr ? "فلترة فورية للأسهم بناءً على RSI و MACD والتقاطعات الذهبية وانفجارات حجم التداول." : "Instant scanning for stocks based on RSI, MACD, golden crosses, and volume breakout signals.",
        
        feature4Title: isAr ? "تنبيهات تليجرام وواتساب" : "Telegram & WhatsApp Alerts",
        feature4Desc: isAr ? "استقبل إشارات الشراء وإشعارات البوتات مباشرة على هاتفك فور حدوثها دون الحاجة لمتابعة الشاشة." : "Receive real-time buy signals and alerts directly on your phone, no constant screen monitoring required.",

        simTitle: isAr ? "تفاعل مع محاكي البوت الذكي" : "Interactive Bot Simulator Preview",
        simSubtitle: isAr ? "غيّر معايير التحكم وشاهد كيف يتأثر معدل الأداء والربحية التاريخية تلقائياً" : "Adjust controls and watch how historical win rates and profitability shift dynamically",
        simLabelTarget: isAr ? "الربح المستهدف" : "Target Profit",
        simLabelStop: isAr ? "وقف الخسارة" : "Stop Loss",
        simLabelThreshold: isAr ? "عتبة الذكاء الاصطناعي (Threshold)" : "AI Confidence Threshold",
        simResultTitle: isAr ? "إحصائيات الأداء المتوقعة" : "Simulated Performance Metrics",
        simResultPnl: isAr ? "صافي الأرباح (P&L)" : "Net Profit (P&L)",
        simResultWinRate: isAr ? "نسبة النجاح" : "Win Rate",
        simResultTrades: isAr ? "الصفقات المفلتَرة" : "Filtered Trades",
        
        botsTitle: isAr ? "مقارنة أداء البوتات المتاحة" : "Compare Available Bots",
        botsSubtitle: isAr ? "بوتات ذكية تناسب أسلوب تداولك (حذر أو نشط)" : "Intelligent bots suited for your trading style (Defensive or Aggressive)",
        botNanoDesc: isAr ? "مثالي للتداولات السريعة واصطياد الزخم الفوري." : "Ideal for rapid momentum plays and high frequency signals.",
        botKingDesc: isAr ? "مصمم للصفقات المتوازنة ذات الدقة العالية." : "Built for high-precision, swing-based configurations.",

        stepsTitle: isAr ? "ابدأ رحلتك في 3 خطوات بسيطة" : "Start Your Journey in 3 Easy Steps",
        step1Title: isAr ? "1. اختر البوت والنموذج" : "1. Select Bot & Model",
        step1Desc: isAr ? "تصفح النماذج المتاحة واختر ما يطابق رؤيتك الاستثمارية." : "Browse models and choose the one that aligns with your market outlook.",
        step2Title: isAr ? "2. اختبر وحسّن الإعدادات" : "2. Backtest & Optimize",
        step2Desc: isAr ? "اضبط مستهدف الربح ووقف الخسارة واختبر الأداء التاريخي في ثوانٍ." : "Fine-tune target profits, stop losses, and visualize historical performance instantly.",
        step3Title: isAr ? "3. فعّل التنبيهات المباشرة" : "3. Activate Live Alerts",
        step3Desc: isAr ? "اربط حساب تليجرام أو واتساب واستقبل إشارات الشراء فورياً." : "Connect Telegram or WhatsApp to receive real-time breakout signals directly.",

        ctaTitle: isAr ? "جاهز للتداول بذكاء؟" : "Ready to Trade Smarter?",
        ctaDesc: isAr ? "انضم الآن وابدأ في استخدام أقوى أدوات التحليل الكمي للبورصة المصرية." : "Join now and harness the power of quantitative analytics for the Egyptian Exchange.",
        ctaBtn: isAr ? "إنشاء حساب مجاني" : "Create Free Account",
    };

    return (
        <div className="relative min-h-screen pt-24 overflow-hidden" dir={isAr ? "rtl" : "ltr"}>
            
            {/* Visual Background Accents */}
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-violet-600/10 rounded-full blur-[150px] pointer-events-none" />
            <div className="absolute bottom-10 left-1/3 w-[350px] h-[350px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
            
            {/* Grid Overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f0f13_1px,transparent_1px),linear-gradient(to_bottom,#0f0f13_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

            {/* 1. HERO SECTION */}
            <section className="relative z-10 max-w-5xl mx-auto text-center px-4 pt-8 md:pt-16 pb-20">
                {/* Promo Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-blue-500/30 bg-blue-950/20 text-xs font-bold text-blue-400 mb-8 animate-pulse shadow-[0_0_20px_rgba(59,130,246,0.15)]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{content.badge}</span>
                </div>
                
                {/* Main Headline */}
                <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-6 leading-tight">
                    {content.title1} <br />
                    <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-500 bg-clip-text text-transparent drop-shadow-[0_2px_10px_rgba(99,102,241,0.2)]">
                        {content.title2}
                    </span>
                </h1>
                
                {/* Description */}
                <p className="text-zinc-400 text-base md:text-lg max-w-3xl mx-auto mb-10 leading-relaxed font-semibold">
                    {content.desc}
                </p>
                
                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                    <Link 
                        href="/scanner/backtests?tab=bots" 
                        className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm tracking-wider uppercase transition-all duration-300 transform hover:scale-[1.02] shadow-[0_10px_25px_rgba(79,70,229,0.3)] flex items-center justify-center gap-2 group"
                    >
                        <span>{content.btnExplore}</span>
                        <ArrowRight className={`w-4 h-4 transition-transform group-hover:translate-x-1 ${isAr ? "rotate-180 group-hover:-translate-x-1" : ""}`} />
                    </Link>
                    
                    <Link 
                        href="/scanner/backtests" 
                        className="w-full sm:w-auto px-8 py-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white font-bold text-sm tracking-wider uppercase transition-all duration-300 flex items-center justify-center gap-2"
                    >
                        <Sliders className="w-4 h-4 text-zinc-500" />
                        <span>{content.btnSimulator}</span>
                    </Link>

                    <Link 
                        href="/scanner/technical" 
                        className="w-full sm:w-auto px-8 py-4 rounded-2xl border border-white/5 bg-zinc-900/40 hover:bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 text-xs font-bold uppercase transition-all duration-300"
                    >
                        {isAr ? "الماسح الفني" : "Technical Screen"}
                    </Link>
                </div>

                {/* Simulated Performance Dashboard Preview */}
                <div className="relative rounded-3xl border border-white/10 bg-zinc-900/20 backdrop-blur-md p-1 p-2 md:p-6 shadow-[0_30px_100px_rgba(0,0,0,0.8)] max-w-4xl mx-auto overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    {/* Header Row */}
                    <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6 px-2">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                            <span className="text-[10px] md:text-xs font-black uppercase tracking-wider text-zinc-500">
                                {isAr ? "لوحة الأداء الفعلي (مباشر)" : "Real Bot Performance (Live)"}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-600 bg-zinc-950 px-2.5 py-1 rounded-lg">
                            <span>EGX30</span>
                            <span className="text-emerald-400 font-bold">+12.4%</span>
                        </div>
                    </div>

                    {/* Stats Summary Rows */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Nano Card */}
                        <div className="flex flex-col rounded-2xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-white/10 hover:bg-zinc-950/80">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-black text-xs">
                                        N
                                    </div>
                                    <div className="text-left">
                                        <h4 className="text-xs font-black text-white">NANO Bot</h4>
                                        <p className="text-[9px] text-zinc-500 font-semibold">{content.botNanoDesc}</p>
                                    </div>
                                </div>
                                <span className="px-2 py-0.5 text-[8px] font-black uppercase rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                    {isAr ? "نشط" : "Active"}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center bg-zinc-900/40 p-2 rounded-xl mt-1">
                                <div>
                                    <span className="block text-[9px] text-zinc-500 font-semibold uppercase">{isAr ? "صافي الربح" : "Net Profit"}</span>
                                    <span className="text-xs font-black text-emerald-400">+73.6%</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-zinc-500 font-semibold uppercase">{isAr ? "نسبة النجاح" : "Win Rate"}</span>
                                    <span className="text-xs font-black text-white">39%</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-zinc-500 font-semibold uppercase">{isAr ? "الصفقات" : "Trades"}</span>
                                    <span className="text-xs font-black text-zinc-400">69</span>
                                </div>
                            </div>
                        </div>

                        {/* King Card */}
                        <div className="flex flex-col rounded-2xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-white/10 hover:bg-zinc-950/80">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 font-black text-xs">
                                        K
                                    </div>
                                    <div className="text-left">
                                        <h4 className="text-xs font-black text-white">KING Bot</h4>
                                        <p className="text-[9px] text-zinc-500 font-semibold">{content.botKingDesc}</p>
                                    </div>
                                </div>
                                <span className="px-2 py-0.5 text-[8px] font-black uppercase rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    {isAr ? "نشط" : "Active"}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center bg-zinc-900/40 p-2 rounded-xl mt-1">
                                <div>
                                    <span className="block text-[9px] text-zinc-500 font-semibold uppercase">{isAr ? "صافي الربح" : "Net Profit"}</span>
                                    <span className="text-xs font-black text-emerald-400">+15.4%</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-zinc-500 font-semibold uppercase">{isAr ? "نسبة النجاح" : "Win Rate"}</span>
                                    <span className="text-xs font-black text-white">62%</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-zinc-500 font-semibold uppercase">{isAr ? "الصفقات" : "Trades"}</span>
                                    <span className="text-xs font-black text-zinc-400">18</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 2. CORE FEATURES GRID */}
            <section className="relative z-10 bg-zinc-950/80 border-t border-white/5 py-24 px-6">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-2xl md:text-4xl font-black text-white mb-4">
                            {content.featuresTitle}
                        </h2>
                        <p className="text-zinc-500 text-sm md:text-base font-semibold max-w-xl mx-auto">
                            {content.featuresSubtitle}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Feature 1 */}
                        <div className="relative group rounded-2xl border border-white/5 bg-zinc-900/10 p-6 hover:border-white/10 hover:bg-zinc-900/20 transition-all duration-300">
                            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Brain className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-black text-white mb-2">{content.feature1Title}</h3>
                            <p className="text-zinc-400 text-xs md:text-sm font-semibold leading-relaxed">{content.feature1Desc}</p>
                        </div>

                        {/* Feature 2 */}
                        <div className="relative group rounded-2xl border border-white/5 bg-zinc-900/10 p-6 hover:border-white/10 hover:bg-zinc-900/20 transition-all duration-300">
                            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <BarChart3 className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-black text-white mb-2">{content.feature2Title}</h3>
                            <p className="text-zinc-400 text-xs md:text-sm font-semibold leading-relaxed">{content.feature2Desc}</p>
                        </div>

                        {/* Feature 3 */}
                        <div className="relative group rounded-2xl border border-white/5 bg-zinc-900/10 p-6 hover:border-white/10 hover:bg-zinc-900/20 transition-all duration-300">
                            <div className="w-12 h-12 rounded-xl bg-violet-500/10 text-violet-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Activity className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-black text-white mb-2">{content.feature3Title}</h3>
                            <p className="text-zinc-400 text-xs md:text-sm font-semibold leading-relaxed">{content.feature3Desc}</p>
                        </div>

                        {/* Feature 4 */}
                        <div className="relative group rounded-2xl border border-white/5 bg-zinc-900/10 p-6 hover:border-white/10 hover:bg-zinc-900/20 transition-all duration-300">
                            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Bell className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-black text-white mb-2">{content.feature4Title}</h3>
                            <p className="text-zinc-400 text-xs md:text-sm font-semibold leading-relaxed">{content.feature4Desc}</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* 3. INTERACTIVE SIMULATOR PLAYGROUND */}
            <section className="relative z-10 py-24 px-6 border-t border-white/5 bg-zinc-950/40">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-2xl md:text-4xl font-black text-white mb-4">
                            {content.simTitle}
                        </h2>
                        <p className="text-zinc-500 text-sm md:text-base font-semibold max-w-xl mx-auto">
                            {content.simSubtitle}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                        {/* Control Sliders Panel */}
                        <div className="lg:col-span-6 rounded-2xl border border-white/10 bg-zinc-900/30 p-6 flex flex-col justify-between">
                            <div className="space-y-6">
                                <h3 className="text-sm font-black uppercase text-zinc-400 tracking-wider flex items-center gap-2">
                                    <Sliders className="w-4 h-4 text-blue-400" />
                                    <span>{isAr ? "إعدادات التحكم الافتراضية" : "Configuration Sliders"}</span>
                                </h3>

                                {/* Slider 1: Target Profit */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs font-bold">
                                        <span className="text-zinc-300">{content.simLabelTarget}</span>
                                        <span className="text-emerald-400">+{targetProfit}%</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max="15" 
                                        value={targetProfit} 
                                        onChange={(e) => setTargetProfit(parseInt(e.target.value))}
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
                                    />
                                    <div className="flex justify-between text-[9px] text-zinc-600 font-bold uppercase">
                                        <span>1%</span>
                                        <span>8%</span>
                                        <span>15%</span>
                                    </div>
                                </div>

                                {/* Slider 2: Stop Loss */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs font-bold">
                                        <span className="text-zinc-300">{content.simLabelStop}</span>
                                        <span className="text-rose-400">-{stopLoss}%</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max="10" 
                                        value={stopLoss} 
                                        onChange={(e) => setStopLoss(parseInt(e.target.value))}
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none"
                                    />
                                    <div className="flex justify-between text-[9px] text-zinc-600 font-bold uppercase">
                                        <span>1%</span>
                                        <span>5%</span>
                                        <span>10%</span>
                                    </div>
                                </div>

                                {/* Slider 3: Threshold */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs font-bold">
                                        <span className="text-zinc-300">{content.simLabelThreshold}</span>
                                        <span className="text-indigo-400">{(threshold).toFixed(2)}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0.1" 
                                        max="0.9" 
                                        step="0.05"
                                        value={threshold} 
                                        onChange={(e) => setThreshold(parseFloat(e.target.value))}
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
                                    />
                                    <div className="flex justify-between text-[9px] text-zinc-600 font-bold uppercase">
                                        <span>0.10 ({isAr ? "نشط جداً" : "Aggressive"})</span>
                                        <span>0.50</span>
                                        <span>0.90 ({isAr ? "حذر جداً" : "Conservative"})</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-6 mt-6 border-t border-white/5 text-[10px] text-zinc-500 font-bold leading-relaxed">
                                {isAr 
                                    ? "* ملاحظة: يتم حساب هذه القيم فورياً عبر محاكاة سلوك التداول الخوارزمي لتسجيل الفروق بين العائد ومخاطر وقف الخسارة."
                                    : "* Note: Calculated instantly by simulating algorithmic returns vs. standard risk parameters."
                                }
                            </div>
                        </div>

                        {/* Results / Simulated Metrics Panel */}
                        <div className="lg:col-span-6 rounded-2xl border border-white/10 bg-zinc-950 p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden">
                            {/* Glow accent */}
                            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                            
                            <div>
                                <h3 className="text-sm font-black uppercase text-zinc-400 tracking-wider mb-6 flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-emerald-400 animate-pulse" />
                                    <span>{content.simResultTitle}</span>
                                </h3>

                                <div className="space-y-6">
                                    {/* Simulated Profit */}
                                    <div className="flex justify-between items-center bg-zinc-900/30 p-4 rounded-xl border border-white/5">
                                        <span className="text-xs text-zinc-400 font-bold">{content.simResultPnl}</span>
                                        <span className={`text-xl font-black ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                            {pnl >= 0 ? "+" : ""}{pnl}%
                                        </span>
                                    </div>

                                    {/* Win Rate Bar */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center text-xs font-bold">
                                            <span className="text-zinc-400">{content.simResultWinRate}</span>
                                            <span className="text-white">{winRate}%</span>
                                        </div>
                                        <div className="w-full h-2.5 bg-zinc-900 rounded-full overflow-hidden border border-white/5">
                                            <div 
                                                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out" 
                                                style={{ width: `${winRate}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Trades counts */}
                                    <div className="flex justify-between items-center text-xs font-bold pt-2">
                                        <span className="text-zinc-400">{content.simResultTrades}</span>
                                        <span className="text-zinc-200">{trades}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-8">
                                <Link 
                                    href="/scanner/backtests"
                                    className="w-full py-3.5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2"
                                >
                                    <span>{isAr ? "ابدأ محاكاة حقيقية على الأسهم" : "Start Real Simulation on Stocks"}</span>
                                    <ArrowRight className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`} />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 4. STEPS SECTION */}
            <section className="relative z-10 py-24 px-6 border-t border-white/5 bg-zinc-950">
                <div className="max-w-5xl mx-auto text-center">
                    <h2 className="text-2xl md:text-4xl font-black text-white mb-16">
                        {content.stepsTitle}
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                        {/* Step 1 */}
                        <div className="flex flex-col bg-zinc-900/10 border border-white/5 p-6 rounded-2xl text-center md:text-left">
                            <h3 className="text-lg font-black text-white mb-3 flex items-center gap-2 justify-center md:justify-start">
                                <Cpu className="w-5 h-5 text-blue-400" />
                                <span>{content.step1Title}</span>
                            </h3>
                            <p className="text-zinc-400 text-xs font-semibold leading-relaxed">
                                {content.step1Desc}
                            </p>
                        </div>

                        {/* Step 2 */}
                        <div className="flex flex-col bg-zinc-900/10 border border-white/5 p-6 rounded-2xl text-center md:text-left">
                            <h3 className="text-lg font-black text-white mb-3 flex items-center gap-2 justify-center md:justify-start">
                                <Sliders className="w-5 h-5 text-indigo-400" />
                                <span>{content.step2Title}</span>
                            </h3>
                            <p className="text-zinc-400 text-xs font-semibold leading-relaxed">
                                {content.step2Desc}
                            </p>
                        </div>

                        {/* Step 3 */}
                        <div className="flex flex-col bg-zinc-900/10 border border-white/5 p-6 rounded-2xl text-center md:text-left">
                            <h3 className="text-lg font-black text-white mb-3 flex items-center gap-2 justify-center md:justify-start">
                                <Bell className="w-5 h-5 text-emerald-400" />
                                <span>{content.step3Title}</span>
                            </h3>
                            <p className="text-zinc-400 text-xs font-semibold leading-relaxed">
                                {content.step3Desc}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* 5. CALL TO ACTION SECTION */}
            <section className="relative z-10 py-24 px-6 border-t border-white/5 bg-zinc-950/80">
                <div className="max-w-4xl mx-auto rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-950/20 to-blue-950/20 backdrop-blur-md p-8 md:p-12 text-center relative overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                    
                    {/* Glowing effect inside the card */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />

                    <h2 className="text-3xl md:text-5xl font-black text-white mb-4">
                        {content.ctaTitle}
                    </h2>
                    <p className="text-zinc-400 text-sm md:text-base font-semibold max-w-lg mx-auto mb-8">
                        {content.ctaDesc}
                    </p>
                    
                    <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
                        <Link 
                            href={user ? "/scanner/backtests?tab=bots" : "/signup"}
                            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-black text-sm uppercase tracking-wider transition-all duration-300 transform hover:scale-[1.01]"
                        >
                            {user ? content.btnDashboard : content.ctaBtn}
                        </Link>
                        
                        {!user && (
                            <Link 
                                href="/login"
                                className="w-full sm:w-auto px-8 py-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 font-black text-sm uppercase tracking-wider transition-all duration-300"
                            >
                                {isAr ? "تسجيل الدخول" : "Sign In"}
                            </Link>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}

