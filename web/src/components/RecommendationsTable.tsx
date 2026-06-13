"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAIScanner } from "@/contexts/AIScannerContext";
import StockLogo from "./StockLogo";
import { Search, Filter, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Layers, Info, CheckCircle2 } from "lucide-react";

interface RecommendationsTableProps {
    isLandingPage?: boolean;
    limit?: number;
}

export default function RecommendationsTable({ isLandingPage = false, limit = Infinity }: RecommendationsTableProps) {
    const { user } = useAuth();
    const { language } = useLanguage();
    const router = useRouter();
    const isAr = language === "ar";
    
    // Use AIScannerContext for caching data
    const { recommendations, recsLoading, recsError, loadRecommendations } = useAIScanner();

    // Outdated warning retry state
    const [isOutdated, setIsOutdated] = useState(false);

    // Interactive Filters (Scanner or Authenticated Landing Page)
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSector, setSelectedSector] = useState("");
    const [selectedSignal, setSelectedSignal] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    // Translations
    const tDict = {
        title: { en: "Top Stocks Ranked by ML AI", ar: "أفضل الأسهم مرتبة بالذكاء الاصطناعي" },
        subtitle: { en: "Universe: EGX & US stocks evaluated by quantitative AI models. Stocks are ranked according to their AI Score, which rates the probability of beating the market in the next 30 days.", ar: "النطاق: أسهم البورصة المصرية والأمريكية مقيمة بنماذج كمية للذكاء الاصطناعي. يتم ترتيب الأسهم بناءً على تقييم الذكاء الاصطناعي الذي يحدد احتمالية التفوق على السوق خلال الـ 30 يوماً القادمة." },
        rank: { en: "Rank", ar: "الترتيب" },
        stockName: { en: "Company / Symbol", ar: "الشركة / الرمز" },
        country: { en: "Country", ar: "البلد" },
        aiScore: { en: "AI Score", ar: "تقييم الذكاء" },
        sector: { en: "Sector", ar: "القطاع" },
        signal: { en: "Signal", ar: "الإشارة" },
        techScore: { en: "Technical", ar: "الفني" },
        fundScore: { en: "Fundamental", ar: "الأساسي" },
        sentScore: { en: "Sentiment", ar: "المشاعر" },
        lowRisk: { en: "Low Risk", ar: "نسبة الأمان" },
        volume: { en: "Volume", ar: "الحجم" },
        noResults: { en: "No recommendations found matching criteria", ar: "لم يتم العثور على توصيات تطابق الاختيارات" },
        outdated: { en: "Data may be outdated. Retrying in 1 minute...", ar: "قد تكون البيانات قديمة. جاري إعادة المحاولة خلال دقيقة..." },
        retryBtn: { en: "Retry Now", ar: "أعد المحاولة الآن" },
        allSectors: { en: "All Sectors", ar: "جميع القطاعات" },
        allSignals: { en: "All Signals", ar: "جميع الإشارات" },
        buy: { en: "BUY", ar: "شراء" },
        sell: { en: "SELL", ar: "بيع" },
        searchPlaceholder: { en: "Search by stock symbol or name...", ar: "ابحث برمز السهم أو الاسم..." },
        prev: { en: "Previous", ar: "السابق" },
        next: { en: "Next", ar: "التالي" },
        pageInfo: { en: "Page {page} of {pages}", ar: "صفحة {page} من {pages}" },
        totalRows: { en: "Total Stocks: {count}", ar: "إجمالي الأسهم: {count}" },
    };

    const translate = (key: keyof typeof tDict) => {
        return tDict[key]?.[isAr ? "ar" : "en"] || key;
    };

    // Load recommendations from context
    useEffect(() => {
        loadRecommendations(isLandingPage);
    }, [loadRecommendations, isLandingPage]);

    // Outdated warning retry logic
    useEffect(() => {
        if (recsError) {
            setIsOutdated(true);
            const retryTimeout = setTimeout(() => {
                loadRecommendations(isLandingPage);
            }, 60 * 1000);

            return () => clearTimeout(retryTimeout);
        }
    }, [recsError, loadRecommendations, isLandingPage]);

    // Handle Landing Page Clicks Redirection for unauthenticated users
    const handleLandingClick = (e: React.MouseEvent) => {
        if (isLandingPage && !user) {
            e.preventDefault();
            e.stopPropagation();
            router.push("/scanner/backtests");
        }
    };

    const handleStockClick = (symbol: string, exchange: string) => {
        if (isLandingPage && !user) {
            router.push("/scanner/backtests");
        } else {
            router.push(`/chart?symbol=${encodeURIComponent(symbol.toUpperCase())}&exchange=${encodeURIComponent(exchange || "EGX")}`);
        }
    };

    // Client-side filtering and sorting
    const processedRows = useMemo(() => {
        let items = [...recommendations];

        // 1. Search by stock name or symbol
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            items = items.filter(r => 
                r.name.toLowerCase().includes(q) || 
                r.symbol.toLowerCase().includes(q)
            );
        }

        // 2. Filter by sector
        if (selectedSector) {
            items = items.filter(r => r.sector === selectedSector);
        }

        // 3. Filter by signal
        if (selectedSignal) {
            items = items.filter(r => r.signal.toUpperCase() === selectedSignal.toUpperCase());
        }

        // 4. Default sort by AI Score (precision) descending
        items.sort((a, b) => b.precision - a.precision);

        return items;
    }, [recommendations, searchTerm, selectedSector, selectedSignal]);

    // Apply Limit (used for landing page preview)
    const limitedRows = useMemo(() => {
        return processedRows.slice(0, limit);
    }, [processedRows, limit]);

    // Unique sectors for filter dropdown
    const sectors = useMemo(() => {
        const list = Array.from(new Set(recommendations.map(m => m.sector || "General")));
        return list.filter(s => s && s !== "General").sort();
    }, [recommendations]);

    // Pagination (Only applied when no limit is set)
    const displayRows = useMemo(() => {
        if (limit !== Infinity) return limitedRows;
        const start = (currentPage - 1) * itemsPerPage;
        return processedRows.slice(start, start + itemsPerPage);
    }, [processedRows, limitedRows, limit, currentPage]);

    const totalPages = Math.max(1, Math.ceil(processedRows.length / itemsPerPage));

    // Circular Score Badge Renderer (danelfin style)
    const renderCircularScore = (val: number, label: string) => {
        const rounded = Math.round(val);
        let colorClass = "border-red-500 text-red-500 bg-red-500/5";
        if (rounded >= 8) {
            colorClass = "border-emerald-500 text-emerald-500 bg-emerald-500/5";
        } else if (rounded >= 5) {
            colorClass = "border-amber-500 text-amber-500 bg-amber-500/5";
        }

        return (
            <div className="flex flex-col items-center justify-center gap-1">
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-black font-mono text-sm ${colorClass}`}>
                    {rounded}
                </div>
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block lg:hidden">{label}</span>
            </div>
        );
    };

    // Country flag helper
    const getCountryFlag = (country: string | undefined | null, ex: string | undefined | null) => {
        const normCountry = (country || "").toLowerCase();
        const normEx = (ex || "").toLowerCase();
        if (normCountry === "egypt" || normEx === "egx" || normEx === "eg" || normEx === "ca") {
            return { flag: "🇪🇬", name: isAr ? "مصر" : "Egypt" };
        }
        return { flag: "🇺🇸", name: isAr ? "أمريكا" : "USA" };
    };

    // Volume formatter
    const formatVolume = (row: any) => {
        let rawVol = 0;
        if (row.features && Array.isArray(row.features) && row.features.length > 1) {
            rawVol = Number(row.features[1]);
        }
        if (!rawVol || isNaN(rawVol)) return "-";
        
        if (rawVol >= 1e9) return (rawVol / 1e9).toFixed(2) + "B";
        if (rawVol >= 1e6) return (rawVol / 1e6).toFixed(2) + "M";
        if (rawVol >= 1e3) return (rawVol / 1e3).toFixed(1) + "K";
        return rawVol.toLocaleString();
    };

    // Low risk score generator (based on SL distance)
    const getLowRiskScore = (row: any) => {
        if (!row.stop_loss || !row.last_close) return 5;
        const distPct = Math.abs((row.last_close - row.stop_loss) / row.last_close);
        const score = Math.round(10 - distPct * 20); // smaller distance = lower risk (higher score)
        return Math.max(1, Math.min(10, score));
    };

    return (
        <div 
            onClick={handleLandingClick}
            className={`w-full max-w-6xl mx-auto flex flex-col space-y-6 select-none ${isLandingPage && !user ? "cursor-pointer" : ""}`}
        >
            {/* Header Content Info Box */}
            <div className="flex flex-col gap-3 p-8 border-4 border-black dark:border-white bg-zinc-950 text-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 border border-white/20 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                            <Layers className="w-6 h-6 text-white" />
                        </div>
                        <h2 className="text-2xl font-black uppercase tracking-tight">{translate("title")}</h2>
                    </div>
                    {limit === Infinity && (
                        <button 
                            onClick={() => loadRecommendations(isLandingPage)}
                            disabled={recsLoading}
                            className="h-10 px-4 border-2 border-black bg-white hover:bg-zinc-100 text-black font-bold uppercase text-xs flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${recsLoading ? "animate-spin" : ""}`} />
                            {isAr ? "تحديث" : "Refresh"}
                        </button>
                    )}
                </div>
                <p className="text-xs font-bold leading-relaxed text-zinc-400 max-w-3xl">{translate("subtitle")}</p>
            </div>

            {/* Outdated Warning Panel */}
            {isOutdated && (
                <div className="p-4 border-4 border-black neobrutal-bg-pink text-black font-bold flex items-center justify-between text-xs shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{translate("outdated")}</span>
                    </div>
                    {limit === Infinity && (
                        <button 
                            onClick={() => loadRecommendations(isLandingPage)}
                            className="underline font-black uppercase tracking-wider"
                        >
                            {translate("retryBtn")}
                        </button>
                    )}
                </div>
            )}

            {/* Interactive Filters (Scanner or Authenticated Landing Page) */}
            {limit === Infinity && (!isLandingPage || user) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                    {/* Search Input */}
                    <div className="relative flex items-center">
                        <Search className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <input
                            type="text"
                            placeholder={translate("searchPlaceholder")}
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-4 border-2 border-black bg-zinc-50 text-black font-bold text-sm focus:outline-none focus:ring-0"
                        />
                    </div>

                    {/* Sector dropdown */}
                    <div className="relative flex items-center">
                        <Filter className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <select
                            value={selectedSector}
                            onChange={(e) => { setSelectedSector(e.target.value); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-8 border-2 border-black bg-zinc-50 text-black font-bold text-sm appearance-none focus:outline-none focus:ring-0"
                        >
                            <option value="">{translate("allSectors")}</option>
                            {sectors.map(sec => (
                                <option key={sec} value={sec}>{sec}</option>
                            ))}
                        </select>
                    </div>

                    {/* Signal dropdown */}
                    <div className="relative flex items-center">
                        <Filter className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <select
                            value={selectedSignal}
                            onChange={(e) => { setSelectedSignal(e.target.value); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-8 border-2 border-black bg-zinc-50 text-black font-bold text-sm appearance-none focus:outline-none focus:ring-0"
                        >
                            <option value="">{translate("allSignals")}</option>
                            <option value="BUY">{translate("buy")}</option>
                            <option value="SELL">{translate("sell")}</option>
                        </select>
                    </div>
                </div>
            )}

            {/* Table wrapper */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] overflow-hidden">
                {recsLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-zinc-500">
                        <div className="w-8 h-8 animate-spin rounded-full border-4 border-black border-t-transparent dark:border-white" />
                        <p className="text-xs font-black uppercase tracking-widest">{isAr ? "جاري تحميل التوصيات..." : "Loading recommendations..."}</p>
                    </div>
                ) : displayRows.length === 0 ? (
                    <div className="p-12 text-center text-zinc-500 font-bold uppercase tracking-wider text-xs">
                        {translate("noResults")}
                    </div>
                ) : (
                    <div className="overflow-x-auto w-full">
                        <table className="w-full text-left border-collapse whitespace-nowrap lg:whitespace-normal">
                            <thead>
                                <tr className="border-b-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-xs font-black uppercase tracking-wider text-black dark:text-white select-none">
                                    <th className="px-4 py-4 w-12 text-center">{translate("rank")}</th>
                                    <th className="px-6 py-4">{translate("stockName")}</th>
                                    <th className="px-6 py-4 w-24 text-center">{translate("country")}</th>
                                    <th className="px-4 py-4 w-24 text-center">{translate("aiScore")}</th>
                                    <th className="px-4 py-4 w-24 text-center">{translate("signal")}</th>
                                    
                                    {/* Registered User Circular Badges */}
                                    {user && (
                                        <>
                                            <th className="px-4 py-4 w-24 text-center">{translate("techScore")}</th>
                                            <th className="px-4 py-4 w-24 text-center">{translate("fundScore")}</th>
                                            <th className="px-4 py-4 w-24 text-center">{translate("sentScore")}</th>
                                        </>
                                    )}

                                    <th className="px-4 py-4 w-24 text-center">{translate("lowRisk")}</th>
                                    <th className="px-6 py-4 w-24 text-center">{translate("volume")}</th>
                                    <th className="px-6 py-4">{translate("sector")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y-2 divide-black dark:divide-white">
                                {displayRows.map((row, index) => {
                                    const cInfo = getCountryFlag(row.country, row.exchange);
                                    const rankNum = limit !== Infinity ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1;
                                    const aiScoreNum = Number((row.precision * 10).toFixed(0));

                                    return (
                                        <tr 
                                            key={row.id} 
                                            className="hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors duration-100 text-sm"
                                        >
                                            {/* Rank */}
                                            <td className="px-4 py-4 text-center font-black font-mono text-zinc-500">
                                                {rankNum}
                                            </td>

                                            {/* Company / Symbol */}
                                            <td className="px-6 py-4 font-black">
                                                <div className="flex items-center gap-3">
                                                    <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="md" />
                                                    <div 
                                                        onClick={(e) => {
                                                            if (!isLandingPage || user) {
                                                                e.stopPropagation();
                                                                handleStockClick(row.symbol, row.exchange);
                                                            }
                                                        }}
                                                        className="flex flex-col cursor-pointer"
                                                    >
                                                        <span className="text-base text-indigo-600 dark:text-indigo-400 hover:underline">{row.symbol}</span>
                                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[220px]" title={row.name}>
                                                            {row.name}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Country */}
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5" title={cInfo.name}>
                                                    <span className="text-lg leading-none">{cInfo.flag}</span>
                                                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{row.exchange}</span>
                                                </div>
                                            </td>

                                            {/* AI Score (danelfin circular score) */}
                                            <td className="px-4 py-4 text-center">
                                                {renderCircularScore(aiScoreNum, "AI")}
                                            </td>

                                            {/* Signal Type */}
                                            <td className="px-4 py-4 text-center">
                                                {row.signal.toUpperCase() === "BUY" ? (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black font-black text-xs bg-emerald-100 text-emerald-800 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                                                        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                                                        {translate("buy")}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black font-black text-xs bg-rose-100 text-rose-800 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                                                        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                                                        {translate("sell")}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Technical, Fundamental, Sentiment Circular Badges (Registered only) */}
                                            {user && (
                                                <>
                                                    <td className="px-4 py-4 text-center">
                                                        {renderCircularScore(row.technical_score || 5, "Tech")}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {renderCircularScore(row.fundamental_score || 5, "Fund")}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {renderCircularScore(row.sentiment_score || 5, "Sent")}
                                                    </td>
                                                </>
                                            )}

                                            {/* Low Risk */}
                                            <td className="px-4 py-4 text-center">
                                                {renderCircularScore(getLowRiskScore(row), "Risk")}
                                            </td>

                                            {/* Volume */}
                                            <td className="px-6 py-4 text-center font-mono font-bold text-zinc-700 dark:text-zinc-300">
                                                {formatVolume(row)}
                                            </td>

                                            {/* Sector */}
                                            <td className="px-6 py-4 text-xs font-black uppercase text-zinc-500">
                                                {row.sector || "N/A"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination Controls (Scanner or Authenticated Landing Page) */}
            {limit === Infinity && (!isLandingPage || user) && processedRows.length > itemsPerPage && (
                <div className="flex items-center justify-between p-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] text-black dark:text-white font-bold text-xs">
                    <span>
                        {translate("pageInfo")
                            .replace("{page}", currentPage.toString())
                            .replace("{pages}", totalPages.toString())}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="w-10 h-10 border-2 border-black flex items-center justify-center bg-white text-black hover:bg-zinc-100 disabled:opacity-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                        >
                            <ChevronLeft className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`} />
                        </button>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="w-10 h-10 border-2 border-black flex items-center justify-center bg-white text-black hover:bg-zinc-100 disabled:opacity-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                        >
                            <ChevronRight className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
