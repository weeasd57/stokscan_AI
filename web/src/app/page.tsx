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
    { value: "279+", labelEn: "EGX Symbols", labelAr: "سهم مصري" },
    { value: "15m", labelEn: "Intraday Data", labelAr: "بيانات لحظية" },
    { value: "AI", labelEn: "ML Models", labelAr: "نماذج ذكاء" },
    { value: "24/7", labelEn: "Bot Monitoring", labelAr: "مراقبة البوت" },
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
                ? "بوتات ذكية وإشارات شراء مبنية على نماذج تعلم آلي"
                : "Smart bots and buy signals powered by machine learning models",
            badge: "AI DEMO",
            gradient: "from-indigo-500 to-violet-600",
        },
        {
            href: "/scanner/technical",
            icon: Activity,
            title: isAr ? "الماسح الفني" : "Technical Scanner",
            desc: isAr
                ? "فلاتر فنية متقدمة وإشارات RSI وMACD على بيانات EGX"
                : "Advanced technical filters with RSI, MACD signals on EGX data",
            gradient: "from-cyan-500 to-blue-600",
        },
        {
            href: "/scanner/backtests?tab=backtests",
            icon: BarChart3,
            title: isAr ? "محاكاة الاستراتيجيات" : "Strategy Backtests",
            desc: isAr
                ? "اختبر استراتيجيتك على سنوات من البيانات قبل التداول الحقيقي"
                : "Test strategies on years of history before going live",
            gradient: "from-emerald-500 to-teal-600",
        },
    ];

    const steps = [
        {
            n: 1,
            title: isAr ? "اختر استراتيجية" : "Pick a Strategy",
            desc: isAr
                ? "اختر نموذج AI جاهز أو أنشئ استراتيجية مخصصة"
                : "Choose a ready AI model or build your own strategy",
        },
        {
            n: 2,
            title: isAr ? "اختبر تاريخياً" : "Backtest It",
            desc: isAr
                ? "شغّل المحاكاة على بيانات EGX التاريخية"
                : "Run simulations on historical EGX market data",
        },
        {
            n: 3,
            title: isAr ? "استقبل الإشارات" : "Get Live Alerts",
            desc: isAr
                ? "إشارات فورية على تليجرام أو عبر البوت المباشر"
                : "Instant alerts via Telegram or the live trading bot",
        },
    ];

    const features = [
        {
            icon: Brain,
            title: isAr ? "نماذج AI متقدمة" : "Advanced AI Models",
            desc: isAr
                ? "Random Forest و LightGBM لدقة أعلى في التنبؤ"
                : "Random Forest & LightGBM for higher prediction accuracy",
        },
        {
            icon: LineChart,
            title: isAr ? "بيانات لحظية 15 دقيقة" : "15-Minute Intraday Data",
            desc: isAr
                ? "مزامنة ذكية من TradingView أو EODHD لكل أسهم EGX"
                : "Smart sync from TradingView or EODHD for all EGX stocks",
        },
        {
            icon: Smartphone,
            title: isAr ? "تنبيهات تليجرام" : "Telegram Alerts",
            desc: isAr
                ? "إشارات شراء وبيع مباشرة على هاتفك"
                : "Buy/sell signals delivered straight to your phone",
        },
        {
            icon: Shield,
            title: isAr ? "تحليل احترافي" : "Pro-Grade Analysis",
            desc: isAr
                ? "فلاتر فنية، باك تست، وإدارة بيانات في مكان واحد"
                : "Technical filters, backtests, and data management in one place",
        },
    ];

    return (
        <div className="landing-shell app-page-shell -mx-3 sm:-mx-6 md:-mx-8">
            {/* Hero */}
            <section className="relative px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-16 sm:pb-20 lg:pb-24">
                <div className="max-w-6xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full app-soft-panel text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-6 animate-fade-in-up">
                        <Sparkles className="w-3.5 h-3.5" />
                        {isAr ? "منصة تحليل EGX بالذكاء الاصطناعي" : "EGX AI Analysis Platform"}
                    </div>

                    <div className="flex items-center justify-center gap-3 sm:gap-4 mb-6 animate-fade-in-up delay-200">
                        <div className="app-hero-panel rounded-2xl p-3 sm:p-4">
                            <Image
                                src="/favicon_io/favicon.ico"
                                alt="EGX Bots"
                                width={44}
                                height={44}
                                className="w-10 h-10 sm:w-12 sm:h-12 object-contain rounded-lg"
                                priority
                            />
                        </div>
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white">
                            EGX BOTS
                        </h1>
                    </div>

                    <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black mb-5 sm:mb-6 leading-[1.1] animate-fade-in-up delay-200">
                        {isAr ? "تداول بذكاء" : "Trade Smart"}
                        <br />
                        <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent animate-gradient-x">
                            {isAr ? "مع الذكاء الاصطناعي" : "With AI"}
                        </span>
                    </h2>

                    <p className="text-sm sm:text-base md:text-lg text-zinc-400 max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed px-2 animate-fade-in-up delay-400">
                        {isAr
                            ? "منصة متكاملة لتحليل أسهم البورصة المصرية — ماسحات فنية، باك تست، وبوتات ذكية على بيانات لحظية"
                            : "All-in-one Egyptian stock analysis — technical scanners, backtests, and smart bots on live intraday data"}
                    </p>

                    <div className="flex flex-col xs:flex-row gap-3 sm:gap-4 justify-center items-stretch xs:items-center px-2 animate-fade-in-up delay-400">
                        <Link
                            href={user ? "/scanner/backtests?tab=bots" : "/signup"}
                            className="app-primary-action group px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl font-bold text-sm sm:text-base inline-flex items-center justify-center gap-2"
                        >
                            {user ? (isAr ? "افتح الماسح" : "Open Scanner") : (isAr ? "إنشاء حساب مجاني" : "Create Free Account")}
                            <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        <Link
                            href="/scanner/technical"
                            className="px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl font-bold text-sm sm:text-base border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white transition-all inline-flex items-center justify-center gap-2"
                        >
                            <Activity className="w-4 h-4" />
                            {isAr ? "جرب الماسح الفني" : "Try Technical Scanner"}
                        </Link>
                    </div>
                </div>

                {/* Stats strip */}
                <div className="max-w-4xl mx-auto mt-12 sm:mt-16 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 px-2">
                    {STATS.map((stat) => (
                        <div key={stat.value} className="app-panel rounded-2xl px-4 py-4 sm:py-5 text-center">
                            <div className="text-xl sm:text-2xl font-black text-white font-mono">{stat.value}</div>
                            <div className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">
                                {isAr ? stat.labelAr : stat.labelEn}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Scanners */}
            <section className="px-4 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-white/5">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-center text-white mb-3">
                        {isAr ? "أدوات التحليل" : "Analysis Tools"}
                    </h2>
                    <p className="text-center text-zinc-500 text-sm sm:text-base mb-10 sm:mb-14 max-w-xl mx-auto">
                        {isAr
                            ? "ثلاثة ماسحات متكاملة لتحليل السوق المصري"
                            : "Three integrated scanners built for the Egyptian market"}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                        {scanners.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="app-hero-panel group rounded-2xl sm:rounded-3xl p-5 sm:p-6 hover:scale-[1.02] transition-all duration-300 flex flex-col"
                            >
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-white shadow-lg mb-4`}>
                                    <item.icon className="w-6 h-6" />
                                </div>
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <h3 className="text-base sm:text-lg font-black text-white">{item.title}</h3>
                                    {item.badge && (
                                        <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[8px] font-black uppercase">
                                            {item.badge}
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-zinc-400 leading-relaxed flex-1">{item.desc}</p>
                                <span className="mt-4 text-xs font-black uppercase tracking-wider text-indigo-400 group-hover:text-indigo-300 inline-flex items-center gap-1">
                                    {isAr ? "افتح" : "Open"}
                                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section className="px-4 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-white/5">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-center text-white mb-10 sm:mb-14">
                        {isAr ? "كيف يعمل؟" : "How It Works"}
                    </h2>

                    <div className="flex md:grid md:grid-cols-3 gap-4 overflow-x-auto pb-2 md:pb-0 snap-x snap-mandatory custom-scrollbar -mx-1 px-1">
                        {steps.map((step) => (
                            <div
                                key={step.n}
                                className="app-panel rounded-2xl p-5 sm:p-6 min-w-[260px] md:min-w-0 snap-start shrink-0 md:shrink"
                            >
                                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-lg font-black text-white mb-4">
                                    {step.n}
                                </div>
                                <h3 className="text-base sm:text-lg font-bold text-white mb-2">{step.title}</h3>
                                <p className="text-sm text-zinc-400 leading-relaxed">{step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="px-4 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-white/5">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-center text-white mb-10 sm:mb-14">
                        {isAr ? "المميزات الرئيسية" : "Key Features"}
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                        {features.map((feat) => (
                            <div key={feat.title} className="app-panel rounded-2xl p-5 sm:p-6 flex gap-4 hover:bg-white/[0.03] transition-colors">
                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white shrink-0">
                                    <feat.icon className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-base sm:text-lg font-bold text-white mb-1.5">{feat.title}</h3>
                                    <p className="text-sm text-zinc-400 leading-relaxed">{feat.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="px-4 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-white/5">
                <div className="max-w-4xl mx-auto">
                    <div className="app-hero-panel rounded-2xl sm:rounded-3xl p-8 sm:p-12 md:p-14 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-6 shadow-lg">
                            <Zap className="w-7 h-7 text-white" />
                        </div>
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-4">
                            {isAr ? "جاهز للبدء؟" : "Ready to Get Started?"}
                        </h2>
                        <p className="text-sm sm:text-base md:text-lg text-zinc-400 mb-8 max-w-lg mx-auto">
                            {isAr
                                ? "ابدأ تحليل أسهم EGX بالذكاء الاصطناعي اليوم — مجاناً"
                                : "Start analyzing EGX stocks with AI today — for free"}
                        </p>
                        <Link
                            href={user ? "/scanner/backtests?tab=bots" : "/signup"}
                            className="app-primary-action group px-8 py-4 rounded-xl font-bold text-base inline-flex items-center gap-2"
                        >
                            {isAr ? "ابدأ الآن" : "Start Now"}
                            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}
