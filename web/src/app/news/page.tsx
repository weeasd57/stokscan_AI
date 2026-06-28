"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
    Brain,
    Search,
    ChevronLeft,
    ChevronRight,
    Calendar,
    TrendingUp,
    TrendingDown,
    Filter,
    Loader2,
    Newspaper,
    AlertCircle,
    ArrowUpDown,
    ExternalLink
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface NewsItem {
    id: number;
    symbol: string;
    exchange: string;
    date: string;
    sentiment_score: number;
    news_count: number;
    negative_flag: number;
    positive_flag: number;
    headlines: string[];
    sources: string[];
}

export default function NewsPage() {
    const { language } = useLanguage();
    const isAr = language === "ar";

    // State
    const [news, setNews] = useState<NewsItem[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [sentiment, setSentiment] = useState<string>("all"); // "all", "positive", "negative", "neutral"
    const [sortBy, setSortBy] = useState<string>("newest"); // "newest", "oldest", "highest_sent", "lowest_sent"
    const [dateFilter, setDateFilter] = useState("");
    const [page, setPage] = useState(1);
    const limit = 10;

    // Fetch news data
    const fetchNews = useCallback(async () => {
        setLoading(true);
        try {
            const offset = (page - 1) * limit;
            let url = `/api/scan/news?limit=${limit}&offset=${offset}`;
            
            if (debouncedSearch.trim()) {
                url += `&search=${encodeURIComponent(debouncedSearch)}`;
            }
            if (sentiment !== "all") {
                url += `&sentiment=${sentiment}`;
            }
            if (dateFilter) {
                url += `&date=${dateFilter}`;
            }
            
            const res = await fetch(url);
            const result = await res.json();
            
            let sortedData = result.data || [];
            
            // Client side sorting for sentiment scores and dates if needed
            if (sortBy === "oldest") {
                sortedData = [...sortedData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            } else if (sortBy === "highest_sent") {
                sortedData = [...sortedData].sort((a, b) => b.sentiment_score - a.sentiment_score);
            } else if (sortBy === "lowest_sent") {
                sortedData = [...sortedData].sort((a, b) => a.sentiment_score - b.sentiment_score);
            }
            
            setNews(sortedData);
            setTotalCount(result.count || 0);
        } catch (err) {
            console.error("Error fetching news:", err);
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearch, sentiment, dateFilter, sortBy]);

    // Handle search input debounce/delay
    useEffect(() => {
        const delayDebounce = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 300);
        return () => clearTimeout(delayDebounce);
    }, [search]);

    // Reset pagination when date filter changes
    useEffect(() => {
        setPage(1);
    }, [dateFilter]);

    // Trigger fetch when fetchNews callback changes
    useEffect(() => {
        fetchNews();
    }, [fetchNews]);

    const handleSentimentFilter = (val: string) => {
        setSentiment(val);
        setPage(1);
    };

    const handleSortChange = (val: string) => {
        setSortBy(val);
        setPage(1);
    };

    // Helper to get AI Opinion Text
    const getAiOpinion = (item: NewsItem) => {
        if (item.news_count === 0) {
            return isAr
                ? "لا توجد تقارير إخبارية مسجلة لهذا السهم اليوم. الوضع العام مستقر."
                : "No news reports recorded for this stock today. Overall status is stable.";
        }
        
        const score = item.sentiment_score;
        if (score > 0.4) {
            return isAr
                ? "رأي الذكاء الاصطناعي: إيجابي جداً 🚀. تعكس الأخبار نمواً تشغيلياً قوياً وتوسعات أو أرباحاً ممتازة للشركة، مما يعزز الثقة الشرائية للسهم."
                : "AI Opinion: Strongly Positive 🚀. The news reflects robust operational growth, expansions, or excellent earnings, boosting buy confidence.";
        } else if (score > 0.1) {
            return isAr
                ? "رأي الذكاء الاصطناعي: تفاؤلي معتدل 📈. تدفق إيجابي للأخبار والتقارير الفنية قد يدعم ارتداد السعر لأعلى على المدى القصير."
                : "AI Opinion: Mildly Positive 📈. Positive news flow and technical reports that may support a short-term price rebound.";
        } else if (score < -0.4) {
            return isAr
                ? "رأي الذكاء الاصطناعي: سلبي جداً ⚠️. تواجه الشركة ضغوطاً تشغيلية أو ديوناً أو أخباراً سلبية قد تؤدي لتراجع فوري في السعر. ينصح بالحذر."
                : "AI Opinion: Strongly Negative ⚠️. The company faces operational pressure, debt, or negative news that could trigger a price drop. Caution advised.";
        } else if (score < -0.1) {
            return isAr
                ? "رأي الذكاء الاصطناعي: تشاؤمي معتدل 📉. تراجع خفيف في المشاعر العامة للأخبار ينصح بمراقبته فنيّاً قبل اتخاذ أي قرار."
                : "AI Opinion: Mildly Negative 📉. A slight dip in overall news sentiment; recommended to monitor technically before deciding.";
        } else {
            return isAr
                ? "رأي الذكاء الاصطناعي: محايد ⚖️. الأخبار عادية أو عامة ولا تحمل تأثيراً مباشراً أو جوهرياً على الاتجاه القريب للسعر."
                : "AI Opinion: Neutral ⚖️. The news is standard or general, with no direct or material impact on short-term price direction.";
        }
    };

    // Helper to get Sentiment Badge Colors
    const getSentimentBadge = (score: number, count: number) => {
        if (count === 0) {
            return (
                <span className="px-3 py-1 text-xs font-black bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-2 border-black dark:border-white">
                    {isAr ? "بدون أخبار" : "No News"}
                </span>
            );
        }
        if (score > 0.15) {
            return (
                <span className="flex items-center gap-1 px-3 py-1 text-xs font-black bg-[#00FF66] text-black border-2 border-black">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {isAr ? "إيجابي" : "Positive"} ({score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)})
                </span>
            );
        } else if (score < -0.15) {
            return (
                <span className="flex items-center gap-1 px-3 py-1 text-xs font-black bg-[#FF3366] text-white border-2 border-black dark:border-white">
                    <TrendingDown className="w-3.5 h-3.5" />
                    {isAr ? "سلبي" : "Negative"} ({score.toFixed(2)})
                </span>
            );
        } else {
            return (
                <span className="px-3 py-1 text-xs font-black bg-yellow-300 text-black border-2 border-black">
                    {isAr ? "محايد" : "Neutral"} ({score.toFixed(2)})
                </span>
            );
        }
    };

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return (
        <div className="w-full" dir={isAr ? "rtl" : "ltr"}>
            {/* Header section */}
            <div className="mb-8 p-6 rounded-none border-4 border-black dark:border-white bg-[#FFE600] text-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-3 mb-2">
                    <Brain className="w-8 h-8" />
                    <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight">
                        {isAr ? "نبض الأخبار ومشاعر الـ AI" : "AI News & Sentiment Pulse"}
                    </h1>
                </div>
                <p className="text-sm font-bold opacity-90 max-w-3xl">
                    {isAr 
                        ? "تغطية ذكية ولحظية لأخبار البورصة المصرية ومسحها بالذكاء الاصطناعي لتحديد توجهات المتداولين وحظر التوصيات الخطرة." 
                        : "Real-time AI analysis of EGX stock news to detect market sentiment, prioritize opportunities, and gate risky recommendations."}
                </p>
            </div>

            {/* Controls Row (Search, Date Filter, Filters, Sort) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-8">
                {/* Search */}
                <div className="lg:col-span-3 relative flex items-center">
                    <Search className="absolute left-3.5 w-4 h-4 text-black/70 dark:text-white/70" />
                    <input
                        type="text"
                        placeholder={isAr ? "ابحث برمز السهم (مثال: COMI)..." : "Search by stock symbol (e.g. COMI)..."}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-11 w-full rounded-none pl-10 pr-4 text-xs font-black outline-none border-4 border-black bg-white dark:bg-zinc-900 text-black dark:text-white dark:border-white focus:bg-[#FFE600] focus:text-black transition-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)]"
                    />
                </div>

                {/* Date Filter */}
                <div className="lg:col-span-3 relative flex items-center">
                    <Calendar className="absolute left-3.5 w-4 h-4 text-black/70 dark:text-white/70 pointer-events-none" />
                    <input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="h-11 w-full rounded-none pl-10 pr-4 text-xs font-black outline-none border-4 border-black bg-white dark:bg-zinc-900 text-black dark:text-white dark:border-white focus:bg-[#FFE600] focus:text-black transition-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)]"
                    />
                </div>

                {/* Sentiment Filters */}
                <div className="lg:col-span-4 flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-black uppercase tracking-wider flex items-center gap-1 text-black dark:text-white">
                        <Filter className="w-3.5 h-3.5" />
                        {isAr ? "المشاعر:" : "Sentiment:"}
                    </span>
                    <div className="flex gap-1.5">
                        {[
                            { val: "all", labelEn: "All", labelAr: "الكل" },
                            { val: "positive", labelEn: "Positive", labelAr: "إيجابي" },
                            { val: "negative", labelEn: "Negative", labelAr: "سلبي" },
                            { val: "neutral", labelEn: "Neutral", labelAr: "محايد" }
                        ].map((btn) => (
                            <button
                                key={btn.val}
                                onClick={() => handleSentimentFilter(btn.val)}
                                className={`px-2.5 py-1.5 text-xs font-black rounded-none border-3 border-black dark:border-white transition-none ${
                                    sentiment === btn.val
                                        ? "bg-black text-white dark:bg-white dark:text-black"
                                        : "bg-white text-black dark:bg-zinc-900 dark:text-white hover:bg-[#FFE600] hover:text-black"
                                }`}
                            >
                                {isAr ? btn.labelAr : btn.labelEn}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Sort */}
                <div className="lg:col-span-2 flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider whitespace-nowrap text-black dark:text-white">
                        <ArrowUpDown className="w-3.5 h-3.5" />
                    </span>
                    <select
                        value={sortBy}
                        onChange={(e) => handleSortChange(e.target.value)}
                        className="h-11 w-full rounded-none px-2 text-xs font-black border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white outline-none cursor-pointer focus:bg-[#FFE600] focus:text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)]"
                    >
                        <option value="newest">{isAr ? "الأحدث" : "Newest"}</option>
                        <option value="oldest">{isAr ? "الأقدم" : "Oldest"}</option>
                        <option value="highest_sent">{isAr ? "الأعلى" : "Highest"}</option>
                        <option value="lowest_sent">{isAr ? "الأدنى" : "Lowest"}</option>
                    </select>
                </div>
            </div>

            {/* Loading Indicator */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 border-4 border-dashed border-black/20 dark:border-white/20 bg-zinc-50 dark:bg-zinc-900/20">
                    <Loader2 className="w-10 h-10 animate-spin text-yellow-500" />
                    <span className="text-sm font-black uppercase tracking-widest text-zinc-500">
                        {isAr ? "جاري سحب وتصنيف الأخبار..." : "AI News analysis in progress..."}
                    </span>
                </div>
            ) : news.length > 0 ? (
                <div className="flex flex-col gap-6">
                    {news.map((item) => (
                        <div
                            key={item.id}
                            className="p-5 md:p-6 rounded-none border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.5)] transition-all hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.6)]"
                        >
                            {/* Card Top Row */}
                            <div className="flex flex-wrap justify-between items-center gap-3 mb-4 pb-3 border-b-2 border-black/10 dark:border-white/10">
                                <div className="flex items-center gap-2">
                                    <Link
                                        href={`/stocks/${item.symbol.toLowerCase()}`}
                                        className="px-2.5 py-1 text-xs font-black uppercase tracking-wider bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white hover:bg-[#FFE600] hover:text-black hover:border-black transition-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                    >
                                        {item.symbol}.EGX
                                    </Link>
                                    <span className="flex items-center gap-1 text-[10px] font-black text-zinc-500 dark:text-zinc-400">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {item.date}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {getSentimentBadge(item.sentiment_score, item.news_count)}
                                </div>
                            </div>

                            {/* Headlines list */}
                            <div className="mb-4">
                                <h3 className="text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 mb-2.5 tracking-wider flex items-center gap-1">
                                    <Newspaper className="w-4 h-4" />
                                    {isAr ? "عناوين الصحف المكتشفة:" : "Detected Headlines:"}
                                </h3>
                                {item.news_count > 0 ? (
                                    <ul className="space-y-2 list-none p-0 m-0">
                                        {item.headlines.map((hl, i) => (
                                            <li
                                                key={i}
                                                className="text-sm font-black p-3 bg-zinc-50 dark:bg-zinc-950 border-2 border-black dark:border-zinc-800 text-black dark:text-white flex items-center justify-between gap-4"
                                            >
                                                <span>{hl}</span>
                                                {item.sources && item.sources[i] && (
                                                    <span className="text-[9px] font-black uppercase bg-yellow-300 text-black px-2 py-0.5 border border-black shrink-0">
                                                        {item.sources[i]}
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="p-3 text-xs font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950 border border-black/10">
                                        {isAr ? "لا توجد أخبار مباشرة" : "No direct news items found"}
                                    </div>
                                )}
                            </div>

                            {/* AI Opinion section */}
                            <div className="p-4 bg-yellow-50 dark:bg-yellow-950/20 border-3 border-dashed border-yellow-500/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-start gap-2.5">
                                    <Brain className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black uppercase text-yellow-600 dark:text-yellow-400 tracking-wider">
                                            {isAr ? "تحليل الذكاء الاصطناعي الفوري" : "AI Realtime Assessment"}
                                        </span>
                                        <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300 mt-1 leading-relaxed">
                                            {getAiOpinion(item)}
                                        </p>
                                    </div>
                                </div>
                                <div className="shrink-0 flex items-center">
                                    <Link
                                        href={`/stocks/${item.symbol.toLowerCase()}`}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black bg-white dark:bg-zinc-800 border-2 border-black dark:border-white hover:bg-[#FFE600] hover:text-black transition-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                    >
                                        {isAr ? "تقرير السهم الفني" : "Technical Report"}
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Pagination */}
                    <div className="flex justify-between items-center mt-6 p-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)]">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(page - 1)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-black bg-white dark:bg-zinc-800 text-black dark:text-white border-2 border-black dark:border-white disabled:opacity-40 disabled:pointer-events-none hover:bg-[#FFE600] hover:text-black transition-none"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            {isAr ? "السابق" : "Previous"}
                        </button>
                        <span className="text-xs font-black text-black dark:text-white uppercase tracking-widest">
                            {isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
                        </span>
                        <button
                            disabled={page === totalPages}
                            onClick={() => setPage(page + 1)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-black bg-white dark:bg-zinc-800 text-black dark:text-white border-2 border-black dark:border-white disabled:opacity-40 disabled:pointer-events-none hover:bg-[#FFE600] hover:text-black transition-none"
                        >
                            {isAr ? "التالي" : "Next"}
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            ) : (
                /* No results state */
                <div className="flex flex-col items-center justify-center py-20 gap-3 border-4 border-dashed border-black/20 dark:border-white/20 bg-zinc-50 dark:bg-zinc-900/20 text-zinc-500">
                    <AlertCircle className="w-10 h-10 text-zinc-400" />
                    <span className="text-sm font-black uppercase tracking-widest">
                        {isAr ? "لا توجد سجلات أخبار مطابقة للفلاتر الحالية" : "No news matching current filters"}
                    </span>
                    <button
                        onClick={() => {
                            setSearch("");
                            setSentiment("all");
                            setSortBy("newest");
                            setDateFilter("");
                            setPage(1);
                        }}
                        className="mt-2 px-4 py-2 text-xs font-black bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white hover:bg-[#FFE600] hover:text-black transition-none"
                    >
                        {isAr ? "إعادة ضبط الفلاتر" : "Reset Filters"}
                    </button>
                </div>
            )}
        </div>
    );
}
