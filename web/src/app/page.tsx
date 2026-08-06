"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useChat } from "@/contexts/ChatContext";
import {
    Brain,
    Zap,
    ArrowRight,
    Smartphone,
    Activity,
    Shield,
    Sparkles,
    ChevronLeft,
    ChevronRight,
    Star,
    GitGraph,
    Search,
    Loader2,
    ArrowUpRight,
    ArrowDownRight,
    DollarSign,
    Landmark,
    Layers,
    AlertTriangle,
    MessageSquare,
    Camera,
    CheckCircle2,
} from "lucide-react";
import { useState, useEffect } from "react";
import RecommendationsTable from "@/components/RecommendationsTable";

const STATS = [
    { value: "279+", labelEn: "EGX Symbols", labelAr: "سهم مصري", colorClass: "neobrutal-bg-yellow" },
    { value: "AI", labelEn: "ML Models", labelAr: "نماذج ذكاء", colorClass: "neobrutal-bg-green" },
    { value: "24/7", labelEn: "Bot Monitoring", labelAr: "مراقبة البوت", colorClass: "neobrutal-bg-pink" },
    { value: "Daily", labelEn: "Market Scans", labelAr: "مسح يومي", colorClass: "neobrutal-bg-cyan" },
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

// Fallback data only used when API is unreachable
const FALLBACK_SIMILARITY_STOCKS = [
    { symbol: "TMGH", name: "Talaat Moustafa Group", similarity: 79.4, winRate: 0.78, avgReturn: 0.142, totalMatches: 18, wins: 14, losses: 4, profitFactor: 2.41, expectedValue: 0.089 },
];

export default function HomePage() {
    const { user } = useAuth();
    const { language } = useLanguage();
    const { setIsOpen } = useChat();
    const isAr = language === "ar";

    const [activeTestimonial, setActiveTestimonial] = useState(0);
    const [similarityScans, setSimilarityScans] = useState<any[]>(FALLBACK_SIMILARITY_STOCKS);
    const [similarityUpdatedAt, setSimilarityUpdatedAt] = useState<string | null>(null);
    const [selectedSimStock, setSelectedSimStock] = useState<any>(FALLBACK_SIMILARITY_STOCKS[0]);
    const [simChartData, setSimChartData] = useState<any[]>([]);
    const [recentNews, setRecentNews] = useState<any[]>([]);
    const [newsLoading, setNewsLoading] = useState(true);
    const [marketData, setMarketData] = useState<any>(null);
    const [marketLoading, setMarketLoading] = useState(true);

    useEffect(() => {
        setNewsLoading(true);
        fetch("/api/scan/news?limit=3")
            .then(res => res.json())
            .then(data => {
                if (data?.data) {
                    setRecentNews(data.data);
                }
            })
            .catch(err => console.error("Error fetching homepage news:", err))
            .finally(() => setNewsLoading(false));
    }, []);

    useEffect(() => {
        fetch("/api/scan/similarity/published")
            .then(res => res.json())
            .then(data => {
                if (data?.scans && data.scans.length > 0) {
                    const mapped = data.scans.map((s: any) => ({
                        symbol: s.symbol,
                        name: s.symbol,
                        similarity: s.stats?.win_rate ? Math.round(s.stats.win_rate * 100) : 0,
                        winRate: s.stats?.win_rate || 0,
                        avgReturn: s.stats?.average_return || 0,
                        totalMatches: s.stats?.total_matches || 0,
                        wins: s.stats?.wins || 0,
                        losses: s.stats?.losses || 0,
                        profitFactor: s.stats?.profit_factor || 0,
                        expectedValue: s.stats?.expected_value || 0,
                        scan: s,
                    }));
                    setSimilarityScans(mapped);
                    setSelectedSimStock(mapped[0]);
                    setSimilarityUpdatedAt(data.updated_at);
                    if (mapped[0]?.scan) {
                        const chartData = transformSimChart(mapped[0].scan, data.forward_days || 10);
                        setSimChartData(chartData);
                    }
                }
            })
            .catch(() => {});
    }, []);

    const getMarketStats = (points: any[]) => {
        if (!points || points.length < 2) return { last: 0, change: 0, changePct: 0 };
        const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1].close;
        const prev = sorted[sorted.length - 2].close;
        const change = last - prev;
        const changePct = (change / prev) * 100;
        return { last, change, changePct };
    };

    useEffect(() => {
        let cancelled = false;
        fetch("/api/market/status")
            .then(res => res.json())
            .then(data => {
                if (!cancelled) {
                    setMarketData(data);
                    setMarketLoading(false);
                }
            })
            .catch(err => {
                console.error("Error fetching homepage market data:", err);
                if (!cancelled) setMarketLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const transformSimChart = (scan: any, forwardDays: number) => {
        if (!scan?.matches) return [];
        const daysMap: Record<number, any> = {};
        for (let d = -9; d <= forwardDays; d++) {
            daysMap[d] = { day: d, dayLabel: d <= 0 ? `T${d}` : `T+${d}` };
        }
        if (scan.target_path) {
            scan.target_path.forEach((p: any, idx: number) => {
                const day = idx - 9;
                if (daysMap[day]) daysMap[day]["Target"] = p.rel_change * 100;
            });
        }
        scan.matches.slice(0, 5).forEach((m: any, mi: number) => {
            const key = `M${mi + 1}`;
            if (m.before_path) {
                m.before_path.forEach((p: any, idx: number) => {
                    const day = idx - 9;
                    if (daysMap[day]) daysMap[day][key] = p.rel_change * 100;
                });
            }
            if (m.forward_path) {
                m.forward_path.forEach((p: any) => {
                    if (daysMap[p.day]) daysMap[p.day][key] = p.return * 100;
                });
            }
        });
        for (let d = -9; d <= forwardDays; d++) {
            let sum = 0; let cnt = 0;
            scan.matches.slice(0, 5).forEach((_m: any, mi: number) => {
                const key = `M${mi + 1}`;
                if (daysMap[d][key] !== undefined) { sum += daysMap[d][key]; cnt++; }
            });
            if (cnt > 0) daysMap[d]["Avg"] = sum / cnt;
        }
        return Object.values(daysMap).sort((a: any, b: any) => a.day - b.day);
    };

    const scanners = [
        {
            href: "/scanner/backtests",
            icon: Brain,
            title: isAr ? "أفضل الأسهم (Top Stocks)" : "Top Stocks (AI Score)",
            desc: isAr
                ? "قائمة الأسهم اليومية مرتبة بناءً على تقييم الذكاء الاصطناعي (1-10) لفرص الصعود والهبوط."
                : "Daily ranking of stocks rated from 1 to 10 by the AI score.",
            badge: "AI LIVE",
            colorClass: "neobrutal-bg-cyan",
        },
        {
            href: "/scanner/technical",
            icon: Activity,
            title: isAr ? "الماسح الفني" : "Technical Scanner",
            desc: isAr
                ? "فلاتر فنية متقدمة وإشارات RSI وMACD وحجم التداول على كل الأسهم لحظياً."
                : "Technical filters including RSI, MACD, and volume on EGX stocks.",
            badge: "POPULAR",
            colorClass: "neobrutal-bg-yellow",
        },
    ];

    const steps = [
        {
            n: 1,
            title: isAr ? "الذكاء الاصطناعي يحلل الأسهم" : "AI Analyzes Stocks",
            desc: isAr
                ? "تحلل نماذج الذكاء الاصطناعي (Random Forest و LightGBM) أسهم البورصة المصرية لحظياً وتمنح كل سهم تقييماً من 1 إلى 10."
                : "AI models (Random Forest & LightGBM) analyze EGX stocks in real time and assign each a 1-to-10 AI score.",
            colorClass: "neobrutal-bg-yellow",
        },
        {
            n: 2,
            title: isAr ? "امسح وفلتر الفرص" : "Scan & Filter Opportunities",
            desc: isAr
                ? "استخدم الماسح الفني لفلترة الأسهم حسب تقييم AI والمؤشرات الفنية لتحديد أفضل الفرص بدقة."
                : "Use the technical scanner to filter stocks by AI score and technical indicators to pinpoint the best opportunities.",
            colorClass: "neobrutal-bg-pink",
        },
        {
            n: 3,
            title: isAr ? "راجع أداء النماذج تاريخياً" : "Review Model Performance",
            desc: isAr
                ? "اطّلع على نتائج الاختبارات العكسية ونسب النجاح وأداء النماذج على البيانات التاريخية لتقييم جودة الإشارات."
                : "Explore backtest results, win rates, and model performance on historical data to gauge signal quality.",
            colorClass: "neobrutal-bg-green",
        },
        {
            n: 4,
            title: isAr ? "استقبل الإشارات فوراً" : "Get Instant Signals",
            desc: isAr
                ? "احصل على إشارات الشراء والبيع لحظة ظهورها عبر تليجرام أو مباشرة من خلال واجهة المنصة."
                : "Receive buy and sell signals the moment they appear via Telegram or directly through the platform interface.",
            colorClass: "neobrutal-bg-cyan",
        },
    ];

    const features = [
        {
            icon: Brain,
            title: isAr ? "نماذج AI متقدمة" : "Advanced AI Models",
            desc: isAr
                ? "تكامل كامل مع خوارزميات Random Forest و LightGBM لدقة أعلى في تحديد إشارات السوق."
                : "A 1-to-10 AI score used to rank stock opportunities.",
            colorClass: "neobrutal-bg-yellow",
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
                ? "أدوات مخصصة تشمل الماسح الفني، عرض النتائج التاريخية، والتحليل الفني المتقدم في مكان واحد."
                : "Custom tools including technical scanner, historical backtest results view, and advanced data analysis.",
            colorClass: "neobrutal-bg-pink",
        },
    ];

    return (
        <div className="neobrutal-layout min-h-screen -mx-3 sm:-mx-6 md:-mx-8 overflow-hidden pb-16">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@graph": [
                            {
                                "@type": "FinancialService",
                                "@id": "https://egxbots.com/#financial-service",
                                "name": "EGX BOTS",
                                "url": "https://egxbots.com",
                                "logo": "https://egxbots.com/favicon_io/android-chrome-512x512.png",
                                "image": "https://egxbots.com/dashboard_preview.png",
                                "description": "منصة EGX BOTS (egxbots) هي منصة متقدمة لتحليل الأسهم المصرية باستخدام الذكاء الاصطناعي، الماسح الفني، والمحاكاة التاريخية وإشارات السوق.",
                                "sameAs": [
                                    "https://t.me/egxbots"
                                ],
                                "address": {
                                    "@type": "PostalAddress",
                                    "addressCountry": "EG"
                                }
                            },
                            {
                                "@type": "WebSite",
                                "@id": "https://egxbots.com/#website",
                                "url": "https://egxbots.com",
                                "name": "EGX BOTS",
                                "description": "تحليل البورصة المصرية بالذكاء الاصطناعي",
                                "publisher": {
                                    "@id": "https://egxbots.com/#financial-service"
                                },
                                "potentialAction": {
                                    "@type": "SearchAction",
                                    "target": {
                                        "@type": "EntryPoint",
                                        "urlTemplate": "https://egxbots.com/scanner/market?search={search_term_string}"
                                    },
                                    "query-input": "required name=search_term_string"
                                }
                            }
                        ]
                    })
                }}
            />
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
                                                    <div className="border-4 border-black dark:border-white bg-white p-3 rotate-[2deg] shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:rotate-0 hover:scale-110 transition-transform duration-300">
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

                    {/* Interactive AI Chatbot Spotlight Feature Banner */}
                    <div className="max-w-4xl mx-auto mb-14 p-6 sm:p-8 border-4 border-black dark:border-white neobrutal-bg-cyan text-black shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] rotate-[-0.5deg] hover:rotate-0 transition-transform duration-300 relative overflow-hidden text-right">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10 font-sans">
                            <div className="flex-1 space-y-3">
                                <div className="inline-flex items-center gap-2 border-2 border-black bg-yellow-300 px-3 py-1 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                                    <Sparkles className="w-4 h-4 text-black animate-bounce" style={{ animationDuration: '2s' }} />
                                    {isAr ? "الميزة الاستثنائية: شات بوت محادثة 24/7" : "Exclusive Feature: 24/7 Interactive AI Chatbot"}
                                </div>
                                <h3 className="text-2xl sm:text-4xl font-black text-black tracking-tight leading-tight">
                                    {isAr ? "🤖 شات بوت تفاعلي حقيقي للبورصة المصرية (وليس إشارات جافة فقط)" : "🤖 Real Interactive AI Chatbot (Not Just Static Signals)"}
                                </h3>
                                <p className="text-sm sm:text-base font-bold text-zinc-900 leading-relaxed">
                                    {isAr
                                        ? "على عكس المنصات التي تكتفي بإرسال إشارات أوتوماتيكية جافة، يتيح لك EGX Bots شات بوت محادثة ذكي يمكنك التحدث معه بالعربية والإنجليزي، رفع صورة/سكرين شوت لمحفظتك لتحليلها بالرؤية الحسابية، وسؤاله عن نقاط الدعم والمقاومة وتوزيع السيولة."
                                        : "Unlike basic signal-only platforms, EGX Bots features a full interactive AI Chatbot where you can chat naturally, upload portfolio screenshots for instant Vision AI analysis, and discuss key technical levels in real time."}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                                    <div className="flex items-center gap-2 text-xs font-black bg-white/90 border-2 border-black p-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] text-black">
                                        <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0" />
                                        <span>{isAr ? "محادثة طبيعية 24/7" : "24/7 Natural Chat"}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-black bg-white/90 border-2 border-black p-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] text-black">
                                        <Camera className="w-4 h-4 text-emerald-600 shrink-0" />
                                        <span>{isAr ? "تحليل سكرين شوت المحفظة" : "Portfolio Vision AI"}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-black bg-white/90 border-2 border-black p-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] text-black">
                                        <Zap className="w-4 h-4 text-amber-600 shrink-0" />
                                        <span>{isAr ? "تحليل النوايا والسيولة" : "Smart Intent & Capital Allocation"}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="shrink-0 w-full md:w-auto">
                                <button
                                    onClick={() => setIsOpen(true)}
                                    className="w-full md:w-auto h-14 px-8 border-4 border-black bg-yellow-400 hover:bg-yellow-300 text-black font-black uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 flex items-center justify-center gap-3 text-base sm:text-lg cursor-pointer"
                                >
                                    <MessageSquare className="w-5 h-5 text-black" />
                                    <span>{isAr ? "تحدث مع البوت الذكي الآن" : "Chat With AI Assistant"}</span>
                                    <ArrowRight className={`w-5 h-5 ${isAr ? "rotate-180" : ""}`} />
                                </button>
                            </div>
                        </div>
                    </div>

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
                            💡 {isAr ? "AI Score يساعد على ترتيب الفرص رقميًا من 1 إلى 10" : "AI Score helps rank opportunities numerically from 1 to 10."}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-6 justify-center items-stretch sm:items-center px-4 max-w-3xl mx-auto">
                        <button
                            onClick={() => setIsOpen(true)}
                            className="h-16 px-8 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-3 text-base sm:text-xl"
                        >
                            <MessageSquare className="w-6 h-6 text-black" />
                            {isAr ? "تحدث مع الشات بوت الذكي 🤖" : "Interactive AI Chatbot 🤖"}
                        </button>
                        <Link
                            href={user ? "/scanner/backtests" : "/signup"}
                            className="h-16 px-8 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white font-black uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-3 text-base sm:text-xl"
                        >
                            {user ? (isAr ? "أفضل الأسهم" : "View Top Stocks") : (isAr ? "أنشئ حساباً مجانياً" : "Create Free Account")}
                            <ArrowRight className={`w-6 h-6 transition-transform ${isAr ? "rotate-180" : ""}`} />
                        </Link>
                    </div>
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
                            {isAr ? "أفضل الأسهم المصرية" : "Top Ranked Popular Stocks"}
                        </h2>
                    </div>

                    {/* Transparent System Stats — moved under heading */}
                    <div className="max-w-5xl mx-auto mb-12 grid grid-cols-2 md:grid-cols-4 gap-6">
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

            {/* ====== HISTORICAL SIMILARITY SECTION ====== */}
            <section id="similarity" className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-950 dark:text-white">
                <div className="max-w-6xl mx-auto">

                    {/* Header */}
                    <div className="text-center mb-12">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-cyan text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[-1deg] mb-4 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                            {isAr ? "إحصائيات النظام" : "TRANSPARENT SYSTEM STATISTICS"}
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
                                    {similarityScans.length} {isAr ? "سهم" : "STOCKS"}
                                </span>
                            </div>

                             <div className="flex-1 p-3 space-y-2 max-h-[500px] overflow-y-auto" style={{scrollbarWidth:'thin'}}>
                                {similarityScans.map((stock: any, idx: number) => {
                                    const isActive = selectedSimStock.symbol === stock.symbol;
                                    return (
                                        <button
                                            key={stock.symbol}
                                             onClick={() => {
                                                 setSelectedSimStock(stock);
                                                 if (stock.scan) setSimChartData(transformSimChart(stock.scan, 10));
                                             }}
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
                                <span>Updated: {similarityUpdatedAt ? new Date(similarityUpdatedAt).toLocaleDateString("en-EG") : "N/A"}</span>
                                <span>{similarityScans.length} stocks</span>
                            </div>
                        </div>

                        {/* RIGHT — Stats + Chart */}
                        <div className="lg:col-span-8 space-y-5">

                            {/* 4 stat cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { label: isAr ? "نسبة الربح" : "WIN RATE",       value: `${(selectedSimStock.winRate * 100).toFixed(1)}%`,          sub: `${selectedSimStock.wins || 0} Wins / ${selectedSimStock.losses || 0} Losses`, color: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500" },
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
                                            {simChartData.length > 0 && (<>
                                                {(["M1","M2","M3","M4","M5"] as const).map((key, ki) => {
                                                    const colors = ["#3b82f6","#a855f7","#f97316","#06b6d4","#ec4899"];
                                                    const validPoints = simChartData.filter((d: any) => d[key] !== undefined && d[key] !== null);
                                                    if (validPoints.length < 2) return null;
                                                    const pts = validPoints.map((d: any, i: number) => {
                                                        const x = (i / (validPoints.length - 1)) * 600;
                                                        const y = 140 - (d[key] ?? 0) * 10;
                                                        return `${x.toFixed(1)},${Math.max(4, Math.min(252, y)).toFixed(1)}`;
                                                    }).join(" ");
                                                    return <polyline key={key} points={pts} fill="none" stroke={colors[ki]} strokeWidth="1.2" opacity="0.4" strokeLinejoin="round" strokeLinecap="round" />;
                                                })}
                                                {/* Average green line */}
                                                {simChartData.filter((d: any) => d.Avg != null).length >= 2 && (
                                                    <polyline
                                                        points={simChartData.filter((d: any) => d.Avg != null).map((d: any, i: number, arr: any[]) => {
                                                            const x = (i / (arr.length - 1)) * 600;
                                                            const y = 140 - (d.Avg ?? 0) * 10;
                                                            return `${x.toFixed(1)},${Math.max(4, Math.min(252, y)).toFixed(1)}`;
                                                        }).join(" ")}
                                                        fill="none" stroke="#10b981" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"
                                                    />
                                                )}
                                                {/* Target yellow dashed */}
                                                {simChartData.filter((d: any) => d.Target != null).length >= 2 && (
                                                    <polyline
                                                        points={simChartData.filter((d: any) => d.Target != null).map((d: any, i: number, arr: any[]) => {
                                                            const x = (i / (arr.length - 1)) * 600;
                                                            const y = 140 - (d.Target ?? 0) * 10;
                                                            return `${x.toFixed(1)},${Math.max(4, Math.min(252, y)).toFixed(1)}`;
                                                        }).join(" ")}
                                                        fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="8 4"
                                                    />
                                                )}
                                            </>)}
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

            {/* AI News Section */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-900">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-cyan text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[1deg] mb-4">
                            {isAr ? "ذكاء اصطناعي وأخبار" : "AI NEWS & INTELLIGENCE"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight mb-4">
                            {isAr ? "آخر أخبار وتحليلات الأسهم بالذكاء الاصطناعي" : "Latest AI Market Intelligence"}
                        </h2>
                        <p className="text-sm sm:text-base text-zinc-500 max-w-xl mx-auto font-bold">
                            {isAr 
                                ? "تابع أهم الأخبار المالية وتحليلات معالجة اللغة الطبيعية والذكاء الاصطناعي لأسهم البورصة المصرية."
                                : "Stay updated with NLP-driven sentiment analytics, corporate news, and AI-generated trading intelligence."}
                        </p>
                    </div>

                    {newsLoading ? (
                        <div className="flex flex-col items-center justify-center p-20 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 gap-4 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">{isAr ? "جاري تحميل الأخبار..." : "Loading Latest Intelligence..."}</p>
                        </div>
                    ) : recentNews.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {recentNews.map((item: any, i: number) => {
                                const headlines = item.headlines || [];
                                const mainHeadline = headlines[0] || (isAr ? `تحديث فني لسهم ${item.symbol}` : `Technical update for ${item.symbol}`);
                                const sources = item.sources || [];
                                const mainSource = sources[0] || "EGX Bots AI";
                                const isPositive = item.sentiment_score > 0.05;
                                const isNegative = item.sentiment_score < -0.05;
                                
                                return (
                                    <div 
                                        key={item.id || i}
                                        className="border-4 border-black dark:border-white p-6 bg-white dark:bg-zinc-950 flex flex-col justify-between shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_rgba(255,255,255,1)] transition-all duration-200"
                                    >
                                        <div>
                                            <div className="flex items-center justify-between gap-3 mb-4">
                                                <span className="border-2 border-black dark:border-white px-2 py-0.5 neobrutal-bg-yellow text-[10px] font-black uppercase tracking-wider">
                                                    {item.symbol}
                                                </span>
                                                <span className={`border-2 border-black dark:border-white px-2 py-0.5 text-[10px] font-black uppercase ${
                                                    isPositive ? 'neobrutal-bg-green' : isNegative ? 'neobrutal-bg-pink' : 'bg-zinc-200'
                                                }`}>
                                                    {isPositive ? (isAr ? "إيجابي" : "Positive") : isNegative ? (isAr ? "سلبي" : "Negative") : (isAr ? "neutral" : "Neutral")}
                                                </span>
                                            </div>

                                            <h3 className="text-base sm:text-lg font-black text-black dark:text-white mb-3 line-clamp-2 leading-snug">
                                                {mainHeadline}
                                            </h3>
                                        </div>

                                        <div className="mt-6 pt-4 border-t-2 border-black dark:border-white flex items-center justify-between text-[11px] font-bold text-zinc-500">
                                            <span>
                                                📅 {new Date(item.date).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric" })}
                                            </span>
                                            <span>
                                                📰 {mainSource}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center p-12 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 font-bold text-zinc-500">
                            {isAr ? "لا توجد أخبار متاحة حالياً." : "No intelligence reports available."}
                        </div>
                    )}

                    <div className="text-center mt-12">
                        <Link
                            href="/news"
                            className="h-12 px-6 border-4 border-black dark:border-white bg-black dark:bg-white text-white dark:text-black font-black text-sm uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 cursor-pointer inline-flex items-center justify-center gap-2"
                        >
                            {isAr ? "عرض جميع الأخبار" : "View All News"}
                            <ArrowRight className={`w-4 h-4 ${isAr ? 'rotate-180' : ''}`} />
                        </Link>
                    </div>
                </div>
            </section>

            {/* Market Analysis Section */}
            <section className="px-4 sm:px-6 lg:px-8 py-20 border-t-4 border-black dark:border-white bg-white dark:bg-zinc-900">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-12">
                        <div className="inline-block border-4 border-black dark:border-white px-3 py-1.5 neobrutal-bg-yellow text-black dark:text-black font-black text-xs uppercase tracking-widest rotate-[1deg] mb-4">
                            {isAr ? "اتجاه السوق والعملة" : "MARKET TREND & CURRENCY"}
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black text-black dark:text-white tracking-tight">
                            {isAr ? "متابعة لحظية للسوق المصرية" : "Live Egyptian Market Pulse"}
                        </h2>
                        <p className="text-sm sm:text-base text-zinc-500 max-w-xl mx-auto font-bold mt-4">
                            {isAr
                                ? "تتبع مباشر لمؤشرات البورصة المصرية (EGX 30 / EGX 100) وسعر الدولار لحظة بلحظة."
                                : "Live EGX index tracking, USD/EGP rate, and real-time market regime analysis."}
                        </p>
                    </div>

                    {marketLoading ? (
                        <div className="flex flex-col items-center justify-center p-12 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 gap-4 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">{isAr ? "جاري تحميل بيانات السوق..." : "Loading Market Intelligence..."}</p>
                        </div>
                    ) : marketData ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                                {(() => {
                                    const egx30 = getMarketStats(marketData.egx30);
                                    const egx100 = getMarketStats(marketData.egx100);
                                    const usdegp = getMarketStats(marketData.usdegp);
                                    const cards = [
                                        { labelKey: "EGX 30", labelAr: "EGX 30", value: egx30.last, changePct: egx30.changePct, unit: isAr ? "نقطة" : "pts", icon: Landmark, up: egx30.changePct >= 0 },
                                        { labelKey: "EGX 100", labelAr: "EGX 100", value: egx100.last, changePct: egx100.changePct, unit: isAr ? "نقطة" : "pts", icon: Layers, up: egx100.changePct >= 0 },
                                        { labelKey: "USD/EGP", labelAr: "USD/EGP", value: usdegp.last, changePct: usdegp.changePct, unit: isAr ? "جنيه" : "EGP", icon: DollarSign, up: usdegp.changePct >= 0 },
                                    ];
                                    return cards.map((card, idx) => (
                                        <div key={idx} className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col justify-between hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all duration-200">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{card.labelAr}</span>
                                                <card.icon className="w-5 h-5 text-indigo-500" />
                                            </div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                                                    {typeof card.value === "number" ? card.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                                                </span>
                                                <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{card.unit}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-4">
                                                <span className={`text-sm font-black flex items-center ${card.up ? "text-emerald-500" : "text-rose-500"}`}>
                                                    {card.up ? "+" : ""}{typeof card.changePct === "number" ? card.changePct.toFixed(2) : "0.00"}%
                                                </span>
                                                {card.up
                                                    ? <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                                                    : <ArrowDownRight className="w-4 h-4 text-rose-500" />
                                                }
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col justify-between">
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{isAr ? "وضع السوق" : "Market Regime"}</span>
                                        <Activity className="w-5 h-5 text-indigo-500" />
                                    </div>
                                    <div>
                                        <span className="text-2xl font-black text-zinc-950 dark:text-white font-mono uppercase">
                                            {marketData.reject_buys
                                                ? isAr
                                                    ? "🛑 إيقاف الشراء"
                                                    : "🛑 Buy Paused"
                                                : marketData.regime === "trending_up"
                                                    ? isAr
                                                        ? "📈 صاعد"
                                                        : "📈 Trending Up"
                                                    : marketData.regime === "trending_down"
                                                        ? isAr
                                                            ? "📉 هابط"
                                                            : "📉 Trending Down"
                                                        : isAr
                                                            ? "↔️ عرضي"
                                                            : "↔️ Sideways"}
                                        </span>
                                        <p className="text-xs text-zinc-600 dark:text-zinc-500 font-bold mt-2">
                                            {isAr
                                                ? "بناءً على تحليل مؤشر EGX 30 وأداء السوق اليومي."
                                                : "Based on EGX 30 index momentum and daily market performance."}
                                        </p>
                                    </div>
                                </div>
                                <div className="border-4 border-black dark:border-white bg-[#FFE600] dark:bg-[#FFE600] text-black dark:text-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-center">
                                    <p className="text-sm font-black uppercase tracking-wider mb-2">{isAr ? "مؤشر البورصة المصرية" : "EGX Market Overview"}</p>
                                    <p className="text-xs font-bold opacity-80 leading-relaxed mb-4">
                                        {isAr
                                            ? "احصل على تحليل كامل للأسهم المصرية، خرائط حرارية للقطاعات، وتوصيات يومية مدعومة بالذكاء الاصطناعي."
                                            : "Get full EGX market analysis, sector heatmaps, and AI-backed daily recommendations."}
                                    </p>
                                    <Link
                                        href="/scanner/market"
                                        className="inline-flex items-center gap-2 px-6 py-3 bg-black dark:bg-white text-white dark:text-black font-black text-[11px] uppercase tracking-widest border-2 border-black dark:border-white shadow-[3px_3px_0px_rgba(0,0,0,0.4)] hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                                    >
                                        {isAr ? "عرض التحليل" : "Open Analysis"}
                                        <ArrowRight className={`w-4 h-4 ${isAr ? 'rotate-180' : ''}`} />
                                    </Link>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-center p-12 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 font-bold text-zinc-500">
                            {isAr ? "لا توجد بيانات سوق متاحة حالياً." : "No market intelligence available right now."}
                        </div>
                    )}
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
                                ? "نظامان متكاملان ومصممان خصيصاً للبورصة المصرية لتسهيل قرارات الاستثمار."
                                : "Two robust systems engineered specifically for the EGX market to enhance your trading strategies."}
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
