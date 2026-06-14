"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    Brain,
    Zap,
    ArrowRight,
    Smartphone,
    Activity,
    LineChart,
    Shield,
    Sparkles,
    ChevronLeft,
    ChevronRight,
    Star,
    GitGraph,
    Search,
} from "lucide-react";
import { useState } from "react";
import RecommendationsTable from "@/components/RecommendationsTable";

const STATS = [
    { value: "279+", labelEn: "EGX Symbols", labelAr: "سهم مصري", colorClass: "neobrutal-bg-yellow" },
    { value: "15m", labelEn: "Intraday Data", labelAr: "بيانات لحظية", colorClass: "neobrutal-bg-cyan" },
    { value: "AI", labelEn: "ML Models", labelAr: "نماذج ذكاء", colorClass: "neobrutal-bg-green" },
    { value: "24/7", labelEn: "Bot Monitoring", labelAr: "مراقبة البوت", colorClass: "neobrutal-bg-pink" },
];

const AI_SCORE_STEPS = [
    { score: 1, labelEn: "Strong Sell", labelAr: "بيع قوي", bg: "bg-red-500", height: "h-20" },
    { score: 2, labelEn: "Sell", labelAr: "بيع", bg: "bg-red-400", height: "h-24" },
    { score: 3, labelEn: "Sell", labelAr: "بيع", bg: "bg-orange-500", height: "h-28" },
    { score: 4, labelEn: "Hold", labelAr: "احتفاظ", bg: "bg-orange-400", height: "h-32" },
    { score: 5, labelEn: "Hold", labelAr: "احتفاظ", bg: "bg-amber-400", height: "h-36" },
    { score: 6, labelEn: "Hold", labelAr: "احتفاظ", bg: "bg-yellow-400", height: "h-40" },
    { score: 7, labelEn: "Buy", labelAr: "شراء", bg: "bg-lime-400", height: "h-44" },
    { score: 8, labelEn: "Buy", labelAr: "شراء", bg: "bg-green-400", height: "h-48" },
    { score: 9, labelEn: "Buy", labelAr: "شراء", bg: "bg-emerald-400", height: "h-52" },
    { score: 10, labelEn: "Strong Buy", labelAr: "شراء قوي", bg: "bg-emerald-500", height: "h-56" },
];

const BARS_ALPHA = [
    { label: "AI 1", val: -33.28, color: "bg-rose-500", isPos: false, heightPct: 94 },
    { label: "AI 2-3", val: -13.79, color: "bg-rose-400", isPos: false, heightPct: 39 },
    { label: "Benchmark", val: 0.0, color: "bg-zinc-400", isPos: true, heightPct: 2 },
    { label: "AI 7-9", val: 5.54, color: "bg-emerald-400", isPos: true, heightPct: 16 },
    { label: "AI 10", val: 21.05, color: "bg-emerald-600", isPos: true, heightPct: 60 },
];

const TESTIMONIALS = [
    {
        quoteEn: "This is an exceptionally powerful tool that allows one to understand what really drives a stock, generating actionable investment ideas often in surprising and counterintuitive ways. The stellar performance of EGX Bots' recommendations speaks for itself.",
        quoteAr: "هذه أداة قوية للغاية تتيح للمستثمر فهم ما يحرك السهم بالفعل، وتوليد أفكار استثمارية قابلة للتنفيذ بطرق مدهشة وغير متوقعة. الأداء المتميز لتوصيات بوتات EGX يتحدث عن نفسه.",
        authorEn: "Mahmoud A., Private Investor",
        authorAr: "محمود ع.، مستثمر خاص",
        stars: 5
    },
    {
        quoteEn: "As a retail investor, I was struggling to find reliable technical scanner data. EGX Bots gives me both technical indicators and AI predictions in one place. Highly recommended!",
        quoteAr: "كمستثمر تجزئة، كنت أجد صعوبة في العثور على بيانات فحص فني موثوقة. توفر لي EGX Bots كلاً من المؤشرات الفنية وتوقعات الذكاء الاصطناعي في مكان واحد. موصى به للغاية!",
        authorEn: "Sarah M., Financial Analyst",
        authorAr: "سارة م.، محلل مالي",
        stars: 5
    },
    {
        quoteEn: "The Telegram alert bot saves me hours of manual scanning every day. The stop-loss recommendations are incredibly accurate and fit perfectly into my risk management strategy.",
        quoteAr: "يوفر لي بوت تنبيهات تليجرام ساعات من الفحص اليدوي كل يوم. توصيات وقف الخسارة دقيقة بشكل مذهل وتتناسب تماماً مع استراتيجية إدارة المخاطر الخاصة بي.",
        authorEn: "Karim T., Day Trader",
        authorAr: "كريم ت.، مضارب يومي",
        stars: 5
    }
];

const MOCK_SIMILARITY_STOCKS = [
    { symbol: "ISMA",  name: "Ismailia Misr Poultry",   similarity: 94.2, winRate: 1.00, avgReturn: 0.05,  totalMatches: 1,  profitFactor: 0.25, expectedValue: 0.05 },
    { symbol: "PACH",  name: "Extracted Oils & Derivatives", similarity: 87.6, winRate: 1.00, avgReturn: 0.05,  totalMatches: 1,  profitFactor: 0.25, expectedValue: 0.05 },
    { symbol: "BONY",  name: "Bona Company",             similarity: 82.1, winRate: 1.00, avgReturn: 0.05,  totalMatches: 1,  profitFactor: 0.25, expectedValue: 0.05 },
    { symbol: "TMGH",  name: "Talaat Moustafa Group",    similarity: 79.4, winRate: 0.78, avgReturn: 0.142, totalMatches: 18, profitFactor: 2.41, expectedValue: 0.089 },
];

