"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    Brain,
    BarChart3,
    Zap,
    ArrowRight,
    Smartphone,
    Activity,
    LineChart,
    Shield,
    Sparkles,
} from "lucide-react";

const STATS = [
    { value: "279+", labelEn: "EGX Symbols", labelAr: "سهم مصري", colorClass: "neobrutal-bg-yellow" },
    { value: "15m", labelEn: "Intraday Data", labelAr: "بيانات لحظية", colorClass: "neobrutal-bg-cyan" },
    { value: "AI", labelEn: "ML Models", labelAr: "نماذج ذكاء", colorClass: "neobrutal-bg-green" },
    { value: "24/7", labelEn: "Bot Monitoring", labelAr: "مراقبة البوت", colorClass: "neobrutal-bg-pink" },
];

export default function HomePage() {
    const { user } = useAuth();
    const { language } = useLanguage();
    const isAr = language === "ar";

    const scanners = [
        {
            href: "/scanner/backtests?tab=bots",
            icon: Brain,
            title: isAr ? "ماسح التداول بالذكاء الاصطناعي" : "AI Trading Scanner",
            desc: isAr
                ? "بوتات ذكية وإشارات شراء مبنية على نماذج تعلم آلي متقدمة وتوقعات دقيقة للاتجاه."
                : "Smart bots and buy signals powered by advanced machine learning trend prediction models.",
            badge: "AI LIVE",
            colorClass: "neobrutal-bg-cyan",
        },
        {
            href: "/scanner/technical",
            icon: Activity,
            title: isAr ? "الماسح الفني" : "Technical Scanner",
            desc: isAr
                ? "فلاتر فنية متقدمة وإشارات RSI وMACD وحجم التداول على كل أسهم EGX لحظياً."
                : "Advanced technical filters with RSI, MACD, and volume signals on all EGX stocks in real-time.",
            badge: "POPULAR",
            colorClass: "neobrutal-bg-yellow",
        },
        {
            href: "/scanner/backtests?tab=backtests",
            icon: BarChart3,
            title: isAr ? "محاكاة الاستراتيجيات" : "Strategy Backtests",
            desc: isAr
                ? "اختبر استراتيجيتك الفنية والذكية على سنوات من البيانات التاريخية قبل المخاطرة."
                : "Test technical and AI strategies on years of historical data before risking actual capital.",
            badge: "PRO TOOL",
            colorClass: "neobrutal-bg-green",
        },
    ];

    const steps = [
        {
            n: 1,
            title: isAr ? "اختر استراتيجية" : "Pick a Strategy",
            desc: isAr
                ? "اختر نموذج AI جاهز أو أنشئ استراتيجية فنية مخصصة من فلاتر التداول."
                : "Choose a ready AI model or build your custom technical strategy from filters.",
            colorClass: "neobrutal-bg-yellow",
        },
        {
            n: 2,
            title: isAr ? "اختبر تاريخياً" : "Backtest It",
            desc: isAr
                ? "شغّل المحاكاة على بيانات السوق التاريخية للبورصة المصرية لتقييم الأداء."
                : "Run simulations on historical EGX market data to evaluate performance.",
            colorClass: "neobrutal-bg-cyan",
        },
        {
            n: 3,
            title: isAr ? "استقبل الإشارات" : "Get Live Alerts",
            desc: isAr
                ? "احصل على إشارات فورية على تليجرام أو عبر البوت المباشر الخاص بنا."
                : "Get instant trading signals via Telegram or through our live direct bot.",
            colorClass: "neobrutal-bg-pink",
        },
    ];

    const features = [
        {
            icon: Brain,
            title: isAr ? "نماذج AI متقدمة" : "Advanced AI Models",
            desc: isAr
                ? "تكامل كامل مع خوارزميات Random Forest و LightGBM لدقة أعلى في تحديد إشارات السوق."
                : "Full integration with Random Forest & LightGBM for higher precision in market signals.",
            colorClass: "neobrutal-bg-yellow",
        },
        {
            icon: LineChart,
            title: isAr ? "بيانات لحظية 15 دقيقة" : "15-Min Intraday Data",
            desc: isAr
                ? "مزامنة ذكية ومباشرة مع TradingView و EODHD لجميع الأسهم المصرية المدرجة."
                : "Smart, direct sync with TradingView & EODHD for all listed Egyptian stocks.",
            colorClass: "neobrutal-bg-cyan",
        },
        {
            icon: Smartphone,
            title: isAr ? "تنبيهات تليجرام فورية" : "Instant Telegram Alerts",
            desc: isAr
                ? "توصيل إشارات الشراء والبيع بشكل آلي ومباشر على هاتفك فور ظهورها."
                : "Buy/sell signals delivered automatically and instantly to your phone.",
            colorClass: "neobrutal-bg-green",
        },
        {
            icon: Shield,
            title: isAr ? "تحليل فني متكامل" : "Pro-Grade Analysis",
            desc: isAr
                ? "أدوات مخصصة تشمل فلاتر فنية، محاكي تداول تاريخي، وإدارة بيانات متقدمة في مكان واحد."
                : "Custom tools including technical filters, historical simulator, and data management.",
            colorClass: "neobrutal-bg-pink",
        },
    ];

    return (
        <div className="neobrutal-layout min-h-screen -mx-3 sm:-mx-6 md:-mx-8 overflow-hidden pb-16">
            {/* Top Marquee Ribbon */}
            <div className="w-full border-y-4 border-black dark:border-white bg-black dark:bg-zinc-950 text-white overflow-hidden py-3 font-mono font-black text-xs sm:text-sm uppercase tracking-widest flex select-none">
                <div className={isAr ? "animate-marquee-neobrutal-rtl flex gap-12 shrink-0 min-w-full justify-around" : "animate-marquee-neobrutal flex gap-12 shrink-0 min-w-full justify-around"}>
                    <span>🚀 EGX BOTS • AI SCANNERS • REALTIME DATA • BACKTESTING • SMART ALERTS</span>
                    <span>🔥 تداول بذكاء • إشارات شراء وبيع • البورصة المصرية بالذكاء الاصطناعي</span>
                    <span>⚡ 100% AUTOMATED BOTS • BACKTEST SYSTEM • LIVE ALERTS</span>
                    <span>🤖 RANDOM FOREST & LIGHTGBM MODELS • DIRECT TELEGRAM DELIVERY</span>
                </div>
                <div aria-hidden="true" className={isAr ? "animate-marquee-neobrutal-rtl flex gap-12 shrink-0 min-w-full justify-around" : "animate-marquee-neobrutal flex gap-12 shrink-0 min-w-full justify-around"}>
                    <span>🚀 EGX BOTS • AI SCANNERS • REALTIME DATA • BACKTESTING • SMART ALERTS</span>
                    <span>🔥 تداول بذكاء • إشارات شراء وبيع • البورصة المصرية بالذكاء الاصطناعي</span>
                    <span>⚡ 100% AUTOMATED BOTS • BACKTEST SYSTEM • LIVE ALERTS</span>
                    <span>🤖 RANDOM FOREST & LIGHTGBM MODELS • DIRECT TELEGRAM DELIVERY</span>
                </div>
            </div>

            {/* Hero Section */}
            <section className="relative px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 neobrutal-grid-bg">
                <div className="max-w-6xl mx-auto text-center relative z-10">
                    
                    {/* Header Sticker Badge */}
                    <div className="inline-block border-4 border-black dark:border-white px-4 py-2.5 neobrutal-bg-yellow font-black text-xs sm:text-sm uppercase tracking-widest mb-8 rotate-[-1.5deg] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:rotate-[0deg] transition-all duration-200 cursor-pointer">
                        <span className="flex items-center gap-2 text-black">
                            <Sparkles className="w-4 h-4 text-black" />
                            {isAr ? "منصة تحليل البورصة المصرية بالذكاء الاصطناعي" : "EGX Stock Analysis Powered by AI"}
                        </span>
                    </div>

                    {/* Logo & Platform Name */}
                    <div className="flex items-center justify-center gap-4 mb-6">
                        <div className="border-4 border-black dark:border-white bg-white p-3 rotate-[2deg] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:rotate-0 transition-transform duration-300">
                            <Image
                                src="/favicon_io/apple-touch-icon.png"
                                alt="EGX Bots Logo"
                                width={48}
                                height={48}
                                className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                                priority
                            />
                        </div>
                        <h1 className="text-4xl sm:text-6xl md:text-8xl font-black tracking-tighter text-black dark:text-white uppercase drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:drop-shadow-[4px_4px_0px_rgba(255,255,255,0.15)]">
                            EGX BOTS
                        </h1>
                    </div>

                    {/* Large Slogan */}
                    <h2 className="text-3xl sm:text-5xl md:text-7xl font-black mb-8 leading-tight tracking-tight text-black dark:text-white">
                        {isAr ? (
                            <>
                                حلّل الأسهم وتداول بذكاء <br />
                                <span className="inline-block border-4 border-black dark:border-white px-6 py-2 mt-2 neobrutal-bg-green rotate-[-1deg] shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,1)] text-black">
                                    مع الذكاء الاصطناعي
                                </span>
                            </>
                        ) : (
                            <>
                                Analyze EGX Stocks & Trade <br />
                                <span className="inline-block border-4 border-black dark:border-white px-6 py-2 mt-2 neobrutal-bg-green rotate-[-1deg] shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,1)] text-black">
                                    With Advanced AI
                                </span>
                            </>
                        )}
                    </h2>

                    {/* Intro Description */}
                    <p className="text-base sm:text-lg md:text-2xl text-zinc-800 dark:text-zinc-200 max-w-3xl mx-auto mb-12 leading-relaxed px-4 font-bold">
                        {isAr
                            ? "منصة متكاملة للمستثمرين في السوق المصري — ماسح فني متقدم، اختبار تاريخي للاستراتيجيات، وإشارات شراء وبيع مدعومة بالتعلم الآلي."
                            : "Comprehensive suite for Egyptian market traders — pro-grade technical scanners, instant backtesting, and automated buy/sell signals."}
                    </p>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-6 justify-center items-stretch sm:items-center px-4 max-w-2xl mx-auto">
                        <Link
                            href={user ? "/scanner/backtests?tab=bots" : "/signup"}
                            className="h-16 px-10 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black uppercase tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-3 text-base sm:text-xl"
                        >
                            {user ? (isAr ? "افتح لوحة الماسح" : "Open Scanner Board") : (isAr ? "أنشئ حساباً مجانياً" : "Create Free Account")}
                            <ArrowRight className={`w-6 h-6 transition-transform ${isAr ? "rotate-180" : ""}`} />
                        </Link>
                        <Link
                            href="/scanner/technical"
                            className="h-16 px-10 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white font-black text-base sm:text-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-3"
                        >
                            <Activity className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                            {isAr ? "جرب الماسح الفني" : "Try Technical Scanner"}
                        </Link>
                    </div>
                </div>

                {/* Dashboard Stats */}
                <div className="max-w-5xl mx-auto mt-16 sm:mt-24 grid grid-cols-2 md:grid-cols-4 gap-6 px-4">
                    {STATS.map((stat) => (
                        <div
                            key={stat.value}
                            className={`border-4 border-black dark:border-white ${stat.colorClass} p-6 text-center flex flex-col justify-center items-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer`}
                        >
                            <div className="text-3xl sm:text-5xl font-black text-black font-mono tracking-tighter leading-none">{stat.value}</div>
                            <div className="text-xs sm:text-sm font-black text-black uppercase tracking-wider mt-3">
                                {isAr ? stat.labelAr : stat.labelEn}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Analysis Scanners / Tools Grid */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-orange text-black font-black text-xs uppercase tracking-widest rotate-[1deg] mb-4">
                            {isAr ? "قوة التحليل" : "POWERS & SCANNERS"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "أدوات التحليل والمسح الذكي" : "Advanced Scanning Systems"}
                        </h2>
                        <p className="text-sm sm:text-base md:text-lg text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto mt-4 font-bold">
                            {isAr
                                ? "ثلاثة أنظمة متكاملة ومصممة خصيصاً للبورصة المصرية لتسهيل قرارات الاستثمار."
                                : "Three robust systems engineered specifically for the EGX to enhance your trading strategies."}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-10">
                        {scanners.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 flex flex-col overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-200 group"
                            >
                                {/* Window title bar */}
                                <div className="border-b-4 border-black dark:border-white px-4 py-3 bg-black dark:bg-zinc-800 flex justify-between items-center text-white select-none">
                                    <span className="font-mono text-[10px] font-black uppercase tracking-widest">{item.badge}</span>
                                    <div className="flex gap-1.5">
                                        <span className="w-3.5 h-3.5 rounded-full bg-[#FF605C] border-2 border-black dark:border-white"></span>
                                        <span className="w-3.5 h-3.5 rounded-full bg-[#FFBD2E] border-2 border-black dark:border-white"></span>
                                        <span className="w-3.5 h-3.5 rounded-full bg-[#27C93F] border-2 border-black dark:border-white"></span>
                                    </div>
                                </div>

                                {/* Body */}
                                <div className="p-6 flex-1 flex flex-col bg-white dark:bg-zinc-950">
                                    <div className={`w-14 h-14 border-4 border-black dark:border-white ${item.colorClass} flex items-center justify-center text-black mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]`}>
                                        <item.icon className="w-8 h-8 text-black" />
                                    </div>

                                    <h3 className="text-xl sm:text-2xl font-black text-black dark:text-white mb-3 tracking-tight">
                                        {item.title}
                                    </h3>

                                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed flex-1 font-bold">
                                        {item.desc}
                                    </p>

                                    <div className="mt-8 pt-4 border-t-4 border-black dark:border-white flex items-center justify-between">
                                        <span className="text-xs font-black uppercase tracking-widest text-black dark:text-white inline-flex items-center gap-2 group-hover:underline">
                                            {isAr ? "افتح الأداة" : "Open Tool"}
                                            <ArrowRight className={`w-4 h-4 transition-transform group-hover:translate-x-1 ${isAr ? "rotate-180 group-hover:-translate-x-1" : ""}`} />
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works Section */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-20">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-pink text-black font-black text-xs uppercase tracking-widest rotate-[-1deg] mb-4">
                            {isAr ? "آلية العمل" : "SIMPLE WORKFLOW"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "كيف تعمل المنصة؟" : "How It Works"}
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 pt-6">
                        {steps.map((step) => (
                            <div
                                key={step.n}
                                className="border-4 border-black dark:border-white p-8 flex flex-col bg-white dark:bg-zinc-950 relative mt-6 md:mt-0 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer"
                            >
                                <div className={`absolute -top-7 -start-6 w-14 h-14 border-4 border-black dark:border-white ${step.colorClass} flex items-center justify-center font-black text-2xl text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]`}>
                                    {step.n}
                                </div>
                                <h3 className="text-xl sm:text-2xl font-black text-black dark:text-white mt-4 mb-3 tracking-tight">
                                    {step.title}
                                </h3>
                                <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 leading-relaxed font-bold">
                                    {step.desc}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Core Features Grid */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-green text-black font-black text-xs uppercase tracking-widest rotate-[1.5deg] mb-4">
                            {isAr ? "الميزات والخصائص" : "FEATURES SUMMARY"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "المميزات الرئيسية المتاحة" : "Core Trading Features"}
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 sm:gap-10">
                        {features.map((feat) => (
                            <div
                                key={feat.title}
                                className="border-4 border-black dark:border-white p-6 sm:p-8 bg-white dark:bg-zinc-950 flex gap-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer"
                            >
                                <div className={`w-14 h-14 border-4 border-black dark:border-white ${feat.colorClass} flex items-center justify-center text-black shrink-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]`}>
                                    <feat.icon className="w-7 h-7 text-black" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h3 className="text-lg sm:text-xl font-black text-black dark:text-white mb-2 tracking-tight">
                                        {feat.title}
                                    </h3>
                                    <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 leading-relaxed font-bold">
                                        {feat.desc}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA Banner */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white">
                <div className="max-w-4xl mx-auto">
                    <div className="border-4 border-black dark:border-white bg-[#fb923c] dark:bg-amber-500 p-8 sm:p-16 text-center relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[10px_10px_0px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer">
                        
                        {/* Interactive decorative badges */}
                        <div className="absolute top-6 right-6 border-4 border-black px-4 py-1.5 neobrutal-bg-yellow font-black text-[11px] uppercase tracking-widest rotate-6 hidden sm:block shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                            100% FREE
                        </div>
                        <div className="absolute bottom-6 left-6 border-4 border-black px-4 py-1.5 neobrutal-bg-cyan font-black text-[11px] uppercase tracking-widest -rotate-6 hidden sm:block shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                            EGX SIGNALS
                        </div>

                        <div className="w-16 h-16 border-4 border-black neobrutal-bg-yellow flex items-center justify-center mx-auto mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                            <Zap className="w-8 h-8 text-black" />
                        </div>

                        <h2 className="text-3xl sm:text-5xl font-black text-black mb-4 tracking-tighter">
                            {isAr ? "جاهز لبدء رحلة التداول الذكي؟" : "Ready to Start Trading Smarter?"}
                        </h2>
                        
                        <p className="text-sm sm:text-lg text-black font-extrabold mb-10 max-w-xl mx-auto leading-relaxed">
                            {isAr
                                ? "انضم الآن إلى منصة EGX BOTS واستفد من التحليلات الفنية وإشارات الذكاء الاصطناعي مجاناً."
                                : "Join EGX BOTS platform now and leverage technical scanners and AI-powered signals for free today."}
                        </p>

                        <Link
                            href={user ? "/scanner/backtests?tab=bots" : "/signup"}
                            className="h-16 px-10 border-4 border-black bg-black text-white font-black text-base sm:text-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer inline-flex items-center justify-center gap-3"
                        >
                            {isAr ? "ابدأ الآن مجاناً" : "Start Now For Free"}
                            <ArrowRight className={`w-5 h-5 transition-transform ${isAr ? "rotate-180" : ""}`} />
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}