const SIMILARITY_CHART_DATA = [
    { day: "T-9",  Target: -0.8, M1: -1.2, M2: -0.5, M3: -0.9, M4: -0.3, M5: -1.1, Avg: -0.8 },
    { day: "T-8",  Target: -0.5, M1: -0.9, M2: -0.3, M3: -0.7, M4: -0.1, M5: -0.8, Avg: -0.56 },
    { day: "T-7",  Target: -0.3, M1: -0.5, M2:  0.1, M3: -0.4, M4:  0.2, M5: -0.6, Avg: -0.24 },
    { day: "T-6",  Target:  0.1, M1:  0.0, M2:  0.5, M3: -0.1, M4:  0.6, M5: -0.2, Avg:  0.16 },
    { day: "T-5",  Target:  0.4, M1:  0.4, M2:  0.9, M3:  0.3, M4:  1.0, M5:  0.1, Avg:  0.54 },
    { day: "T-4",  Target:  0.7, M1:  0.9, M2:  1.4, M3:  0.7, M4:  1.5, M5:  0.5, Avg:  1.0 },
    { day: "T-3",  Target:  1.2, M1:  1.5, M2:  2.1, M3:  1.2, M4:  2.2, M5:  1.0, Avg:  1.6 },
    { day: "T-2",  Target:  1.8, M1:  2.2, M2:  2.8, M3:  1.9, M4:  3.0, M5:  1.6, Avg:  2.3 },
    { day: "T-1",  Target:  2.5, M1:  3.1, M2:  3.5, M3:  2.6, M4:  3.9, M5:  2.3, Avg:  3.08 },
    { day: "T",    Target:  0.0, M1:  0.0, M2:  0.0, M3:  0.0, M4:  0.0, M5:  0.0, Avg:  0.0 },
    { day: "T+1",  Target: null, M1:  1.2, M2:  1.8, M3:  0.9, M4:  2.1, M5:  0.7, Avg:  1.34 },
    { day: "T+2",  Target: null, M1:  2.1, M2:  3.2, M3:  1.7, M4:  3.8, M5:  1.2, Avg:  2.4 },
    { day: "T+3",  Target: null, M1:  3.4, M2:  4.8, M3:  2.8, M4:  5.7, M5:  2.0, Avg:  3.74 },
    { day: "T+4",  Target: null, M1:  4.9, M2:  6.1, M3:  3.8, M4:  7.2, M5:  2.9, Avg:  4.98 },
    { day: "T+5",  Target: null, M1:  5.8, M2:  7.3, M3:  4.5, M4:  8.5, M5:  3.4, Avg:  5.9 },
    { day: "T+6",  Target: null, M1:  6.2, M2:  7.9, M3:  4.9, M4:  9.1, M5:  3.7, Avg:  6.36 },
    { day: "T+7",  Target: null, M1:  7.0, M2:  8.8, M3:  5.5, M4: 10.0, M5:  4.1, Avg:  7.08 },
    { day: "T+8",  Target: null, M1:  7.6, M2:  9.4, M3:  5.9, M4: 10.7, M5:  4.4, Avg:  7.6 },
    { day: "T+9",  Target: null, M1:  8.1, M2:  9.9, M3:  6.2, M4: 11.3, M5:  4.7, Avg:  8.04 },
    { day: "T+10", Target: null, M1:  8.7, M2: 10.4, M3:  6.6, M4: 11.9, M5:  5.0, Avg:  8.52 },
];

export default function HomePage() {
    const { user } = useAuth();
    const { language } = useLanguage();
    const isAr = language === "ar";

    const [activeTestimonial, setActiveTestimonial] = useState(0);
    const [selectedSimStock, setSelectedSimStock] = useState(MOCK_SIMILARITY_STOCKS[0]);

    const scanners = [
        {
            href: "/scanner/backtests",
            icon: Brain,
            title: isAr ? "أفضل الأسهم (Top Stocks)" : "Top Stocks (AI Score)",
            desc: isAr
                ? "قائمة الأسهم اليومية مرتبة بناءً على تقييم الذكاء الاصطناعي (1-10) لفرص الصعود والهبوط."
                : "Daily ranking of stocks rated from 1 to 10 by quantitative AI models based on beating the market.",
            badge: "AI LIVE",
            colorClass: "neobrutal-bg-cyan",
        },
        {
            href: "/scanner/technical",
            icon: Activity,
            title: isAr ? "الماسح الفني" : "Technical Scanner",
            desc: isAr
                ? "فلاتر فنية متقدمة وإشارات RSI وMACD وحجم التداول على كل الأسهم لحظياً."
                : "Advanced technical filters with RSI, MACD, and volume signals on all EGX stocks in real-time.",
            badge: "POPULAR",
            colorClass: "neobrutal-bg-yellow",
        },
    ];

    const steps = [
        {
            n: 1,
            title: isAr ? "اختر سهمك المفضل" : "Pick a Stock",
            desc: isAr
                ? "اختر سهمك المفضل المدرج في البورصة المصرية أو الأمريكية بناءً على تقييم AI Score."
                : "Choose your favorite stock listed in US or EGX markets based on AI Score.",
            colorClass: "neobrutal-bg-yellow",
        },
        {
            n: 2,
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
                    <span>🚀 EGX BOTS • AI SCANNERS • REALTIME DATA • SMART ALERTS</span>
                    <span>🔥 تداول بذكاء • إشارات شراء وبيع • البورصة المصرية بالذكاء الاصطناعي</span>
                    <span>⚡ 100% AUTOMATED BOTS • LIVE ALERTS</span>
                    <span>🤖 RANDOM FOREST & LIGHTGBM MODELS • DIRECT TELEGRAM DELIVERY</span>
                </div>
                <div aria-hidden="true" className={isAr ? "animate-marquee-neobrutal-rtl flex gap-12 shrink-0 min-w-full justify-around" : "animate-marquee-neobrutal flex gap-12 shrink-0 min-w-full justify-around"}>
                    <span>🚀 EGX BOTS • AI SCANNERS • REALTIME DATA • SMART ALERTS</span>
                    <span>🔥 تداول بذكاء • إشارات شراء وبيع • البورصة المصرية بالذكاء الاصطناعي</span>
                    <span>⚡ 100% AUTOMATED BOTS • LIVE ALERTS</span>
                    <span>🤖 RANDOM FOREST & LIGHTGBM MODELS • DIRECT TELEGRAM DELIVERY</span>
                </div>
            </div>

            {/* Hero Section */}
            <section className="relative px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 neobrutal-grid-bg overflow-hidden">
                {/* Animated dots background */}
                <div className="absolute inset-0 opacity-20">
                    <div className="absolute inset-0 animate-[pulse_4s_ease-in-out_infinite]" style={{
                        backgroundImage: 'radial-gradient(circle, rgba(59, 130, 246, 0.3) 1px, transparent 1px)',
                        backgroundSize: '50px 50px'
                    }} />
                </div>

                <div className="max-w-6xl mx-auto text-center relative z-10">
                    {/* Header Sticker Badge */}
                    <div className="inline-block border-4 border-black dark:border-white px-4 py-2.5 neobrutal-bg-yellow font-black text-xs sm:text-sm uppercase tracking-widest mb-8 rotate-[-1.5deg] shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:rotate-[0deg] hover:scale-110 transition-all duration-200 cursor-pointer animate-[bounceIn_0.8s_ease-out]">
                        <span className="flex items-center gap-2 text-black dark:text-black">
                            <Sparkles className="w-4 h-4 text-black dark:text-black animate-spin" style={{ animationDuration: '3s' }} />
                            {isAr ? "منصة تحليل البورصة المصرية بالذكاء الاصطناعي" : "EGX Stock Analysis Powered by AI"}
                        </span>
                    </div>

                    {/* Logo & Platform Name */}
                    <div className="flex items-center justify-center gap-4 mb-6 animate-[fadeInUp_0.8s_ease-out]">
                        <div className="border-4 border-black dark:border-white bg-white p-3 rotate-[2deg] shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:rotate-0 hover:scale-110 transition-transform duration-300 animate-[float_3s_ease-in-out_infinite]">
                            <Image
                                src="/favicon_io/apple-touch-icon.png"
                                alt="EGX Bots Logo"
                                width={48}
                                height={48}
                                className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                                priority
                            />
                        </div>
                        <h1 className="text-4xl sm:text-6xl md:text-8xl font-black tracking-tighter text-black dark:text-white uppercase drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:drop-shadow-[4px_4px_0px_rgba(255,255,255,0.15)] animate-[slideInRight_0.8s_ease-out]">
                            EGX BOTS
                        </h1>
                    </div>

                    {/* Large Slogan */}
                    <h2 className="text-3xl sm:text-5xl md:text-7xl font-black mb-8 leading-tight tracking-tight text-black dark:text-white">
                        {isAr ? (
                            <>
                                الاستثمار الذكي أصبح سهلاً <br />
                                <span className="inline-block border-4 border-black dark:border-white px-6 py-2 mt-2 neobrutal-bg-green rotate-[-1deg] shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_rgba(255,255,255,1)] text-black dark:text-black">
                                    للجميع بالذكاء الاصطناعي
                                </span>
                            </>
                        ) : (
                            <>
                                Smart Investing Made Easy <br />
                                <span className="inline-block border-4 border-black dark:border-white px-6 py-2 mt-2 neobrutal-bg-green rotate-[-1deg] shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_rgba(255,255,255,1)] text-black dark:text-black">
                                    For Everyone With AI
                                </span>
                            </>
                        )}
                    </h2>

                    {/* Intro Description */}
                    <p className="text-base sm:text-lg md:text-xl text-zinc-800 dark:text-zinc-200 max-w-3xl mx-auto mb-12 leading-relaxed px-4 font-bold">
                        {isAr
                            ? "يقوم الذكاء الاصطناعي الخاص بنا بالعمل الشاق، حيث يحلل مئات المؤشرات يومياً لكل سهم لتصنيف احتمالية تغلب الأسهم على السوق باستخدام تقييم AI Score."
                            : "Our AI does the hard work, analyzing hundreds of metrics per day per stock and rating their probability of beating the market with the AI Score."}
                    </p>

                    {/* AI Score Staircase (danelfin visual concept but neobrutalist) */}
                    <div className="max-w-4xl mx-auto mb-16 px-4">
                        <div className="w-full overflow-x-auto py-6 -mx-4 px-4 scrollbar-thin scrollbar-thumb-zinc-700 flex justify-start md:justify-center">
                            <div className="flex items-end gap-1.5 min-w-[700px] md:min-w-0 md:w-full h-64 select-none">
                                {AI_SCORE_STEPS.map((item) => (
                                    <div key={item.score} className="flex flex-col items-center flex-1 h-full justify-end">
                                        <div className={`w-full ${item.height} border-4 border-black dark:border-white ${item.bg} flex flex-col justify-between p-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-y-2 transition-transform duration-200`}>
                                            <span className="text-[10px] font-black text-black dark:text-black select-none leading-none">AI</span>
                                            <div className="flex flex-col items-center">
                                                <span className="text-lg sm:text-2xl font-black text-black dark:text-black leading-none">{item.score}</span>
                                                <span className="text-[8px] font-black text-black dark:text-black uppercase tracking-tighter mt-1 truncate max-w-full">
                                                    {isAr ? item.labelAr : item.labelEn}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Staircase Axis Labels */}
                        <div className="flex justify-between items-center text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 mt-2 px-1 border-t-2 border-black/10 dark:border-white/10 pt-2 font-mono">
                            <span>{isAr ? "منخفض الاحتمالية" : "Low Probability"}</span>
                            <span>{isAr ? "متوسط" : "Average"}</span>
                            <span>{isAr ? "مرتفع الاحتمالية (شراء)" : "High Probability (Buy)"}</span>
                        </div>

                        {/* Staircase Caption */}
                        <div className="text-center mt-6 text-sm font-black text-zinc-800 dark:text-zinc-200">
                            💡 {isAr ? "تقييم AI Score يمثل احتمالية تفوق السهم على مؤشر السوق خلال 30 يوماً القادمة" : "AI Score rates the probability of the stock beating the benchmark index in the next 30 days."}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-6 justify-center items-stretch sm:items-center px-4 max-w-2xl mx-auto">
                        <Link
                            href={user ? "/scanner/backtests" : "/signup"}
                            className="h-16 px-10 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-3 text-base sm:text-xl"
                        >
                            {user ? (isAr ? "عرض أفضل الأسهم" : "View Top Stocks") : (isAr ? "أنشئ حساباً مجانياً" : "Create Free Account")}
                            <ArrowRight className={`w-6 h-6 transition-transform ${isAr ? "rotate-180" : ""}`} />
                        </Link>
                        <Link
                            href="/scanner/technical"
                            className="h-16 px-10 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white font-black text-base sm:text-xl shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-3"
                        >
                            <Activity className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                            {isAr ? "جرب الماسح الفني" : "Try Technical Scanner"}
                        </Link>
                    </div>
                </div>

                {/* Dashboard Stats */}
                <div className="max-w-5xl mx-auto mt-16 sm:mt-24 grid grid-cols-2 md:grid-cols-4 gap-6 px-4">
                    {STATS.map((stat, idx) => (
                        <div
                            key={stat.value}
                            className={`border-4 border-black dark:border-white ${stat.colorClass} p-6 text-center flex flex-col justify-center items-center shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] hover:scale-105 transition-all duration-200 cursor-pointer animate-[fadeInUp_0.6s_ease-out_both]`}
                            style={{ animationDelay: `${idx * 100}ms` }}
                        >
                            <div className="text-3xl sm:text-5xl font-black text-black dark:text-white font-mono tracking-tighter leading-none animate-[countUp_1s_ease-out]">{stat.value}</div>
                            <div className="text-xs sm:text-sm font-black text-black dark:text-white uppercase tracking-wider mt-3">
                                {isAr ? stat.labelAr : stat.labelEn}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Recommendations Preview Section (Exactly 3 Rows with MORE redirecting) */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-10">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-yellow text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[-1deg] mb-4">
                            {isAr ? "ترتيب السوق اليوم" : "TODAY'S MARKET RANKING"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "أفضل الأسهم المصرية والأمريكية" : "Top Ranked Popular Stocks"}
                        </h2>
                    </div>

                    {/* Embedding RecommendationsTable limited to 3 rows */}
                    <div className="mb-10">
                        <RecommendationsTable isLandingPage={true} limit={3} />
                    </div>

                    {/* Prominent MORE Button Linking to TOP STOCKS */}
                    <div className="flex justify-center">
                        <Link
                            href="/scanner/backtests"
                            className="inline-flex items-center gap-3 px-8 py-5 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black text-lg uppercase shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer"
                        >
                            {isAr ? "عرض الترتيب الكامل للأسهم ←" : "See the full US & EGX Stocks ranking →"}
                        </Link>
                    </div>
                </div>
            </section>

            {/* Use Cases & Performance Proof (danelfin inspired with pure neobrutalist CSS/SVG charts) */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-900">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-orange text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[1.5deg] mb-4">
                            {isAr ? "إحصائيات الأداء" : "PERFORMANCE EVIDENCE"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "حالات استخدام إشارات الذكاء الاصطناعي" : "How AI Score Improves Investment Results"}
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        {/* Case 1: Pick the Winners. Avoid the Losers. */}
                        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 flex flex-col justify-between shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                            <div>
                                <h3 className="text-xl sm:text-2xl font-black text-black dark:text-white mb-3 tracking-tight">
                                    {isAr ? "1. اختر الرابحين وتجنب الخاسرين" : "1. Pick the Winners. Avoid the Losers."}
                                </h3>
                                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-6 font-bold">
                                    {isAr 
                                        ? "الأسهم التي حصلت على تقييم مرتفع (10/10) تتفوق تاريخياً على مؤشر السوق بشكل ملحوظ، بينما الأسهم التي حصلت على تقييم منخفض (1/10) تحقق عوائد سلبية وتؤدي لخسائر." 
                                        : "Stocks with the highest AI Score (10/10) outperform the market index significantly, while stocks with the lowest AI Score (1/10) underperform the benchmark."}
                                </p>
                            </div>

                            {/* Neobrutalist Bar Chart */}
                            <div className="my-6">
                                <div className="text-[10px] font-black uppercase text-zinc-400 mb-2 font-mono">
                                    📈 {isAr ? "متوسط الأداء التاريخي حسب التقييم" : "Average Alpha Return per AI Score Group"}
                                </div>
                                <div className="relative w-full h-44 bg-zinc-50 dark:bg-zinc-900 border-4 border-black dark:border-white p-4 flex justify-around items-center shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                                    {/* Baseline zero */}
                                    <div className="absolute left-0 right-0 top-[50%] h-[2px] bg-black dark:bg-white z-0" />
                                    
                                    {BARS_ALPHA.map((bar, idx) => (
                                        <div key={idx} className="relative h-full flex flex-col justify-between items-center w-12 z-10">
                                            {/* Value text */}
                                            <span className={`text-[10px] font-black font-mono absolute ${bar.isPos ? 'bottom-[78%]' : 'top-[78%]'}`}>
                                                {bar.val > 0 ? "+" : ""}{bar.val}%
                                            </span>
                                            
                                            {/* Bar filled */}
                                            <div 
                                                className={`absolute w-8 border-2 border-black ${bar.color} ${
                                                    bar.isPos 
                                                        ? 'bottom-[50%] origin-bottom' 
                                                        : 'top-[50%] origin-top'
                                                }`}
                                                style={{ height: `${bar.heightPct * 0.45}%` }}
                                            />
                                            
                                            {/* Axis Label */}
                                            <span className="text-[9px] font-black uppercase text-zinc-500 dark:text-zinc-400 mt-auto">
                                                {isAr && bar.label === "Benchmark" ? "المؤشر" : bar.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Link 
                                href="/scanner/backtests" 
                                className="text-sm font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1.5 mt-4"
                            >
                                {isAr ? "شاهد أفضل الأسهم اليوم" : "See Today's Top Stocks"}
                                <ArrowRight className={`w-4 h-4 ${isAr ? 'rotate-180' : ''}`} />
                            </Link>
                        </div>

                        {/* Case 2: Generate Superior Returns */}
                        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 flex flex-col justify-between shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                            <div>
                                <h3 className="text-xl sm:text-2xl font-black text-black dark:text-white mb-3 tracking-tight">
                                    {isAr ? "2. تحقيق عوائد استراتيجية فائقة" : "2. Generate Superior Returns"}
                                </h3>
                                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-6 font-bold">
                                    {isAr
                                        ? "قمنا بمحاكاة واختبار استراتيجية الأسهم المختارة بالذكاء الاصطناعي (تقييم 8 أو أعلى) ضد مؤشر السوق التاريخي لإظهار الفارق الحقيقي في الأداء."
                                        : "We backtested our AI-powered Best Stocks strategy (stocks with AI score >= 8) against the benchmark EGX 30 index to demonstrate predictive capabilities."}
                                </p>
                            </div>

                            {/* SVG Line Chart */}
                            <div className="my-6">
                                <div className="text-[10px] font-black uppercase text-zinc-400 mb-2 font-mono">
                                    📊 {isAr ? "العائد التراكمي الاستراتيجي" : "Cumulative Performance Simulation"}
                                </div>
                                <svg className="w-full h-44 bg-zinc-50 dark:bg-zinc-900 border-4 border-black dark:border-white p-2 shadow-[4px_4px_0px_rgba(0,0,0,1)]" viewBox="0 0 300 150">
                                    {/* Grid Lines */}
                                    <line x1="20" y1="25" x2="280" y2="25" stroke="currentColor" strokeDasharray="3,3" opacity="0.2" />
                                    <line x1="20" y1="65" x2="280" y2="65" stroke="currentColor" strokeDasharray="3,3" opacity="0.2" />
                                    <line x1="20" y1="105" x2="280" y2="105" stroke="currentColor" strokeDasharray="3,3" opacity="0.2" />
                                    
                                    {/* Benchmark Index Path */}
                                    <path 
                                        d="M 20,120 L 70,115 L 120,122 L 170,105 L 220,102 L 270,95" 
                                        fill="none" 
                                        stroke="#9ca3af" 
                                        strokeWidth="4" 
                                        strokeLinecap="round"
                                    />
                                    <circle cx="270" cy="95" r="5" fill="#9ca3af" stroke="#000" strokeWidth="2" />
                                    
                                    {/* AI Strategy Path */}
                                    <path 
                                        d="M 20,120 L 70,105 L 120,80 L 170,55 L 220,38 L 270,15" 
                                        fill="none" 
                                        stroke="#10b981" 
                                        strokeWidth="5" 
                                        strokeLinecap="round"
                                    />
                                    <circle cx="270" cy="15" r="6" fill="#10b981" stroke="#000" strokeWidth="2" />
                                    
                                    {/* Text Legend overlay */}
                                    <text x="25" y="20" className="text-[10px] font-black fill-emerald-600 dark:fill-emerald-400 font-mono">
                                        {isAr ? "استراتيجية الذكاء الاصطناعي (+284%)" : "AI Strategy (+284%)"}
                                    </text>
                                    <text x="25" y="140" className="text-[10px] font-black fill-zinc-500 font-mono">
                                        {isAr ? "مؤشر السوق EGX 30 (+112%)" : "EGX 30 Benchmark (+112%)"}
                                    </text>
                                </svg>
                            </div>

                            <Link 
                                href="/scanner/backtests" 
                                className="text-sm font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1.5 mt-4"
                            >
                                {isAr ? "شاهد أفضل الأسهم اليوم" : "See Today's Top Stocks"}
                                <ArrowRight className={`w-4 h-4 ${isAr ? 'rotate-180' : ''}`} />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Testimonials Slider Section */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-pink text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[-1deg] mb-4">
                            {isAr ? "آراء عملائنا" : "WHAT OUR USERS SAY"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "آراء المستثمرين والمستخدمين" : "Trusted by Investors"}
                        </h2>
                    </div>

                    {/* Testimonial Active Slide */}
                    <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-900 p-8 sm:p-12 relative shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)]">
                        <div className="flex gap-1 mb-6 justify-center sm:justify-start">
                            {[...Array(TESTIMONIALS[activeTestimonial].stars)].map((_, i) => (
                                <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-500" />
                            ))}
                        </div>

                        <blockquote className="text-lg sm:text-xl md:text-2xl font-black text-black dark:text-white leading-relaxed italic mb-8">
                            "{isAr ? TESTIMONIALS[activeTestimonial].quoteAr : TESTIMONIALS[activeTestimonial].quoteEn}"
                        </blockquote>

                        <div className="flex flex-col sm:flex-row justify-between items-center gap-6">
                            <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                                — {isAr ? TESTIMONIALS[activeTestimonial].authorAr : TESTIMONIALS[activeTestimonial].authorEn}
                            </span>

                            {/* Slider Navigation */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setActiveTestimonial(prev => (prev === 0 ? TESTIMONIALS.length - 1 : prev - 1))}
                                    className="w-10 h-10 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-black dark:text-white flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setActiveTestimonial(prev => (prev === TESTIMONIALS.length - 1 ? 0 : prev + 1))}
                                    className="w-10 h-10 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-black dark:text-white flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Analysis Scanners / Tools Grid */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-900">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-orange text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[1deg] mb-4">
                            {isAr ? "قوة التحليل" : "POWERS & SCANNERS"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "أدوات التحليل والمسح الذكي" : "Advanced Scanning Systems"}
                        </h2>
                        <p className="text-sm sm:text-base md:text-lg text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto mt-4 font-bold">
                            {isAr
                                ? "نظامان متكاملان ومصممان خصيصاً للبورصة المصرية والأمريكية لتسهيل قرارات الاستثمار."
                                : "Two robust systems engineered specifically for the EGX & US markets to enhance your trading strategies."}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-10 max-w-4xl mx-auto">
                        {scanners.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 flex flex-col overflow-hidden shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-200 group"
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
                                    <div className={`w-14 h-14 border-4 border-black dark:border-white ${item.colorClass} flex items-center justify-center text-black dark:text-black mb-6 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]`}>
                                        <item.icon className="w-8 h-8 text-black dark:text-black" />
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
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-20">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-pink text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[-1deg] mb-4">
                            {isAr ? "آلية العمل" : "SIMPLE WORKFLOW"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "كيف تعمل المنصة؟" : "How It Works"}
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-8 pt-6 max-w-4xl mx-auto">
                        {steps.map((step) => (
                            <div
                                key={step.n}
                                className="border-4 border-black dark:border-white p-8 flex flex-col bg-white dark:bg-zinc-950 relative mt-6 md:mt-0 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer"
                            >
                                <div className={`absolute -top-7 -start-6 w-14 h-14 border-4 border-black dark:border-white ${step.colorClass} flex items-center justify-center font-black text-2xl text-black shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]`}>
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
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-900">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-green text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[1.5deg] mb-4">
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
                                className="border-4 border-black dark:border-white p-6 sm:p-8 bg-white dark:bg-zinc-950 flex gap-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer"
                            >
                                <div className={`w-14 h-14 border-4 border-black dark:border-white ${feat.colorClass} flex items-center justify-center text-black dark:text-black shrink-0 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]`}>
                                    <feat.icon className="w-7 h-7 text-black dark:text-black" />
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

            {/* ====== HISTORICAL SIMILARITY SECTION ====== */}
            <section id="similarity" className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-950 dark:text-white">
                <div className="max-w-6xl mx-auto">

                    {/* Header */}
                    <div className="text-center mb-12">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-cyan text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[-1deg] mb-4 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                            {isAr ? "محرك التشابه التاريخي" : "HISTORICAL PATTERN MATCHING"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight mb-4">
                            {isAr ? "التشابه التاريخي" : "Historical Similarity"}
                        </h2>
                        <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 max-w-2xl mx-auto font-bold leading-relaxed">
                            {isAr
                                ? "يقوم المحرك بمسح التاريخ الكامل لكل سهم، يجد أكثر الأنماط تشابهاً باستخدام تشابه جيب التمام، ثم يتوقع المسارات المستقبلية بناءً على ما حدث إحصائياً في تلك التطابقات التاريخية."
                                : "The engine scans each symbol's full price history, finds the most similar chart patterns via cosine similarity, then projects forward trajectories based on what statistically happened next."
                            }
                        </p>
                    </div>

                    {/* Main Grid: Setups Panel + Stats+Chart */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                        {/* LEFT — Published Setups Panel */}
                        <div className="lg:col-span-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 dark:text-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] flex flex-col">
                            <div className="border-b-4 border-black dark:border-white px-5 py-3 flex items-center justify-between bg-zinc-100 dark:bg-zinc-900">
                                <span className="font-black text-sm uppercase tracking-widest text-black dark:text-white flex items-center gap-2">
                                    <Search className="w-4 h-4" />
                                    {isAr ? "الإعدادات المنشورة" : "PUBLISHED SETUPS"}
                                </span>
                                <span className="font-mono text-[10px] border-2 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black dark:text-black px-2 py-0.5 font-black">
                                    {MOCK_SIMILARITY_STOCKS.length} {isAr ? "سهم" : "STOCKS"}
                                </span>
                            </div>

                            <div className="flex-1 p-3 space-y-2">
                                {MOCK_SIMILARITY_STOCKS.map((stock, idx) => {
                                    const isActive = selectedSimStock.symbol === stock.symbol;
                                    return (
                                        <button
                                            key={stock.symbol}
                                            onClick={() => setSelectedSimStock(stock)}
                                            className={`w-full text-left p-3.5 border-2 font-mono text-xs cursor-pointer transition-all duration-100 ${
                                                isActive
                                                    ? "border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black dark:text-black shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] translate-x-[-1px] translate-y-[-1px]"
                                                    : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-black dark:text-white hover:border-black dark:hover:border-white"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="font-black text-sm uppercase">{stock.symbol}.EGX</span>
                                                <span className={`text-[10px] font-black px-2 py-0.5 border-2 border-black dark:border-white ${
                                                    isActive ? "bg-black text-emerald-400" : "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-400"
                                                }`}>
                                                    {(stock.winRate * 100).toFixed(0)}% Win
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className={`text-[10px] ${isActive ? "text-black/70" : "text-zinc-500 dark:text-zinc-400"}`}>
                                                    Avg Return: <span className="font-black text-emerald-600 dark:text-emerald-400">+{(stock.avgReturn * 100).toFixed(1)}%</span>
                                                </span>
                                                <span className={`text-[9px] ${isActive ? "text-black/60" : "text-zinc-400 dark:text-zinc-500"}`}>
                                                    {stock.totalMatches} / 0
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="border-t-2 border-zinc-200 dark:border-zinc-800 px-5 py-2 flex justify-between font-mono text-[9px] text-zinc-400">
                                <span>Published: Jun 14, 2026</span>
                                <span>AL 1</span>
                            </div>
                        </div>

                        {/* RIGHT — Stats + Chart */}
                        <div className="lg:col-span-8 space-y-5">

                            {/* 4 stat cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { label: isAr ? "نسبة الربح" : "WIN RATE",       value: `${(selectedSimStock.winRate * 100).toFixed(1)}%`,          sub: `${Math.round(selectedSimStock.totalMatches * selectedSimStock.winRate)} Wins / ${Math.round(selectedSimStock.totalMatches * (1 - selectedSimStock.winRate))} Losses`, color: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500" },
                                    { label: isAr ? "متوسط العائد" : "AVG RETURN",  value: `${(selectedSimStock.avgReturn * 100).toFixed(2)}%`,          sub: `Across ${selectedSimStock.totalMatches} matches`,    color: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500" },
                                    { label: isAr ? "عامل الربح" : "PROFIT FACTOR", value: selectedSimStock.profitFactor.toFixed(2),                   sub: "Gross profit/loss ratio",                            color: "text-amber-600 dark:text-amber-400",   border: "border-amber-400" },
                                    { label: isAr ? "القيمة المتوقعة" : "EXPECTED EDGE", value: `${(selectedSimStock.expectedValue * 100).toFixed(2)}%`, sub: "Expected yield per trade",                           color: selectedSimStock.expectedValue >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400", border: selectedSimStock.expectedValue >= 0 ? "border-emerald-500" : "border-red-500" },
                                ].map((stat) => (
                                    <div key={stat.label} className={`border-4 border-black dark:border-white p-4 bg-white dark:bg-zinc-950 dark:text-white shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]`}>
                                        <span className="font-mono text-[9px] uppercase tracking-widest block text-zinc-500 dark:text-zinc-400">{stat.label}</span>
                                        <span className={`text-2xl md:text-3xl font-black font-mono block mt-1 ${stat.color}`}>{stat.value}</span>
                                        <span className="font-mono text-[9px] block text-zinc-400 dark:text-zinc-500 mt-1">{stat.sub}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Spaghetti Chart */}
                            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 dark:text-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                                {/* Chart header */}
                                <div className="border-b-4 border-black dark:border-white px-5 py-3 flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900">
                                    <GitGraph className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                    <span className="font-black text-sm uppercase tracking-wider text-black dark:text-white">
                                        {selectedSimStock.symbol}.EGX {isAr ? "مخطط مسارات الإسقاط" : "TRAJECTORY SPAGHETTI PLOT"}
                                    </span>
                                    <span className="ml-auto font-mono text-[9px] text-zinc-400 dark:text-zinc-500 uppercase">T = {isAr ? "نقطة الدخول" : "Entry Point"}</span>
                                </div>

                                <div className="p-5">
                                    {/* SVG Chart area */}
                                    <div className="relative h-64 w-full border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                                        {/* Horizontal gridlines */}
                                        {[0,25,50,75,100].map(pct => (
                                            <div key={pct} className="absolute left-0 right-0 border-t border-dashed border-zinc-200 dark:border-zinc-800" style={{ top: `${pct}%` }} />
                                        ))}
                                        {/* Zero / baseline */}
                                        <div className="absolute left-0 right-0 border-t-2 border-dashed border-amber-400/50" style={{ top: '55%' }} />
                                        <span className="absolute right-1 font-mono text-[8px] text-amber-500" style={{ top: '53%' }}>0%</span>
                                        {/* T vertical marker */}
                                        <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-zinc-400/40" style={{ left: '47.5%' }}>
                                            <span className="absolute -top-0 -left-2.5 font-mono text-[8px] font-black text-zinc-500">T</span>
                                        </div>
                                        {/* Future tint */}
                                        <div className="absolute top-0 bottom-0 bg-emerald-50/60 dark:bg-emerald-900/10" style={{ left: '47.5%', right: 0 }} />

                                        {/* SVG lines */}
                                        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 256" preserveAspectRatio="none">
                                            {(["M1","M2","M3","M4","M5"] as const).map((key, ki) => {
                                                const colors = ["#3b82f6","#a855f7","#f97316","#06b6d4","#ec4899"];
                                                const pts = SIMILARITY_CHART_DATA.map((d: any, i) => {
                                                    const x = (i / (SIMILARITY_CHART_DATA.length - 1)) * 600;
                                                    const y = 140 - (d[key] ?? 0) * 10;
                                                    return `${x.toFixed(1)},${Math.max(4, Math.min(252, y)).toFixed(1)}`;
                                                }).join(" ");
                                                return <polyline key={key} points={pts} fill="none" stroke={colors[ki]} strokeWidth="1.2" opacity="0.4" strokeLinejoin="round" strokeLinecap="round" />;
                                            })}
                                            {/* Average green line */}
                                            <polyline
                                                points={SIMILARITY_CHART_DATA.map((d: any, i) => {
                                                    const x = (i / (SIMILARITY_CHART_DATA.length - 1)) * 600;
                                                    const y = 140 - (d.Avg ?? 0) * 10;
                                                    return `${x.toFixed(1)},${Math.max(4, Math.min(252, y)).toFixed(1)}`;
                                                }).join(" ")}
                                                fill="none" stroke="#10b981" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"
                                            />
                                            {/* Target yellow dashed */}
                                            <polyline
                                                points={SIMILARITY_CHART_DATA.filter((d: any) => d.Target !== null).map((d: any, i) => {
                                                    const x = (i / (SIMILARITY_CHART_DATA.length - 1)) * 600;
                                                    const y = 140 - (d.Target ?? 0) * 10;
                                                    return `${x.toFixed(1)},${Math.max(4, Math.min(252, y)).toFixed(1)}`;
                                                }).join(" ")}
                                                fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="8 4"
                                            />
                                        </svg>

                                        {/* Y labels */}
                                        {["+10%","+5%","0%","-5%"].map((lbl,i) => (
                                            <span key={i} className="absolute left-1 font-mono text-[7px] text-zinc-400" style={{ top: `${8 + i * 24}%` }}>{lbl}</span>
                                        ))}
                                    </div>

                                    {/* X axis */}
                                    <div className="flex justify-between mt-1 px-1">
                                        {["T-9","T-7","T-5","T-3","T-1","T","T+2","T+4","T+6","T+8","T+10"].map(l => (
                                            <span key={l} className={`font-mono text-[8px] ${l === "T" ? "text-black dark:text-white font-black" : "text-zinc-400"}`}>{l}</span>
                                        ))}
                                    </div>

                                    {/* Legend */}
                                    <div className="flex flex-wrap gap-4 mt-3 font-mono text-[9px] uppercase text-zinc-500 dark:text-zinc-400">
                                        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 border-t-2 border-dashed border-amber-500"></span>{isAr ? "النمط الحالي" : "Current Pattern"}</span>
                                        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-emerald-500"></span>{isAr ? "متوسط المتوقع" : "Avg Projected"}</span>
                                        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-500 opacity-50"></span>{isAr ? "التطابقات التاريخية" : "Historical Matches (×5)"}</span>
                                    </div>
                                </div>
                            </div>

                            {/* CTA link */}
                            <div className="flex justify-end">
                                <Link
                                    href="/scanner/backtests?tab=similarity"
                                    className="inline-flex items-center gap-2 px-6 py-3 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black text-sm uppercase shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer"
                                >
                                    {isAr ? "عرض الإشارات الحية" : "Open Live Signals"}
                                    <ArrowRight className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`} />
                                </Link>
                            </div>

                        </div>
                    </div>

                    <p className="font-mono text-[9px] uppercase tracking-widest text-center mt-8 text-zinc-400 dark:text-zinc-500">
                        // {isAr ? "النتائج مبنية على اختبارات تاريخية. الأداء السابق لا يضمن النتائج المستقبلية." : "Results based on historical backtests. Past performance does not guarantee future results."}
                    </p>
                </div>
            </section>

            {/* ====== LIVE SIGNAL DEMO SECTION ====== */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-black text-white relative overflow-hidden">
                {/* Animated grid background */}
                <div className="absolute inset-0 opacity-20">
                    <div className="absolute inset-0" style={{
                        backgroundImage: 'linear-gradient(rgba(250,204,21,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(250,204,21,0.1) 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }} />
                </div>

                <div className="max-w-6xl mx-auto relative z-10">
                    {/* Header with animated badge */}
                    <div className="text-center mb-12">
                        <div className="inline-block border-4 border-yellow-400 bg-yellow-400 text-black dark:text-black px-4 py-1.5 font-black text-xs uppercase tracking-widest mb-6 animate-pulse shadow-[0_0_20px_rgba(250,204,21,0.6)]">
                            // HISTORICAL PATTERN RECOGNITION ENGINE
                        </div>
                        
                        <h2 className="text-4xl sm:text-6xl font-black mb-4 tracking-tight text-white">
                            <span className="block">HISTORICAL</span>
                            <span className="block text-yellow-400 text-5xl sm:text-7xl animate-[pulse_2s_ease-in-out_infinite]">SIMILARITY</span>
                        </h2>

                        <div className="max-w-3xl mx-auto border-l-4 border-yellow-400 pl-6 text-left">
                            <p className="text-sm sm:text-base text-zinc-300 font-mono leading-relaxed">
                                {isAr 
                                    ? "المحرك يقوم بمسح التاريخ الكامل لكل سهم، يجد أكثر الأنماط تشابهاً باستخدام تشابه جيب التمام، ثم يتوقع المسارات المستقبلية بناءً على ما حدث إحصائياً في تلك التطابقات التاريخية."
                                    : "The engine scans the entire price history of every symbol, finds the most similar chart patterns via cosine NLM similarity, then projects forward trajectories based on what statistically happened next in those historical matches."}
                            </p>
                        </div>
                    </div>

                    {/* Live Signal Demo Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
                        {/* Published Setups Panel */}
                        <div className="border-4 border-white bg-black">
                            <div className="border-b-4 border-white px-4 py-3 flex items-center justify-between">
                                <span className="font-black text-xs uppercase tracking-wider text-white">PUBLISHED SETUPS</span>
                                <span className="font-mono text-xs border-2 border-white bg-yellow-400 text-black dark:text-black px-2 py-0.5 font-black">4 STOCKS</span>
                            </div>
                            
                            <div className="p-3 space-y-2">
                                {[
                                    { symbol: "TMGH.EGX", win: "78% Win", active: true },
                                    { symbol: "CIB.EGX", win: "71% Win", active: false },
                                    { symbol: "EAST.EGX", win: "65% Win", active: false },
                                    { symbol: "PHRY.EGX", win: "60% Win", active: false },
                                ].map((stock, idx) => (
                                    <div 
                                        key={stock.symbol}
                                        className={`p-3 border-2 font-mono text-xs transition-all duration-300 hover:scale-[1.02] cursor-pointer ${
                                            stock.active 
                                                ? "border-yellow-400 bg-yellow-400 text-black dark:text-black shadow-[0_0_15px_rgba(250,204,21,0.5)]" 
                                                : "border-zinc-700 bg-zinc-900 hover:border-white text-white"
                                        }`}
                                        style={{ animationDelay: `${idx * 100}ms` }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-black">{stock.symbol}</span>
                                            <span className={`text-[10px] font-black px-2 py-0.5 border ${
                                                stock.active ? "border-black bg-black text-emerald-400" : "border-emerald-500 text-emerald-400"
                                            }`}>
                                                {stock.win}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="lg:col-span-2 grid grid-cols-2 gap-4">
                            {[
                                { label: "WIN RATE", value: "78.0%", sub: "14 Wins / 4 Losses", color: "text-emerald-400", border: "border-emerald-400" },
                                { label: "AVG RETURN", value: "14.20%", sub: "Across 18 matches", color: "text-emerald-400", border: "border-emerald-400" },
                                { label: "PROFIT FACTOR", value: "2.41", sub: "Gross profit/loss ratio", color: "text-amber-400", border: "border-amber-400" },
                                { label: "EXPECTED EDGE", value: "8.90%", sub: "Expected yield per trade", color: "text-emerald-400", border: "border-emerald-400" },
                            ].map((stat, idx) => (
                                <div 
                                    key={stat.label} 
                                    className={`border-4 ${stat.border} bg-black p-4 hover:scale-105 transition-transform duration-300 text-white`}
                                    style={{ animationDelay: `${idx * 150}ms` }}
                                >
                                    <span className="font-mono text-[9px] uppercase tracking-widest block text-zinc-400">{stat.label}</span>
                                    <span className={`text-3xl font-black font-mono block mt-2 ${stat.color}`}>{stat.value}</span>
                                    <span className="font-mono text-[9px] block text-zinc-500 mt-1">{stat.sub}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Chart Preview */}
                    <div className="border-4 border-white bg-black">
                        <div className="border-b-4 border-white px-5 py-3 font-black text-sm uppercase tracking-wider flex items-center gap-3 text-white">
                            <GitGraph className="w-4 h-4 text-amber-400" />
                            OF TMGH.EGX TRAJECTORY SPAGHETTI PLOT
                        </div>
                        <div className="p-6 relative h-64 bg-gradient-to-br from-zinc-900 to-black">
                            {/* Simulated chart lines with animation */}
                            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 256" preserveAspectRatio="none">
                                <defs>
                                    <linearGradient id="greenGlow" x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" style={{ stopColor: '#10b981', stopOpacity: 0.8 }} />
                                        <stop offset="100%" style={{ stopColor: '#10b981', stopOpacity: 0.2 }} />
                                    </linearGradient>
                                </defs>
                                {/* Target line (dashed yellow) */}
                                <polyline
                                    points="0,140 60,135 120,125 180,110 240,95 285,80"
                                    fill="none"
                                    stroke="#fbbf24"
                                    strokeWidth="3"
                                    strokeDasharray="10 5"
                                    className="animate-[dash_2s_linear_infinite]"
                                />
                                {/* Projected lines (green) */}
                                <polyline
                                    points="285,80 340,70 400,55 460,45 520,38 600,30"
                                    fill="none"
                                    stroke="#10b981"
                                    strokeWidth="3.5"
                                    className="animate-[fadeIn_1.5s_ease-in-out]"
                                />
                                {/* Helper lines (blue fade) */}
                                {[0, 10, 20, -10, -20].map((offset, idx) => (
                                    <polyline
                                        key={idx}
                                        points={`285,${80 + offset} 340,${70 + offset} 400,${55 + offset} 460,${45 + offset} 520,${38 + offset} 600,${30 + offset}`}
                                        fill="none"
                                        stroke="#3b82f6"
                                        strokeWidth="1.5"
                                        opacity="0.3"
                                        style={{ animationDelay: `${idx * 200}ms` }}
                                    />
                                ))}
                            </svg>
                            
                            {/* T marker */}
                            <div className="absolute left-1/2 top-0 bottom-0 border-l-2 border-dashed border-zinc-600">
                                <span className="absolute -top-1 -left-2 font-mono text-xs font-black text-zinc-400">T</span>
                            </div>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <div className="flex justify-center mt-12">
                        <Link
                            href="/scanner/backtests?tab=similarity"
                            className="group inline-flex items-center gap-3 px-8 py-4 border-4 border-yellow-400 bg-yellow-400 text-black font-black text-lg uppercase shadow-[4px_4px_0px_rgba(250,204,21,1)] hover:shadow-[8px_8px_0px_rgba(250,204,21,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-200"
                        >
                            OPEN LIVE SIGNALS
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </section>

            {/* ====== TRANSPARENT SYSTEM STATISTICS SECTION ====== */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-black text-white">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        
                        {/* LEFT: Text Content */}
                        <div>
                            <h2 className="text-4xl sm:text-5xl font-black mb-6 tracking-tight leading-tight text-white">
                                TRANSPARENT SYSTEM<br />
                                <span className="text-yellow-400">STATISTICS</span>
                            </h2>
                            
                            <div className="border-l-4 border-yellow-400 pl-6 mb-8">
                                <p className="text-sm sm:text-base text-zinc-300 font-bold leading-relaxed mb-4">
                                    {isAr 
                                        ? "نقوم بقياس نماذجنا الكمية يومياً مقابل مجموعات اختبار واسعة، نقيس مقاييس الأداء الدقيقة لكل نموذج لضمان الشفافية والمساءلة التامة."
                                        : "We benchmark our quantitative models daily against broad test sets, measuring precise performance metrics to ensure complete transparency and accountability."}
                                </p>
                                <div className="border-l-4 border-emerald-400 pl-4 bg-emerald-950/20 py-3">
                                    <p className="font-mono text-xs text-emerald-400 uppercase tracking-wide">
                                        // MULTI-MODEL ENSEMBLE
                                    </p>
                                    <p className="text-sm text-zinc-300 font-bold mt-1">
                                        {isAr 
                                            ? "عوائد محفظة AI مقابل مؤشر EGX30 (بيانات متداولة 2023-2026)."
                                            : "AI portfolio returns vs. EGX30 Index (2023-2026 rolling data)."}
                                    </p>
                                </div>
                            </div>

                            {/* Estimate Button */}
                            <div className="inline-flex items-center gap-3 px-6 py-3 border-4 border-yellow-400 bg-yellow-400 text-black dark:text-black font-black text-sm uppercase cursor-pointer hover:scale-105 transition-transform shadow-[4px_4px_0px_rgba(250,204,21,0.5)]">
                                <span className="w-3 h-3 bg-black rounded-full animate-pulse" />
                                OPTIMIZE ESTIMATIONS ⚡
                            </div>

                            {/* Live Stats */}
                            <div className="grid grid-cols-2 gap-4 mt-8">
                                <div className="border-4 border-white bg-black p-4 hover:border-emerald-400 transition-colors duration-300 text-white">
                                    <span className="font-mono text-xs uppercase text-zinc-400 block">Precision</span>
                                    <span className="text-3xl font-black text-white block mt-1">74.8%</span>
                                    <span className="font-mono text-[9px] text-zinc-500 block mt-1">Classified across full backtest</span>
                                </div>
                                <div className="border-4 border-white bg-black p-4 hover:border-emerald-400 transition-colors duration-300 text-white">
                                    <span className="font-mono text-xs uppercase text-zinc-400 block">Excess Return</span>
                                    <span className="text-3xl font-black text-emerald-400 block mt-1">+20.6%</span>
                                    <span className="font-mono text-[9px] text-zinc-500 block mt-1">Better than the standard buy-and-hold Index</span>
                                </div>
                            </div>

                            {/* Signal Info Bar */}
                            <div className="border-4 border-white bg-black px-4 py-3 mt-6 font-mono text-xs text-white">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-zinc-400 uppercase">SYMBOL: TMGH // PRICE: 86.50</span>
                                    <div className="flex gap-2">
                                        <span className="border-2 border-emerald-400 bg-emerald-400/20 text-emerald-400 px-2 py-0.5 font-black">AI SCORE: 9 / 10</span>
                                        <span className="border-2 border-white bg-white text-black px-2 py-0.5 font-black">SHARP ↗</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT: Model Performance Panel */}
                        <div className="border-4 border-white bg-black p-6 hover:shadow-[0_0_30px_rgba(250,204,21,0.3)] transition-all duration-500 text-white">
                            <div className="border-b-2 border-zinc-800 pb-3 mb-6 flex items-center justify-between">
                                <span className="font-black text-sm uppercase">MODEL IDENTIFIER</span>
                                <span className="font-mono text-[9px] uppercase text-zinc-500">OUT-OF-SAMPLE ACCURACY</span>
                            </div>

                            <div className="space-y-5">
                                {[
                                    { id: 1, name: "RANDOM FOREST ENSEMBLE (AI 10 SCORE)", accuracy: 81.4, color: "bg-emerald-500", width: "95%" },
                                    { id: 2, name: "LOGISTIC REGRESSION SCANNER (AI 7-9 SCORE)", accuracy: 68.5, color: "bg-emerald-400", width: "75%" },
                                    { id: 3, name: "BENCHMARK (COIN TOSS MODEL)", accuracy: 50.0, color: "bg-zinc-600", width: "50%" },
                                    { id: 4, name: "NEGATIVE SURFACE DETECTOR (AI 1-3 SCORE)", accuracy: 21.2, color: "bg-rose-500", width: "25%" },
                                ].map((model, idx) => (
                                    <div 
                                        key={model.id}
                                        className="group"
                                        style={{ animation: `slideIn 0.6s ease-out ${idx * 150}ms both` }}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="font-mono text-[10px] text-zinc-300 uppercase tracking-wide">
                                                {model.id}. {model.name}
                                            </span>
                                            <span className="font-black text-sm text-white">{model.accuracy}%</span>
                                        </div>
                                        <div className="h-2 bg-zinc-800 relative overflow-hidden">
                                            <div 
                                                className={`h-full ${model.color} transition-all duration-1000 ease-out group-hover:brightness-125`}
                                                style={{ width: model.width, animationDelay: `${idx * 150}ms` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <p className="font-mono text-[8px] uppercase text-center mt-8 text-zinc-600 tracking-widest">
                                // NATIVELY VISUALIZED IN REAL-TIME ON UNIVERSE BACKTEST FIG //
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Final CTA Banner */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-4xl mx-auto">
                    <div className="border-4 border-black dark:border-white bg-[#fb923c] dark:bg-amber-500 p-8 sm:p-16 text-center relative overflow-hidden shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_rgba(0,0,0,1)] dark:hover:shadow-[10px_10px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer">
                        {/* Interactive decorative badges */}
                        <div className="absolute top-6 right-6 border-4 border-black px-4 py-1.5 neobrutal-bg-yellow font-black text-[11px] uppercase tracking-widest rotate-6 hidden sm:block shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                            100% FREE
                        </div>
                        <div className="absolute bottom-6 left-6 border-4 border-black px-4 py-1.5 neobrutal-bg-cyan font-black text-[11px] uppercase tracking-widest -rotate-6 hidden sm:block shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                            EGX SIGNALS
                        </div>

                        <div className="w-16 h-16 border-4 border-black neobrutal-bg-yellow flex items-center justify-center mx-auto mb-6 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                            <Zap className="w-8 h-8 text-black" />
                        </div>

                        <h2 className="text-3xl sm:text-5xl font-black text-black mb-4 tracking-tighter">
                            {isAr ? "جاهز لبدء رحلة الاستثمار الذكي؟" : "Ready to Start Trading Smarter?"}
                        </h2>
                        
                        <p className="text-sm sm:text-lg text-black font-extrabold mb-10 max-w-xl mx-auto leading-relaxed">
                            {isAr
                                ? "انضم الآن إلى منصة EGX BOTS واستفد من التقييمات الفنية وإشارات الذكاء الاصطناعي مجاناً."
                                : "Join EGX BOTS platform now and leverage technical scanners and AI-powered signals for free today."}
                        </p>

                        <Link
                            href={user ? "/scanner/backtests" : "/signup"}
                            className="h-16 px-10 border-4 border-black bg-black text-white font-black text-base sm:text-lg shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer inline-flex items-center justify-center gap-3"
                        >
                            {isAr ? "ابدأ الآن مجاناً" : "Start Now For Free"}
                            <ArrowRight className={`w-5 h-5 transition-transform ${isAr ? "rotate-180" : ""}`} />
                        </Link>
                    </div>
                </div>
            </section>

            {/* Custom Animations - moved inline for simplicity */}
        </div>
    );
}
