"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAIScanner } from "@/contexts/AIScannerContext";
import StockLogo from "./StockLogo";
import { useTheme } from "@/contexts/ThemeContext";
import TradingViewChart from "./TradingViewChartDynamic";
import TelegramServiceToggle from "./TelegramServiceToggle";
import RecommendationCalendar from "./RecommendationCalendar";
import {
    Search, Filter, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight,
    TrendingUp, TrendingDown, Layers, Info, CheckCircle2, X, BarChart2,
    Target, ShieldAlert, Cpu, BookOpen, TrendingUp as Bullish, Calendar,
    Award, ArrowUpRight, ArrowDownRight, Minus, ExternalLink, ShieldCheck,
    Share2, Loader2, Download, Check, Copy, Send, MessageCircle
} from "lucide-react";
import { isShariaCompliant } from "@/lib/shariaStocks";
import { toPng } from "html-to-image";
import { predictStock } from "@/lib/api";

function translateRationaleText(text: string, type: "brief" | "tech" | "fund", symbol: string = ""): string {
    if (!text) return "";
    
    // Helper to translate sector
    const translateSector = (sectorAr: string) => {
        if (!sectorAr) return "Speculative Sector";
        const sectorArClean = sectorAr.replace("قطاع ", "").trim();
        if (sectorArClean.includes("العقارات")) return "Real Estate";
        if (sectorArClean.includes("الخدمات المالية")) return "Financial Services";
        if (sectorArClean.includes("البناء") || sectorArClean.includes("التشيد") || sectorArClean.includes("التشييد")) return "Construction";
        if (sectorArClean.includes("المواد الخام") || sectorArClean.includes("التعدين")) return "Materials";
        if (sectorArClean.includes("المرافق") || sectorArClean.includes("الطاقة")) return "Utilities";
        if (sectorArClean.includes("الرعاية الصحية") || sectorArClean.includes("الأدوية")) return "Health Care";
        if (sectorArClean.includes("الأغذية") || sectorArClean.includes("المشروبات")) return "Food & Beverage";
        if (sectorArClean.includes("الاتصالات") || sectorArClean.includes("المعلومات")) return "Telecom";
        if (sectorArClean.includes("الكيماويات") || sectorArClean.includes("الأسمدة")) return "Chemicals";
        if (sectorArClean.includes("الصناعات التحويلية") || sectorArClean.includes("السلع")) return "Industrial Goods";
        return "Speculative Sector";
    };

    if (type === "brief") {
        const rsiMatch = text.match(/RSI\s*\(?(\d+)\)?|\(?(\d+)\)?\s*RSI/i);
        const adxMatch = text.match(/ADX\s*\(?(\d+)\)?|\(?(\d+)\)?\s*ADX/i);
        const rsi = rsiMatch ? (rsiMatch[1] || rsiMatch[2]) : "N/A";
        const adx = adxMatch ? (adxMatch[1] || adxMatch[2]) : "N/A";

        const entryMatch = text.match(/(?:سعر دخول مقترح حول|دخول حول)\s*(\d+(?:\.\d+)?)/);
        const t1Match = text.match(/(?:هدفاً أولاً عند|مستهدفين هدفاً أولاً عند)\s*(\d+(?:\.\d+)?)/);
        const t2Match = text.match(/(?:هدفاً ثانياً عند|وهدفاً ثانياً عند)\s*(\d+(?:\.\d+)?)/);
        const slMatch = text.match(/(?:وقف خسارة عند|وضع وقف خسارة عند)\s*(\d+(?:\.\d+)?)/);

        const entry = entryMatch ? entryMatch[1] : "N/A";
        const t1 = t1Match ? t1Match[1] : "N/A";
        const t2 = t2Match ? t2Match[1] : "N/A";
        const sl = slMatch ? slMatch[1] : "N/A";

        if (!rsiMatch && !adxMatch && !entryMatch && !t1Match && !t2Match && !slMatch) {
            return text;
        }

        return `Stock "${symbol}" shows an excellent speculative opportunity supported by RSI (${rsi}) and ADX (${adx}) trend indicator. A suggested entry price has been set around ${entry} EGP, targeting a first target at ${t1} EGP and a second target at ${t2} EGP, with a stop loss placed at ${sl} EGP to protect the portfolio.`;
    }

    if (type === "tech") {
        let translatedSentences: string[] = [];

        // 1. RSI sentence
        const rsiValMatch = text.match(/RSI.*?(\d+)/i) || text.match(/القوة النسبية.*?(\d+)/);
        if (rsiValMatch) {
            const rsi = rsiValMatch[1];
            if (text.includes("مرتفع") || text.includes("تشبع شراء")) {
                translatedSentences.push(`The Relative Strength Index (RSI) is high at ~${rsi}, indicating strong buying momentum and placing the stock in overbought territory.`);
            } else if (text.includes("منخفض") || text.includes("تشبع بيعي")) {
                translatedSentences.push(`The Relative Strength Index (RSI) is low at ~${rsi}, indicating that the stock has reached oversold territory, signaling the start of a technical bullish rebound.`);
            } else {
                translatedSentences.push(`The Relative Strength Index (RSI) is stable at ~${rsi}, opening the way for further steady technical upside without reaching overbought levels.`);
            }
        }

        // 2. ADX sentence
        const adxValMatch = text.match(/ADX.*?(\d+)/i) || text.match(/الاتجاه.*?(\d+)/);
        if (adxValMatch) {
            const adx = adxValMatch[1];
            if (text.includes("اتجاه صاعد واضح") || text.includes("استمرار الزخم")) {
                translatedSentences.push(`The Average Directional Index (ADX) at ~${adx} confirms a clear, strong uptrend that supports continued momentum.`);
            } else {
                translatedSentences.push(`The Average Directional Index (ADX) at ~${adx} points to an accumulation phase and the beginning of a new technical trend.`);
            }
        }

        // 3. EMA/MA sentence
        const emaMatch = text.match(/المتوسط.*?50.*?(\d+(?:\.\d+)?)/) || text.match(/50.*?المتوسط.*?(\d+(?:\.\d+)?)/);
        if (emaMatch) {
            const ema = emaMatch[1];
            if (text.includes("فوق المتوسط")) {
                translatedSentences.push(`The stock price remains above the 50-day moving average (${ema} EGP), providing a positive signal in the short term.`);
            } else {
                translatedSentences.push(`The stock is trading near a key technical support level, with expectations of a bullish rebound above the 50-day moving average (${ema} EGP).`);
            }
        } else if (text.includes("المتوسط 50 يوم") || text.includes("المتوسط المتحرك")) {
            translatedSentences.push(`The stock is trading near a key technical support level, with expectations of a bullish rebound above the 50-day moving average.`);
        }

        if (translatedSentences.length === 0) return text;
        return translatedSentences.join(" ");
    }

    if (type === "fund") {
        let translatedSentences: string[] = [];

        // 1. Sector sentence
        const sectorMatch = text.match(/ينتمي السهم لقطاع\s+(.*?)\s+وهو/) || text.match(/ينتمي السهم لقطاع\s+(.*?)\s+وقوي/);
        if (sectorMatch) {
            const sectorEng = translateSector(sectorMatch[1]);
            translatedSentences.push(`The stock belongs to the ${sectorEng} sector, which is a strong and supportive sector.`);
        } else if (text.includes("ينتمي السهم لقطاع")) {
            translatedSentences.push(`The stock belongs to a strong and supportive sector.`);
        }

        // 2. P/E sentence
        const peMatch = text.match(/P\/E.*?(\d+(?:\.\d+)?)/i) || text.match(/مكرر ربحية.*?(\d+(?:\.\d+)?)/);
        if (peMatch) {
            const pe = peMatch[1];
            translatedSentences.push(`The stock trades at a reasonable Price-to-Earnings (P/E) ratio of approximately ${pe}x, making it an attractive option.`);
        }

        // 3. EPS sentence
        const epsMatch = text.match(/EPS.*?(\d+(?:\.\d+)?)/i) || text.match(/ربحية سهم.*?(\d+(?:\.\d+)?)/);
        if (epsMatch) {
            const eps = epsMatch[1];
            translatedSentences.push(`The company recorded Earnings Per Share (EPS) of ${eps} EGP, supporting future operational growth.`);
        }

        if (translatedSentences.length === 0) return text;
        return translatedSentences.join(" ");
    }

    return text;
}

interface RecommendationsTableProps {
    isLandingPage?: boolean;
    limit?: number;
    hideTelegramToggle?: boolean;
}

type SpotlightCardProps = {
    children: React.ReactNode;
    className?: string;
    glowColor?: string;
    radius?: number;
};

function SpotlightCard({ children, className = "", glowColor, radius = 250 }: SpotlightCardProps) {
    const [coords, setCoords] = useState({ x: 0, y: 0 });
    const [isHovered, setIsHovered] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const { theme } = useTheme();

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        setCoords({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
    };

    // Gold/amber glow that matches the site's branding
    const defaultGlow = theme === "dark" ? "rgba(245, 158, 11, 0.16)" : "rgba(245, 158, 11, 0.08)";
    const finalGlow = glowColor || defaultGlow;

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`relative overflow-hidden ${className}`}
        >
            <div
                className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
                style={{
                    opacity: isHovered ? 1 : 0,
                    background: `radial-gradient(${radius}px circle at ${coords.x}px ${coords.y}px, ${finalGlow}, rgba(245, 158, 11, 0.02) 40%, transparent 80%)`,
                }}
            />
            {children}
        </div>
    );
}

export default function RecommendationsTable({ isLandingPage = false, limit = Infinity, hideTelegramToggle = false }: RecommendationsTableProps) {
    const { user } = useAuth();
    const { language } = useLanguage();
    const { theme } = useTheme();
    const router = useRouter();
    const isAr = language === "ar";

    // Use AIScannerContext for caching data
    const { recommendations, recsLoading, recsError, loadRecommendations } = useAIScanner();

    // Outdated warning retry state
    const [isOutdated, setIsOutdated] = useState(false);

    // Detail dialog state
    const [selectedRow, setSelectedRow] = useState<any>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Interactive Filters (Scanner or Authenticated Landing Page)
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSector, setSelectedSector] = useState("");
    const [selectedSignal, setSelectedSignal] = useState("");
    const [activeTab, setActiveTab] = useState<"active" | "closed" | "all" | "calendar">("active");
    const [timeRange, setTimeRange] = useState<"all" | "7d" | "30d">("all");
    const [sortBy, setSortBy] = useState("precision");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [shariaOnly, setShariaOnly] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    // Share card state
    const [shareRow, setShareRow] = useState<any>(null);
    const shareCardRef = useRef<HTMLDivElement>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const [shareCandles, setShareCandles] = useState<any[]>([]);
    const [loadingCandles, setLoadingCandles] = useState(false);

    // Translations
    const tDict = {
        title: { en: "Top Stocks Ranked by ML AI", ar: "أفضل الأسهم مرتبة بالذكاء الاصطناعي" },
        subtitle: { en: "Universe: EGX stocks evaluated by quantitative AI models. Stocks are ranked according to their AI Score, which rates the probability of beating the market in the next 30 days.", ar: "النطاق: أسهم البورصة المصرية مقيمة بنماذج كمية للذكاء الاصطناعي. يتم ترتيب الأسهم بناءً على تقييم الذكاء الاصطناعي الذي يحدد احتمالية التفوق على السوق خلال الـ 30 يوماً القادمة." },
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
        exit: { en: "EXIT", ar: "خروج" },
        searchPlaceholder: { en: "Search by stock symbol or name...", ar: "ابحث برمز السهم أو الاسم..." },
        prev: { en: "Previous", ar: "السابق" },
        next: { en: "Next", ar: "التالي" },
        pageInfo: { en: "Page {page} of {pages}", ar: "صفحة {page} من {pages}" },
        totalRows: { en: "Total Stocks: {count}", ar: "إجمالي الأسهم: {count}" },
        status: { en: "Status", ar: "الحالة" },
        return: { en: "Return", ar: "العائد" },
        shariaOnly: { en: "Sharia-Compliant Only", ar: "المتوافقة شرعياً فقط" },
        shariaHint: { en: "Show only EGX stocks screened for Sharia compliance (excludes banks, insurance, alcohol, tobacco & pork).", ar: "عرض أسهم البورصة المصرية المتوافقة شرعياً فقط (يستثني البنوك والتأمين والكحول والتبغ ولحم الخنزير)." },
        halal: { en: "Halal", ar: "حلال" },
        shareTrade: { en: "Share Trade", ar: "مشاركة الصفقة" },
        shareCardTitle: { en: "Trade Signal Card", ar: "كارت توصية الصفقة" },
        shareDownload: { en: "Download Image", ar: "تحميل الصورة" },
        shareX: { en: "Share on X", ar: "شارك على X" },
        shareTelegram: { en: "Share on Telegram", ar: "شارك على تيليجرام" },
        shareWhatsapp: { en: "Share on WhatsApp", ar: "شارك على واتساب" },
        shareFacebook: { en: "Share on Facebook", ar: "شارك على فيسبوك" },
        shareCopy: { en: "Copy", ar: "نسخ" },
        shareCopied: { en: "Copied!", ar: "تم النسخ!" },
        shareDownloading: { en: "Generating image...", ar: "جاري إنشاء الصورة..." },
        shareEntry: { en: "Entry", ar: "سعر الدخول" },
        shareTarget: { en: "Target", ar: "الهدف" },
        shareStop: { en: "Stop Loss", ar: "وقف الخسارة" },
        shareExit: { en: "Exit Price", ar: "سعر الخروج" },
        shareExitReason: { en: "Exit Reason", ar: "سبب الخروج" },
        shareClosedSignal: { en: "EXIT", ar: "خروج" },
        shareWinRate: { en: "Win Rate", ar: "نسبة النجاح" },
        shareScanDate: { en: "Scan Date", ar: "تاريخ التوصية" },
        shareDisclaimer: { en: "Not financial advice. Do your own research.", ar: "هذه ليست نصيحة مالية. ادرس بنفسك." },
        shareScore: { en: "AI Score", ar: "تقييم الذكاء" },
        shareSector: { en: "Sector", ar: "القطاع" },
        shareCurrent: { en: "Current", ar: "الحالي" },
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

    // Close dialog on ESC key
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelectedRow(null);
        };
        window.addEventListener("keydown", handleEsc);
        return () => window.removeEventListener("keydown", handleEsc);
    }, []);

    // Fetch candles for sharing
    useEffect(() => {
        if (!shareRow) {
            setShareCandles([]);
            return;
        }
        const fetchShareCandles = async () => {
            setLoadingCandles(true);
            try {
                const symbolBase = shareRow.symbol.split('.')[0];
                const exchange = shareRow.exchange || "EGX";
                const res = await fetch(`/api/ai_bot/candles?symbol=${encodeURIComponent(symbolBase)}&exchange=${exchange}&limit=120`);
                if (!res.ok) throw new Error(`Candles fetch failed: ${res.status}`);
                const data = await res.json();
                const candles = (data?.candles || []).map((c: any) => ({
                    date: c.date,
                    open: c.open ?? c.close,
                    high: c.high ?? c.close,
                    low: c.low ?? c.close,
                    close: c.close
                }));
                const sorted = candles.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
                const isClosed = shareRow.status?.toLowerCase() === "win" || shareRow.status?.toLowerCase() === "loss";
                let sliceStart = Math.max(0, sorted.length - 60);
                if (isClosed && shareRow.updated_at) {
                    const exitDateStr = new Date(shareRow.updated_at).toISOString().split('T')[0];
                    const exitIdx = sorted.findIndex((c: any) => c.date >= exitDateStr);
                    if (exitIdx !== -1) {
                        sliceStart = Math.max(0, exitIdx - 15);
                    }
                } else if (shareRow.created_at) {
                    const signalDateStr = new Date(shareRow.created_at).toISOString().split('T')[0];
                    const signalIdx = sorted.findIndex((c: any) => c.date >= signalDateStr);
                    if (signalIdx !== -1) {
                        sliceStart = Math.max(0, signalIdx - 10);
                    }
                }
                setShareCandles(sorted.slice(sliceStart));
            } catch (err) {
                console.error("Error loading share candles", err);
            } finally {
                setLoadingCandles(false);
            }
        };
        fetchShareCandles();
    }, [shareRow]);

    // Handle Landing Page Clicks Redirection for unauthenticated users
    const handleLandingClick = (e: React.MouseEvent) => {
        if (isLandingPage && !user) {
            e.preventDefault();
            e.stopPropagation();
            router.push("/scanner/backtests");
        }
    };

    const handleStockClick = (row: any) => {
        if (isLandingPage && !user) {
            router.push("/scanner/backtests");
        } else {
            setSelectedRow(row);
        }
    };

    const tabCounts = useMemo(() => {
        let items = recommendations;
        if (shariaOnly) {
            items = items.filter(r => isShariaCompliant(r.symbol));
        }

        const active = items.filter(r => {
            const s = (r.status || "").toLowerCase();
            return s !== "win" && s !== "loss";
        });
        const closed = items.filter(r => {
            const s = (r.status || "").toLowerCase();
            return s === "win" || s === "loss";
        });
        return {
            activeCount: active.length,
            closedCount: closed.length,
            totalCount: items.length
        };
    }, [recommendations, shariaOnly]);

    // Client-side filtering and sorting
    const processedRows = useMemo(() => {
        let items = [...recommendations];

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            items = items.filter(r =>
                r.name.toLowerCase().includes(q) ||
                r.symbol.toLowerCase().includes(q)
            );
        }
        if (selectedSector) {
            items = items.filter(r => r.sector === selectedSector);
        }
        if (selectedSignal) {
            items = items.filter(r => r.signal.toUpperCase() === selectedSignal.toUpperCase());
        }
        
        // Filter by Tab (Active vs Closed)
        if (activeTab === "active") {
            items = items.filter(r => {
                const s = (r.status || "").toLowerCase();
                return s !== "win" && s !== "loss";
            });
            // Deduplicate active recommendations by symbol (keep the latest one)
            const seen = new Set<string>();
            items = items.filter(r => {
                const sym = (r.symbol || "").toUpperCase();
                if (seen.has(sym)) return false;
                seen.add(sym);
                return true;
            });
        } else if (activeTab === "closed") {
            items = items.filter(r => {
                const s = (r.status || "").toLowerCase();
                return s === "win" || s === "loss";
            });
        }

        // Filter by Time Range
        if (timeRange !== "all") {
            const limitDate = new Date();
            limitDate.setDate(limitDate.getDate() - (timeRange === "7d" ? 7 : 30));
            items = items.filter(r => new Date(r.created_at || r.updated_at) >= limitDate);
        }

        if (shariaOnly) {
            items = items.filter(r => isShariaCompliant(r.symbol));
        }

        if (sortBy) {
            items.sort((a, b) => {
                let valA = a[sortBy];
                let valB = b[sortBy];
                
                if (valA == null) return 1;
                if (valB == null) return -1;
                
                if (sortBy === "symbol") {
                    return sortOrder === "asc" 
                        ? String(valA).localeCompare(String(valB))
                        : String(valB).localeCompare(String(valA));
                } else if (sortBy === "created_at") {
                    return sortOrder === "asc"
                        ? new Date(valA).getTime() - new Date(valB).getTime()
                        : new Date(valB).getTime() - new Date(valA).getTime();
                } else {
                    return sortOrder === "asc" 
                        ? Number(valA) - Number(valB)
                        : Number(valB) - Number(valA);
                }
            });
        } else {
            items.sort((a, b) => b.precision - a.precision);
        }
        return items;
    }, [recommendations, searchTerm, selectedSector, selectedSignal, activeTab, timeRange, shariaOnly, sortBy, sortOrder]);

    const handleHeaderClick = (field: string) => {
        if (sortBy === field) {
            setSortOrder(prev => prev === "asc" ? "desc" : "asc");
        } else {
            setSortBy(field);
            setSortOrder(field === "symbol" ? "asc" : "desc");
        }
        setCurrentPage(1);
    };

    const renderSortIcon = (field: string) => {
        if (sortBy !== field) return <span className="opacity-30 text-[10px] ml-1">⇅</span>;
        return <span className="ml-1 text-indigo-500 font-black text-xs">{sortOrder === "asc" ? "▲" : "▼"}</span>;
    };

    const limitedRows = useMemo(() => processedRows.slice(0, limit), [processedRows, limit]);

    const sectors = useMemo(() => {
        const list = Array.from(new Set(recommendations.map(m => m.sector || "General")));
        return list.filter(s => s && s !== "General").sort();
    }, [recommendations]);

    const displayRows = useMemo(() => {
        if (limit !== Infinity) return limitedRows;
        const start = (currentPage - 1) * itemsPerPage;
        return processedRows.slice(start, start + itemsPerPage);
    }, [processedRows, limitedRows, limit, currentPage]);

    // Compute the visible summary from the currently active tab/filter set.
    const stats = useMemo(() => {
        const active = processedRows.filter(r => {
            const s = (r.status || "").toLowerCase();
            return s !== "win" && s !== "loss";
        });
        const closed = processedRows.filter(r => {
            const s = (r.status || "").toLowerCase();
            return s === "win" || s === "loss";
        });
        const wins = closed.filter(r => (r.status || "").toLowerCase() === "win");
        const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
        const rowsWithReturn = processedRows.filter(r => r.profit_loss_pct != null);
        const avgReturn = rowsWithReturn.length > 0
            ? rowsWithReturn.reduce((sum, r) => sum + (r.profit_loss_pct || 0), 0) / rowsWithReturn.length
            : 0;

        return {
            activeCount: active.length,
            closedCount: closed.length,
            winRate,
            avgReturn,
            totalCount: processedRows.length
        };
    }, [processedRows]);

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

    const getCountryFlag = (country: string | undefined | null, ex: string | undefined | null) => {
        const normEx = (ex || "").toLowerCase();
        if (normEx === "egx" || normEx === "eg" || normEx === "ca") {
            return { flag: "🇪🇬", name: isAr ? "مصر" : "Egypt" };
        }
        return { flag: "🇺🇸", name: isAr ? "أمريكا" : "USA" };
    };

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

    const getLowRiskScore = (row: any) => {
        if (!row.stop_loss || !row.last_close) return 5;
        const distPct = Math.abs((row.last_close - row.stop_loss) / row.last_close);
        const score = Math.round(10 - distPct * 20);
        return Math.max(1, Math.min(10, score));
    };

    const getStatusBadge = (status: string, plPct: number | null) => {
        const s = (status || "").toLowerCase();
        if (s === "win") {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <ArrowUpRight className="w-3 h-3" />
                    {isAr ? "ربح" : "WIN"}
                    {plPct != null && ` +${plPct.toFixed(1)}%`}
                </span>
            );
        }
        if (s === "loss") {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <ArrowDownRight className="w-3 h-3" />
                    {isAr ? "خسارة" : "LOSS"}
                    {plPct != null && ` ${plPct.toFixed(1)}%`}
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Minus className="w-3 h-3" />
                {isAr ? "مفتوح" : "OPEN"}
                {plPct != null && ` ${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%`}
            </span>
        );
    };

    const renderSignalBadge = (row: any) => {
        const status = row.status?.toLowerCase();
        if (status === "win" || status === "loss") {
            return (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black dark:border-white font-black text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                    <Minus className="w-3.5 h-3.5 shrink-0" />
                    {translate("exit")}
                </span>
            );
        }
        if (row.signal.toUpperCase() === "BUY") {
            return (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black font-black text-xs bg-emerald-100 text-emerald-800 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                    {translate("buy")}
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black font-black text-xs bg-rose-100 text-rose-800 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                {translate("sell")}
            </span>
        );
    };

    const renderLandingCards = () => {
        const headerClass = "px-4 py-3 text-xs font-black uppercase tracking-wider text-black dark:text-white";
        return (
            <div className="divide-y-4 divide-black dark:divide-white">
                {/* Desktop header */}
                <div className="hidden md:grid md:grid-cols-[56px_1fr_80px_100px_110px_1fr] items-center bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white border-b-4 border-black dark:border-white">
                    <div className={`${headerClass} text-center`}>{translate("rank")}</div>
                    <div className={`${headerClass}`}>{translate("stockName")}</div>
                    <div className={`${headerClass} text-center`}>{translate("aiScore")}</div>
                    <div className={`${headerClass} text-center`}>{translate("signal")}</div>
                    <div className={`${headerClass} text-center`}>{isAr ? "الحالة" : "Status"}</div>
                    <div className={`${headerClass}`}>{translate("sector")}</div>
                </div>

                <div className="flex flex-col">
                    {displayRows.map((row, index) => {
                        const cInfo = getCountryFlag(row.country, row.exchange);
                        const rankNum = limit !== Infinity ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1;
                        const aiScoreNum = Number((row.precision * 10).toFixed(0));
                        const statusLower = row.status?.toLowerCase() || "open";
                        const rowBgClass =
                            statusLower === "win"
                                ? "bg-emerald-500/5 dark:bg-emerald-500/10"
                                : statusLower === "loss"
                                ? "bg-rose-500/5 dark:bg-rose-500/10"
                                : "";

                        return (
                            <div
                                key={row.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleStockClick(row);
                                }}
                                className={`group cursor-pointer transition-all duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${rowBgClass} border-b-4 border-black dark:border-white last:border-b-0`}
                            >
                                {/* Mobile card */}
                                <div className="md:hidden p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 border-2 border-black dark:border-white neobrutal-bg-yellow flex items-center justify-center font-black font-mono text-sm text-black">
                                                {rankNum}
                                            </div>
                                            <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="md" />
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-base font-black text-indigo-600 dark:text-indigo-400">{row.symbol}</span>
                                                    {isShariaCompliant(row.symbol) && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-black dark:border-white bg-emerald-400 text-black text-[8px] font-black uppercase tracking-wider shadow-[1px_1px_0px_rgba(0,0,0,1)] dark:shadow-[1px_1px_0px_rgba(255,255,255,1)]">
                                                            <ShieldCheck className="w-2.5 h-2.5" />
                                                            {translate("halal")}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[140px]" title={row.name}>
                                                    {row.name}
                                                </span>
                                            </div>
                                        </div>
                                        {renderCircularScore(aiScoreNum, "AI")}
                                    </div>
                                    <div className="flex items-center justify-between flex-wrap gap-3">
                                        <div className="flex items-center gap-2">
                                            {renderSignalBadge(row)}
                                            {getStatusBadge(row.status || "open", row.profit_loss_pct)}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs font-black text-zinc-500 uppercase">
                                            <span className="text-lg leading-none">{cInfo.flag}</span>
                                            <span className="truncate max-w-[110px]">{row.sector || "N/A"}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Desktop row */}
                                <div className="hidden md:grid md:grid-cols-[56px_1fr_80px_100px_110px_1fr] items-center px-4 py-3">
                                    <div className="text-center font-black font-mono text-zinc-500 text-sm">{rankNum}</div>
                                    <div className="flex items-center gap-3">
                                        <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="md" />
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-base font-black text-indigo-600 dark:text-indigo-400 hover:underline">{row.symbol}</span>
                                                {isShariaCompliant(row.symbol) && (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-black dark:border-white bg-emerald-400 text-black text-[8px] font-black uppercase tracking-wider shadow-[1px_1px_0px_rgba(0,0,0,1)] dark:shadow-[1px_1px_0px_rgba(255,255,255,1)]">
                                                        <ShieldCheck className="w-2.5 h-2.5" />
                                                        {translate("halal")}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[200px]" title={row.name}>
                                                {row.name}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex justify-center">{renderCircularScore(aiScoreNum, "AI")}</div>
                                    <div className="flex justify-center">{renderSignalBadge(row)}</div>
                                    <div className="flex justify-center">{getStatusBadge(row.status || "open", row.profit_loss_pct)}</div>
                                    <div className="text-xs font-black uppercase text-zinc-500 flex items-center gap-1.5">
                                        <span className="text-lg leading-none">{cInfo.flag}</span>
                                        <span className="truncate">{row.sector || "N/A"}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // ─── Details Dialog ───────────────────────────────────────────────────────
    const renderDialog = () => {
        if (!selectedRow) return null;
        const row = selectedRow;
        const isDark = theme === "dark";
        const d = (dk: string, lt: string) => isDark ? dk : lt;
        const richDetails = row.top_reasons && typeof row.top_reasons === "object" && !Array.isArray(row.top_reasons) ? row.top_reasons : null;
        const legacyReasons = Array.isArray(row.top_reasons) ? row.top_reasons : [];
        const aiScoreNum = Math.round((row.precision || 0) * 10);
        const cInfo = getCountryFlag(null, row.exchange);

        // ── Computed values ──
        const plPct = row.profit_loss_pct ?? null;
        const currentPrice = row.last_close || 0;
        const entryPrice = row.entry_price || (plPct && plPct !== -100 ? (currentPrice / (1 + plPct / 100)) : currentPrice) || 0;

        const adjustments: any[] = row.adjustments || [];
        const lastAdj = adjustments.length > 0 ? adjustments[adjustments.length - 1] : null;
        const targetPrice = lastAdj?.new_target ? Number(lastAdj.new_target) : (row.target_price || 0);
        const stopLoss = lastAdj?.new_stop ? Number(lastAdj.new_stop) : (row.stop_loss || 0);

        const hasTarget2 = !!richDetails?.target_2;
        const rawTarget2 = hasTarget2 ? Number(richDetails.target_2) : 0;
        // SYNC GUARD: target 1 may have been raised by smart adjustments while the
        // stored target_2 stayed stale — always keep the second target above the first.
        const target2 = rawTarget2 > 0 ? Math.max(rawTarget2, Math.round(targetPrice * 1.1 * 100) / 100) : 0;

        // Calculate ATR from Entry Price & Stop Loss (since SL = Entry - 1.0x ATR, ATR = Entry - SL)
        const atrValue = entryPrice && stopLoss && entryPrice > stopLoss ? (entryPrice - stopLoss) : 0;
        const hasAtr = atrValue > 0;

        const normalizedStatus = (row.status || "").toLowerCase();
        const isWin = normalizedStatus === "win";
        const isLoss = normalizedStatus === "loss";
        const isClosed = isWin || isLoss;

        // Determine exit reason dynamically
        let exitReason = "";
        if (isClosed && row.exit_price) {
            const diffTarget = Math.abs(row.exit_price - targetPrice);
            const diffStop = Math.abs(row.exit_price - stopLoss);
            if (diffTarget < diffStop && diffTarget < 0.05 * targetPrice) {
                exitReason = isAr ? "تحقيق الهدف الأول" : "Target 1 Reached";
            } else if (diffStop < diffTarget && diffStop < 0.05 * stopLoss) {
                if (isWin) {
                    exitReason = isAr ? "وقف خسارة متحرك (حجز أرباح)" : "Trailing Stop Loss (Profit Locked)";
                } else {
                    exitReason = isAr ? "تفعيل وقف الخسارة" : "Hit Stop Loss";
                }
            } else {
                exitReason = isWin ? (isAr ? "إغلاق يدوي/أوتوماتيكي بربح" : "Manual/Auto Close (Win)") : (isAr ? "إغلاق يدوي/أوتوماتيكي بخسارة" : "Manual/Auto Close (Loss)");
            }
        }

        const risk = entryPrice && stopLoss ? Math.abs(entryPrice - stopLoss) : 0;
        const reward = entryPrice && targetPrice ? Math.abs(targetPrice - entryPrice) : 0;
        const rrRatio = risk > 0 ? (reward / risk) : 0;
        const potReturn = currentPrice && targetPrice ? ((targetPrice - currentPrice) / currentPrice) * 100 : 0;
        const changePct = row.change_pct ?? null;
        const lastUpdated = row.updated_at || row.created_at || null;
        const pctChangeSinceRec = isClosed
            ? (row.exit_price && entryPrice > 0 ? ((row.exit_price - entryPrice) / entryPrice) * 100 : (plPct ?? 0))
            : (entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0);

        const formatDate = (ts: string) => new Date(ts).toLocaleDateString(isAr ? "ar-EG" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        const scoreColor = (v: number, max: number) => {
            const pct = v / max;
            return pct >= 0.7 ? "text-emerald-400" : pct >= 0.5 ? "text-amber-400" : "text-rose-400";
        };

        const scoreBarColor = (v: number, max: number) => {
            const pct = v / max;
            return pct >= 0.7 ? "bg-emerald-500" : pct >= 0.5 ? "bg-amber-500" : "bg-rose-500";
        };

        if (!mounted) return null;

        return createPortal(
            <div className={`fixed inset-0 z-[2147483647] flex flex-col ${d("bg-zinc-950/95", "bg-zinc-100/90")} backdrop-blur-md animate-in fade-in duration-200`} dir={isAr ? "rtl" : "ltr"} onClick={() => setSelectedRow(null)}>
                {/* Top floating control bar */}
                <div className={`flex items-center justify-between gap-4 px-4 sm:px-8 py-4 border-b-2 ${d("border-white/10", "border-zinc-300")} ${d("bg-zinc-950/90", "bg-white/90")} backdrop-blur-md flex-shrink-0`} onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-3 min-w-0">
                        <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="md" />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className={`text-xl sm:text-2xl font-black ${d("text-white", "text-zinc-900")} uppercase tracking-tight`}>{row.symbol}</h2>
                                <span className={`text-[10px] font-bold ${d("text-zinc-400", "text-zinc-500")} ${d("bg-zinc-800", "bg-zinc-100")} px-2 py-0.5 border ${d("border-white/5", "border-zinc-200")}`}>{row.exchange}</span>
                                <span className="text-base">{cInfo.flag}</span>
                                {row.status?.toLowerCase() === "win" || row.status?.toLowerCase() === "loss" ? (
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 ${d("bg-zinc-700 text-white", "bg-zinc-200 text-zinc-900")} font-black text-[10px]`}>
                                        <Minus className="w-3 h-3" /> {translate("exit")}
                                    </span>
                                ) : row.signal?.toUpperCase() === "BUY" ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500 text-zinc-950 font-black text-[10px]">
                                        <TrendingUp className="w-3 h-3" /> {translate("buy")}
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-500 text-zinc-950 font-black text-[10px]">
                                        <TrendingDown className="w-3 h-3" /> {translate("sell")}
                                    </span>
                                )}
                                {getStatusBadge(row.status, row.profit_loss_pct)}
                            </div>
                            <p className={`text-xs sm:text-sm ${d("text-zinc-400", "text-zinc-600")} font-medium truncate mt-0.5`}>{row.name}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            onClick={() => setShareRow(row)}
                            className="h-9 px-2 sm:px-3 bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 text-xs font-black flex items-center gap-1.5 transition-colors active:scale-95 border-2 border-black"
                            title={translate("shareTrade")}
                        >
                            <Share2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{translate("shareTrade")}</span>
                        </button>
                        <button
                            onClick={() => {
                                const baseSym = row.symbol.split('.')[0].toLowerCase();
                                router.push(`/stocks/${baseSym}`);
                            }}
                            className="h-9 px-2 sm:px-3 bg-teal-400 text-zinc-950 hover:bg-teal-300 text-xs font-black flex items-center gap-1.5 transition-colors active:scale-95 border-2 border-black"
                        >
                            <BarChart2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{isAr ? "التحليل" : "Analysis"}</span>
                        </button>
                        <button
                            onClick={() => router.push(`/chart?symbol=${encodeURIComponent(row.symbol.toUpperCase())}&exchange=${encodeURIComponent(row.exchange || "EGX")}`)}
                            className="h-9 px-2 sm:px-3 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-black flex items-center gap-1.5 transition-colors active:scale-95 border-2 border-black"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{isAr ? "الشارت" : "Chart"}</span>
                        </button>
                        <button
                            onClick={() => setSelectedRow(null)}
                            className="h-9 px-2 sm:px-3 flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black transition-colors active:scale-95 border-2 border-black"
                            aria-label={isAr ? "إغلاق" : "Close"}
                        >
                            <X className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{isAr ? "إغلاق" : "Close"}</span>
                        </button>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="relative z-10 flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                    <div className="max-w-6xl mx-auto p-4 sm:p-8 space-y-8" onClick={e => e.stopPropagation()}>

                         {/* Stock Symbol, Logo, and Full Name Header Card */}
                         <div className={`flex items-center gap-4 ${d("bg-zinc-900", "bg-white")} border-2 ${d("border-white/5", "border-zinc-300")} p-5`}>
                            <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="lg" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                <h1 className={`text-2xl sm:text-3xl font-black ${d("text-white", "text-zinc-900")} uppercase tracking-tight`}>{row.symbol}</h1>
                                <span className={`text-[10px] font-bold ${d("text-zinc-400", "text-zinc-600")} ${d("bg-zinc-800", "bg-zinc-100")} px-2 py-0.5 border ${d("border-white/5", "border-zinc-200")}`}>{row.exchange}</span>
                                    <span className="text-xl">{cInfo.flag}</span>
                                {row.status?.toLowerCase() === "win" || row.status?.toLowerCase() === "loss" ? (
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 ${d("bg-zinc-700 text-white", "bg-zinc-200 text-zinc-900")} font-black text-[10px]`}>
                                        <Minus className="w-3 h-3" /> {translate("exit")}
                                    </span>
                                    ) : row.signal?.toUpperCase() === "BUY" ? (
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500 text-zinc-950 font-black text-[10px] uppercase`}>
                                            <TrendingUp className="w-3 h-3" /> {translate("buy")}
                                        </span>
                                    ) : (
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-500 text-zinc-950 font-black text-[10px] uppercase`}>
                                            <TrendingDown className="w-3 h-3" /> {translate("sell")}
                                        </span>
                                    )}
                                    {getStatusBadge(row.status, row.profit_loss_pct)}
                                </div>
                                <p className={`text-sm sm:text-base ${d("text-zinc-300", "text-zinc-700")} font-bold mt-1`}>{row.name}</p>
                            </div>
                        </div>

                             {/* ── Hero Price Card ── */}
                             <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4`}>
                                 <div className={`lg:col-span-2 bg-gradient-to-br ${d("from-indigo-600/20", "from-indigo-50")} ${d("to-violet-600/10", "to-violet-50")} border-2 ${d("border-indigo-500/20", "border-indigo-200")} p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6`}>
                                <div>
                                    <p className={`text-xs font-bold uppercase tracking-widest ${d("text-indigo-300", "text-indigo-600")} mb-1`}>
                                        {isClosed 
                                            ? (isAr ? "سعر الخروج" : "Exit Price") 
                                            : (isAr ? "السعر الحالي" : "Current Price")}
                                    </p>
                                        <div className="flex items-baseline gap-3">
                                            <span className={`text-4xl sm:text-5xl font-black ${d("text-white", "text-zinc-900")}`}>
                                            {isClosed && row.exit_price 
                                                ? `${Number(row.exit_price).toFixed(2)}` 
                                                : (currentPrice ? `${currentPrice.toFixed(2)}` : "—")}
                                        </span>
                                        <span className={`text-sm font-bold ${d("text-zinc-400", "text-zinc-500")}`}>EGP</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                        {plPct != null && (
                                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-black ${plPct >= 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
                                                {plPct >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                                                {plPct >= 0 ? "+" : ""}{plPct.toFixed(2)}%
                                            </div>
                                        )}
                                        {pctChangeSinceRec != null && (
                                            <div 
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold cursor-help ${pctChangeSinceRec >= 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}
                                                title={isAr ? "نسبة التغير الإجمالية منذ تاريخ توصية البوت" : "Total change percentage since the bot's recommendation"}
                                            >
                                                {pctChangeSinceRec >= 0 ? "▲" : "▼"} {pctChangeSinceRec >= 0 ? "+" : ""}{pctChangeSinceRec.toFixed(2)}%
                                                 <span className={`${d("text-zinc-500", "text-zinc-600")} font-medium`}>{isAr ? "منذ التوصية" : "since rec"}</span>
                                                 <Info className={`w-3.5 h-3.5 ${d("text-zinc-400", "text-zinc-500")} inline-block shrink-0`} />
                                            </div>
                                        )}
                                    </div>
                                    {lastUpdated && (
                                        <p className={`text-[10px] ${d("text-zinc-500", "text-zinc-400")} mt-1.5 flex items-center gap-1`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${d("bg-zinc-500", "bg-zinc-400")} inline-block`} />
                                            {isAr ? "آخر تحديث" : "Last updated"}: {formatDate(lastUpdated)}
                                        </p>
                                    )}
                                    {isClosed && exitReason && (
                                        <p className={`text-xs font-bold text-indigo-300 dark:text-indigo-400 mt-2 flex items-center gap-1.5`}>
                                            <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block animate-pulse" />
                                            {isAr ? `سبب الخروج: ${exitReason}` : `Exit Reason: ${exitReason}`}
                                        </p>
                                    )}
                                </div>
                                <div className={`flex flex-col gap-2 text-sm min-w-[140px]`}>
                                    <div className={`flex justify-between gap-4`}>
                                        <span className={`${d("text-zinc-400", "text-zinc-600")}`}>{isAr ? "الهدف" : "Target"}</span>
                                        <span className={`font-black text-emerald-400`}>{targetPrice ? targetPrice.toFixed(2) : "—"}</span>
                                    </div>
                                    <div className={`flex justify-between gap-4`}>
                                        <span className={`${d("text-zinc-400", "text-zinc-600")}`}>{isAr ? "وقف الخسارة" : "Stop Loss"}</span>
                                        <span className={`font-black text-rose-400`}>{stopLoss ? stopLoss.toFixed(2) : "—"}</span>
                                    </div>
                                    {hasTarget2 && (
                                        <div className="flex justify-between gap-4">
                                            <span className={`${d("text-zinc-400", "text-zinc-600")}`}>{isAr ? "الهدف 2" : "Target 2"}</span>
                                            <span className={`font-black text-amber-400`}>{target2.toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                             {/* AI Score Big Card */}
                             <div className={`${d("bg-zinc-900", "bg-white")} border-2 ${d("border-white/10", "border-zinc-300")} p-6 flex flex-col items-center justify-center gap-3`}>
                                <div className="relative w-28 h-28">
                                     <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                         <circle cx="50" cy="50" r="42" fill="none" stroke={isDark ? "rgb(255 255 255 / 0.06)" : "rgb(0 0 0 / 0.06)"} strokeWidth="8" />
                                        <circle
                                            cx="50" cy="50" r="42" fill="none"
                                            stroke={aiScoreNum >= 7 ? "#22c55e" : aiScoreNum >= 5 ? "#f59e0b" : "#f43f5e"}
                                            strokeWidth="8" strokeLinecap="round"
                                            strokeDasharray={2 * Math.PI * 42}
                                            strokeDashoffset={2 * Math.PI * 42 - (aiScoreNum / 10) * (2 * Math.PI * 42)}
                                            className="transition-all duration-1000 ease-out"
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className={`text-3xl font-black ${scoreColor(aiScoreNum, 10)}`}>{aiScoreNum}</span>
                                        <span className={`text-[10px] font-bold ${d("text-zinc-500", "text-zinc-500")} uppercase`}>/10</span>
                                    </div>
                                </div>
                                <span className={`text-xs font-black uppercase tracking-widest ${d("text-zinc-400", "text-zinc-500")}`}>{isAr ? "تقييم الذكاء" : "AI Score"}</span>
                            </div>
                        </div>

                        {/* ── Sub Scores ── */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { label: isAr ? "الفني" : "Technical", val: row.technical_score || 5, color: "sky" },
                                { label: isAr ? "الأساسي" : "Fundamental", val: row.fundamental_score || 5, color: "violet" },
                                { label: isAr ? "نسبة النجاح" : "Win Rate", val: richDetails?.expected_win_pct || Math.round(row.precision * 100), max: 100, suffix: "%", color: "emerald" },
                            ].map((item, idx) => {
                                const max = item.max || 10;
                                const pct = Math.min(100, (item.val / max) * 100);
                                return (
                                    <div key={idx} className={`${d("bg-zinc-900/50", "bg-zinc-50")} border ${d("border-white/5", "border-zinc-200")} p-4 space-y-3`}>
                                    <div className={`flex items-center justify-between`}>
                                        <span className={`text-xs font-bold uppercase tracking-widest ${d("text-zinc-400", "text-zinc-600")}`}>{item.label}</span>
                                        <span className={`text-xl font-black ${scoreColor(item.val, max)}`}>{item.val}{item.suffix || ""}</span>
                                    </div>
                                    <div className={`w-full h-2 ${d("bg-white/5", "bg-zinc-200")} overflow-hidden`}>
                                            <div className={`h-full ${scoreBarColor(item.val, max)} transition-all duration-700`} style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── Rationale ── */}
                        {richDetails && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {richDetails.brief_rationale && (
                                    <div className={`lg:col-span-2 ${d("bg-indigo-500/[0.05]", "bg-indigo-50")} border-l-4 border-indigo-500 p-5`}>
                                        <h3 className={`text-xs font-black uppercase tracking-widest text-indigo-400 mb-3 flex items-center gap-2`}>
                                            <Info className="w-3.5 h-3.5" />
                                            {isAr ? "لماذا هذا السهم؟" : "Why This Stock?"}
                                        </h3>
                                        <p className="text-sm sm:text-base text-zinc-200 dark:text-zinc-800 leading-relaxed font-medium" dir={isAr ? "rtl" : "ltr"}>
                                            {isAr ? richDetails.brief_rationale : translateRationaleText(richDetails.brief_rationale, "brief", row.symbol)}
                                        </p>
                                    </div>
                                )}
                                {richDetails.technical_rationale && (
                                    <div className={`${d("bg-zinc-900/50", "bg-zinc-50")} border ${d("border-white/5", "border-zinc-200")} p-5`}>
                                        <h4 className={`text-xs font-black uppercase tracking-widest text-sky-400 mb-3 flex items-center gap-2`}>
                                            <BarChart2 className="w-3.5 h-3.5" />
                                            {isAr ? "التحليل الفني" : "Technical Analysis"}
                                        </h4>
                                        <p className={`text-sm ${d("text-zinc-300", "text-zinc-700")} leading-relaxed`} dir={isAr ? "rtl" : "ltr"}>
                                            {isAr ? richDetails.technical_rationale : translateRationaleText(richDetails.technical_rationale, "tech", row.symbol)}
                                        </p>
                                    </div>
                                )}
                                {richDetails.fundamental_rationale && (
                                    <div className={`${d("bg-zinc-900/50", "bg-zinc-50")} border ${d("border-white/5", "border-zinc-200")} p-5`}>
                                        <h4 className={`text-xs font-black uppercase tracking-widest text-amber-400 mb-3 flex items-center gap-2`}>
                                            <BookOpen className="w-3.5 h-3.5" />
                                            {isAr ? "التحليل الأساسي" : "Fundamental Analysis"}
                                        </h4>
                                        <p className={`text-sm ${d("text-zinc-300", "text-zinc-700")} leading-relaxed`} dir={isAr ? "rtl" : "ltr"}>
                                            {isAr ? richDetails.fundamental_rationale : translateRationaleText(richDetails.fundamental_rationale, "fund", row.symbol)}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Legacy Reasons ── */}
                        {legacyReasons.length > 0 && (
                            <div className={`${d("bg-zinc-900/50", "bg-zinc-50")} border ${d("border-white/5", "border-zinc-200")} p-5`}>
                                <h3 className={`text-xs font-black uppercase tracking-widest ${d("text-zinc-300", "text-zinc-700")} mb-4 flex items-center gap-2`}>
                                    <Layers className="w-3.5 h-3.5" />
                                    {isAr ? "أسباب الاختيار" : "Selection Reasons"}
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {legacyReasons.map((reason: string, i: number) => (
                                        <div key={i} className={`flex items-start gap-3 p-3 ${d("bg-zinc-950/50 border border-white/5", "bg-zinc-100 border border-zinc-200")}`}>
                                            <span className="w-6 h-6 flex items-center justify-center bg-indigo-600/20 text-indigo-400 text-xs font-black flex-shrink-0">{i + 1}</span>
                                            <span className={`text-sm ${d("text-zinc-300", "text-zinc-700")}`}>{reason}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── No details fallback ── */}
                        {!richDetails && legacyReasons.length === 0 && (
                            <div className={`border-2 border-dashed ${d("border-zinc-700", "border-zinc-300")} ${d("bg-zinc-900/30", "bg-zinc-100")} p-8 text-center`}>
                                <Info className={`w-10 h-10 ${d("text-zinc-600", "text-zinc-400")} mx-auto mb-4`} />
                                <p className={`text-sm ${d("text-zinc-400", "text-zinc-500")} font-medium`}>
                                    {isAr ? "لا توجد تفاصيل إضافية متاحة." : "No additional details available."}
                                </p>
                            </div>
                        )}

                        {/* ── Adjustments Timeline ── */}
                        {adjustments.length > 0 && (
                            <div className={`${d("bg-amber-500/[0.05]", "bg-amber-50")} border ${d("border-amber-500/20", "border-amber-200")} p-5`}>
                                <h3 className={`text-xs font-black uppercase tracking-widest text-amber-400 mb-5 flex items-center gap-2`}>
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    {isAr ? "سجل التعديلات الذكية" : "Smart Adjustments"}
                                </h3>
                                <div className="space-y-3">
                                    {adjustments.map((adj: any, i: number) => {
                                        const isTargetRaise = adj.type === "target_raised";
                                        const isStopRaise = adj.type === "stop_raised";
                                        const adjColor = isTargetRaise ? "emerald" : isStopRaise ? "rose" : "amber";
                                        const AdjIcon = isTargetRaise ? TrendingUp : isStopRaise ? ShieldAlert : RefreshCw;
                                        return (
                                            <div key={i} className={`flex items-start gap-4 p-4 ${d("bg-zinc-950/60", "bg-white")} border ${d("border-white/5", "border-zinc-200")}`}>
                                                <div className={`w-10 h-10 flex items-center justify-center flex-shrink-0 bg-${adjColor}-500/10 border border-${adjColor}-500/20`}>
                                                    <AdjIcon className={`w-4 h-4 text-${adjColor}-400`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                                                        <span className={`text-xs font-black uppercase text-${adjColor}-400`}>
                                                            {isTargetRaise ? (isAr ? "رفع الهدف" : "Target Raised") : isStopRaise ? (isAr ? "تضييق وقف الخسارة" : "Stop Tightened") : (adj.reason_en || adj.type)}
                                                        </span>
                                                        {adj.timestamp && <span className={`text-[10px] ${d("text-zinc-500", "text-zinc-400")}`}>{formatDate(adj.timestamp)}</span>}
                                                    </div>
                                                    <p className={`text-xs ${d("text-zinc-400", "text-zinc-500")} mb-2`} dir="rtl">{adj.reason_ar || adj.reason_en || ""}</p>
                                                    <div className="flex flex-wrap gap-3 text-[10px]">
                                                        {adj.old_target && adj.new_target && (
                                                            <span className={`${d("bg-zinc-900", "bg-zinc-200")} px-2 py-1 ${d("text-zinc-300", "text-zinc-700")}`}>
                                                                🎯 {isAr ? "الهدف" : "Target"}: <span className={`line-through ${d("text-zinc-500", "text-zinc-500")}`}>{Number(adj.old_target).toFixed(2)}</span> → <span className="text-emerald-400 font-bold">{Number(adj.new_target).toFixed(2)}</span>
                                                            </span>
                                                        )}
                                                        {adj.old_stop && adj.new_stop && (
                                                            <span className={`${d("bg-zinc-900", "bg-zinc-200")} px-2 py-1 ${d("text-zinc-300", "text-zinc-700")}`}>
                                                                🛡️ SL: <span className={`line-through ${d("text-zinc-500", "text-zinc-500")}`}>{Number(adj.old_stop).toFixed(2)}</span> → <span className="text-rose-400 font-bold">{Number(adj.new_stop).toFixed(2)}</span>
                                                            </span>
                                                        )}
                                                        {adj.pl_pct != null && (
                                                            <span className={`px-2 py-1 font-bold ${adj.pl_pct >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                                                                {adj.pl_pct >= 0 ? "+" : ""}{Number(adj.pl_pct).toFixed(1)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── Trade Details & Chart ── */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div className={`lg:col-span-1 ${d("bg-zinc-900/50", "bg-zinc-50")} border ${d("border-white/5", "border-zinc-200")} p-5 space-y-4 h-fit`}>
                                <h4 className={`text-xs font-black uppercase tracking-widest ${d("text-zinc-400", "text-zinc-600")} mb-2 flex items-center gap-2`}>
                                    <Calendar className="w-3.5 h-3.5" />
                                    {isAr ? "تفاصيل الصفقة" : "Trade Details"}
                                </h4>
                                {[
                                    { label: isAr ? "سعر الدخول" : "Entry Price", value: entryPrice ? `${entryPrice.toFixed(2)} EGP` : "—", color: d("text-white", "text-zinc-900") },
                                    { 
                                        label: isAr ? "الهدف الأول" : "Target 1", 
                                        subLabel: hasAtr ? (isAr ? "دخول + 2.0x ATR" : "Entry + 2.0x ATR") : undefined,
                                        value: targetPrice ? `${targetPrice.toFixed(2)} EGP` : "—", 
                                        color: "text-emerald-400" 
                                    },
                                    ...(hasTarget2 ? [{
                                        label: isAr ? "الهدف الثاني" : "Target 2",
                                        subLabel: isAr ? "هدف معزز (+10% للهدف 1)" : "Extended Target (+10% of T1)",
                                        value: `${target2.toFixed(2)} EGP`,
                                        color: "text-amber-400"
                                    }] : []),
                                    { 
                                        label: isAr ? "وقف الخسارة" : "Stop Loss", 
                                        subLabel: hasAtr ? (isAr ? "دخول - 1.0x ATR" : "Entry - 1.0x ATR") : undefined,
                                        value: stopLoss ? `${stopLoss.toFixed(2)} EGP` : "—", 
                                        color: "text-rose-400" 
                                    },
                                    ...(hasAtr ? [{
                                         label: isAr ? "متوسط المدى الحقيقي (ATR)" : "Average True Range (ATR)",
                                         subLabel: isAr ? "نطاق حركة السعر اليومية (14 يوم)" : "Daily volatility range (14d)",
                                         value: `${atrValue.toFixed(2)} EGP`,
                                         color: `${d("text-zinc-300", "text-zinc-600")} font-mono`
                                     }] : []),
                                    { label: isAr ? "نسبة المخاطرة/العائد" : "Risk/Reward", value: rrRatio > 0 ? `1:${rrRatio.toFixed(1)}` : "—", color: "text-indigo-400" },
                                    {
                                        label: isAr ? "نسبة التغيّر منذ التوصية" : "Chg. Since Rec.",
                                        value: pctChangeSinceRec !== null ? `${pctChangeSinceRec >= 0 ? "+" : ""}${pctChangeSinceRec.toFixed(2)}%` : "—",
                                        color: pctChangeSinceRec !== null && pctChangeSinceRec >= 0 ? "text-emerald-400" : "text-rose-400"
                                    },
                                    { label: isAr ? "تاريخ التوصية" : "Rec. Date", value: row.created_at ? formatDate(row.created_at) : "—", color: "text-zinc-300" },
                                    {
                                        label: isAr ? "آخر مراجعة للروبوت" : "Last Bot Review",
                                        value: row.updated_at ? formatDate(row.updated_at) : (row.created_at ? formatDate(row.created_at) : "—"),
                                        color: "text-amber-400"
                                    },
                                    ...(isClosed && row.exit_price ? [{ label: isAr ? "سعر الخروج" : "Exit Price", value: `${row.exit_price.toFixed(2)} EGP`, color: isWin ? "text-emerald-400" : "text-rose-400" }] : []),
                                    ...(isClosed && exitReason ? [{ label: isAr ? "سبب الخروج" : "Exit Reason", value: exitReason, color: isWin ? "text-emerald-400" : "text-rose-400" }] : []),
                                ].map((item, idx) => (
                                    <div key={idx} className={`flex items-center justify-between py-2 border-b ${d("border-white/5", "border-zinc-200")} last:border-0`}>
                                        <div className="flex flex-col">
                                            <span className={`text-xs ${d("text-zinc-500", "text-zinc-500")}`}>{item.label}</span>
                                            {item.subLabel && (
                                                <span className={`text-[9px] ${d("text-zinc-600", "text-zinc-400")} font-mono mt-0.5`}>{item.subLabel}</span>
                                            )}
                                        </div>
                                        <span className={`text-sm font-black ${item.color}`}>{item.value}</span>
                                    </div>
                                ))}
                            </div>

                            <div className={`lg:col-span-2 border-2 ${d("border-white/5", "border-zinc-300")} overflow-hidden ${d("bg-zinc-950", "bg-white")}`}>
                                <div className={`${d("bg-zinc-900", "bg-zinc-100")} px-4 py-3 border-b ${d("border-white/5", "border-zinc-200")} flex items-center justify-between`}>
                                    <span className={`text-xs font-black uppercase tracking-widest ${d("text-zinc-300", "text-zinc-600")} flex items-center gap-2`}>
                                        <BarChart2 className="w-3.5 h-3.5" />
                                        {isAr ? "الشارت التفاعلي" : "Interactive Chart"}
                                    </span>
                                    <span className={`text-xs font-bold ${d("text-zinc-500", "text-zinc-500")}`}>{row.symbol}</span>
                                </div>
                                <div style={{ height: 520 }}>
                                    <TradingViewChart
                                        symbol={row.symbol}
                                        exchange={row.exchange}
                                        theme={isDark ? "dark" : "light"}
                                        showApiMarkers={false}
                                        customMarkers={
                                            [
                                                ...(row.entry_price && row.created_at ? [{
                                                    time: Math.floor(new Date(row.created_at).getTime() / 1000),
                                                    position: "belowBar" as const,
                                                    color: "#22c55e",
                                                    shape: "arrowUp" as const,
                                                    text: isAr ? "توصية" : "Signal",
                                                    size: 2
                                                }] : []),
                                                ...(isClosed && row.updated_at ? [{
                                                    time: Math.floor(new Date(row.updated_at).getTime() / 1000),
                                                    position: "aboveBar" as const,
                                                    color: isWin ? "#10b981" : "#ef4444",
                                                    shape: "arrowDown" as const,
                                                    text: isAr ? (isWin ? "خروج بربح" : "خروج بخسارة") : (isWin ? "Exit (Win)" : "Exit (Loss)"),
                                                    size: 2
                                                }] : [])
                                            ]
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        {richDetails?.news_source && (
                            <p className={`text-xs ${d("text-zinc-500", "text-zinc-500")} text-right`} dir="rtl">
                                📑 {richDetails.news_source}
                            </p>
                        )}

                        {/* ── Bottom close button ── */}
                        <div className="flex justify-center pt-4 pb-8">
                            <button
                                onClick={() => setSelectedRow(null)}
                                className="h-12 px-8 bg-rose-600 hover:bg-rose-500 text-white text-sm font-black flex items-center gap-2 transition-colors active:scale-95"
                            >
                                <X className="w-5 h-5" />
                                {isAr ? "إغلاق التفاصيل" : "Close Details"}
                            </button>
                        </div>

                    </div>
                </div>
            </div>,
            document.body
        );
    };

    const renderShareDialog = () => {
        if (!shareRow) return null;
        const row = shareRow;
        const aiScoreNum = Math.round((row.precision || 0) * 10);
        const plPct = row.profit_loss_pct ?? null;
        const currentPrice = row.last_close || 0;
        const entryPrice = row.entry_price || (plPct && plPct !== -100 ? (currentPrice / (1 + plPct / 100)) : currentPrice) || 0;
        const adjustments: any[] = row.adjustments || [];
        const lastAdj = adjustments.length > 0 ? adjustments[adjustments.length - 1] : null;
        const targetPrice = lastAdj?.new_target ? Number(lastAdj.new_target) : (row.target_price || 0);
        const stopLoss = lastAdj?.new_stop ? Number(lastAdj.new_stop) : (row.stop_loss || 0);
        const isBuy = (row.signal || "").toUpperCase() === "BUY";
        
        const formatDateLocal = (ts: string) => new Date(ts).toLocaleDateString(isAr ? "ar-EG" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const scanDate = formatDateLocal(row.updated_at || row.created_at || new Date().toISOString());

        const scoreBgColor = (v: number) => {
            return v >= 7 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : v >= 5 ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30";
        };

        const signalUpper = (row.signal || "").toUpperCase();
        const signalEmoji = signalUpper === "BUY" ? "🟢" : signalUpper === "SELL" ? "🔴" : "exit";
        const baseSym = row.symbol.split('.')[0].toLowerCase();
        
        const isClosed = row.status?.toLowerCase() === "win" || row.status?.toLowerCase() === "loss";
        const pctChangeSinceRec = isClosed
            ? (row.exit_price && entryPrice > 0 ? ((row.exit_price - entryPrice) / entryPrice) * 100 : (plPct ?? 0))
            : (entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0);

        const shareText = isAr 
            ? `🚨 توصية صفقة بالذكاء الاصطناعي - EGX BOTS 🚨\n\n` +
              `السهم: ${row.symbol} (${row.exchange})\n` +
              `الإشارة: ${signalUpper === "BUY" ? "شراء" : signalUpper === "SELL" ? "بيع" : "خروج"} ${signalEmoji}\n` +
              `سعر الدخول المقترح: ${entryPrice.toFixed(2)} ج.م\n` +
              `الهدف: ${targetPrice.toFixed(2)} ج.م\n` +
              `وقف الخسارة: ${stopLoss.toFixed(2)} ج.م\n` +
              `تقييم الذكاء الاصطناعي: ${aiScoreNum}/10\n` +
              `القطاع: ${row.sector || "N/A"}\n` +
              `أداء الصفقة: ${pctChangeSinceRec >= 0 ? "+" : ""}${pctChangeSinceRec.toFixed(2)}%\n` +
              `التاريخ: ${scanDate}\n\n` +
              `👉 التفاصيل والتحليل: https://egxbots.com/scanner/backtests?tab=bots`
            : `🚨 EGX BOTS AI Trade Signal 🚨\n\n` +
              `Stock: ${row.symbol} (${row.exchange})\n` +
              `Signal: ${signalUpper} ${signalEmoji}\n` +
              `Entry Price: ${entryPrice.toFixed(2)} EGP\n` +
              `Target Price: ${targetPrice.toFixed(2)} EGP\n` +
              `Stop Loss: ${stopLoss.toFixed(2)} EGP\n` +
              `AI Score: ${aiScoreNum}/10\n` +
              `Sector: ${row.sector || "N/A"}\n` +
              `Trade Return: ${pctChangeSinceRec >= 0 ? "+" : ""}${pctChangeSinceRec.toFixed(2)}%\n` +
              `Date: ${scanDate}\n\n` +
              `👉 Analyze here: https://egxbots.com/scanner/backtests?tab=bots`;

        const handleShare = (platform: "x" | "telegram" | "whatsapp" | "facebook") => {
            let url = "";
            const pageUrl = `https://egxbots.com/scanner/backtests?tab=bots`;
            switch (platform) {
                case "x":
                    url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
                    break;
                case "telegram":
                    url = `https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(shareText)}`;
                    break;
                case "whatsapp":
                    url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
                    break;
                case "facebook":
                    url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`;
                    break;
            }
            window.open(url, "_blank", "width=600,height=400");
        };

        const handleDownloadImage = async () => {
            if (!shareCardRef.current || isDownloading) return;
            setIsDownloading(true);
            try {
                const dataUrl = await toPng(shareCardRef.current, {
                    cacheBust: true,
                    backgroundColor: theme === "dark" ? "#09090b" : "#ffffff",
                    style: {
                        transform: "scale(1)",
                    },
                });
                const link = document.createElement("a");
                link.download = `${shareRow.symbol}_egxbots_signal.png`;
                link.href = dataUrl;
                link.click();
            } catch (err) {
                console.error("Error generating image:", err);
            } finally {
                setIsDownloading(false);
            }
        };

        const handleCopyText = () => {
            navigator.clipboard.writeText(shareText);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        };

        return createPortal(
            <div 
                className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 bg-zinc-950/70 dark:bg-zinc-950/90 bg-zinc-200/60 backdrop-blur-md overflow-y-auto text-zinc-900 dark:text-white"
                onClick={() => setShareRow(null)}
                dir={isAr ? "rtl" : "ltr"}
            >
                <div 
                    className="relative w-full max-w-md bg-white dark:bg-zinc-900 border-4 border-black dark:border-white p-6 shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] flex flex-col gap-6 animate-in zoom-in-95 duration-150 text-zinc-900 dark:text-white"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b-2 border-black dark:border-zinc-800 pb-4">
                        <h3 className="text-lg font-black uppercase text-zinc-900 dark:text-white">
                            {translate("shareTrade")}
                        </h3>
                        <button
                            onClick={() => setShareRow(null)}
                            className="w-8 h-8 flex items-center justify-center border-2 border-black bg-rose-600 hover:bg-rose-500 text-white font-black transition-colors"
                            aria-label="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Captured Card Wrapper */}
                    <div className="overflow-hidden border-2 border-black dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 p-1 flex justify-center">
                        <div 
                            ref={shareCardRef}
                            className="w-[380px] bg-white dark:bg-zinc-950 p-6 flex flex-col gap-5 border border-zinc-200 dark:border-zinc-800/80 relative select-none"
                        >
                            {/* Card Background Branding/Watermark */}
                            <div className="absolute top-2 right-4 flex items-center gap-1.5">
                                <img src="/favicon_io/apple-touch-icon.png" alt="EGX Bots Logo" className="w-4 h-4 object-contain" />
                                <span className="text-[9px] font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase">
                                    EGX BOTS AI
                                </span>
                            </div>

                            {/* Header Stock Info */}
                            <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800/80 pb-4 text-left">
                                <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="lg" className="rounded-sm" />
                                <div className="min-w-0 flex-1 text-left">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-black uppercase text-zinc-900 dark:text-white tracking-wide truncate">
                                            {row.symbol}
                                        </span>
                                        <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 uppercase">
                                            {row.exchange}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-zinc-400 font-medium truncate mt-0.5">
                                        {row.name}
                                    </p>
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-1">
                                    {isBuy ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500 text-zinc-950 font-black text-xs rounded-sm">
                                            <TrendingUp className="w-3.5 h-3.5" /> {translate("buy")}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-500 text-zinc-950 font-black text-xs rounded-sm">
                                            <TrendingDown className="w-3.5 h-3.5" /> {translate("sell")}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Main Details Grid */}
                            <div className="grid grid-cols-2 gap-4 text-left">
                                {/* Left stats list */}
                                <div className="space-y-3">
                                    <div>
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                            {translate("shareEntry")}
                                        </span>
                                        <span className="text-base font-black text-zinc-900 dark:text-white">
                                            {entryPrice.toFixed(2)} <span className="text-[10px] font-bold text-zinc-400">EGP</span>
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                            {translate("shareTarget")}
                                        </span>
                                        <span className="text-base font-black text-emerald-500 dark:text-emerald-400">
                                            {targetPrice.toFixed(2)} <span className="text-[10px] font-bold text-zinc-400">EGP</span>
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                            {translate("shareStop")}
                                        </span>
                                        <span className="text-base font-black text-rose-500 dark:text-rose-400">
                                            {stopLoss.toFixed(2)} <span className="text-[10px] font-bold text-zinc-400">EGP</span>
                                        </span>
                                    </div>
                                    {isClosed && row.exit_price != null && (
                                        <div>
                                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                                {translate("shareExit")}
                                            </span>
                                            <span className={`text-base font-black ${(row.status || '').toLowerCase() === 'win' ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                                {Number(row.exit_price).toFixed(2)} <span className="text-[10px] font-bold text-zinc-400">EGP</span>
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Right stats list & AI Score */}
                                <div className="space-y-3 flex flex-col justify-between items-end text-right">
                                    <div className="w-full flex flex-col items-end">
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                            {translate("shareScore")}
                                        </span>
                                        <div className={`mt-1 px-3 py-1 border text-xs font-black rounded-sm inline-flex items-center gap-1.5 ${scoreBgColor(aiScoreNum)}`}>
                                            <Cpu className="w-3.5 h-3.5" />
                                            <span>{aiScoreNum}/10</span>
                                        </div>
                                    </div>

                                    <div className="w-full flex flex-col items-end">
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                            {isAr ? "أداء الصفقة" : "Trade Return"}
                                        </span>
                                        <span className={`text-base font-black ${pctChangeSinceRec >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                                            {pctChangeSinceRec >= 0 ? "+" : ""}{pctChangeSinceRec.toFixed(2)}%
                                        </span>
                                    </div>

                                    {isClosed && row.exit_price != null && (
                                        <div className="w-full flex flex-col items-end">
                                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                                {translate("shareExit")}
                                            </span>
                                            <span className={`text-base font-black ${(row.status || '').toLowerCase() === 'win' ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                                {Number(row.exit_price).toFixed(2)} <span className="text-[10px] font-bold text-zinc-400">EGP</span>
                                            </span>
                                        </div>
                                    )}

                                    <div className="w-full flex flex-col items-end">
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                                            {translate("shareScanDate")}
                                        </span>
                                        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 mt-0.5">
                                            {scanDate}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Mini Candlestick SVG Chart */}
                            {loadingCandles ? (
                                <div className="h-[120px] w-full bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-500 text-xs font-bold gap-2 mt-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-teal-500 dark:text-teal-400" />
                                    <span>{isAr ? "جاري تحميل الشارت..." : "Loading chart..."}</span>
                                </div>
                            ) : shareCandles.length > 0 ? (() => {
                                const chartWidth = 332;
                                const chartHeight = 120;
                                const paddingX = 20;
                                const paddingY = 25;

                                const N = shareCandles.length;
                                const closes = shareCandles.map(c => c.close);
                                
                                let minPrice = Math.min(...closes) * 0.95;
                                let maxPrice = Math.max(...closes) * 1.05;
                                if (minPrice === maxPrice) {
                                    minPrice -= 1;
                                    maxPrice += 1;
                                }
                                
                                const getX = (i: number) => paddingX + i * ((chartWidth - 2 * paddingX) / (N - 1 || 1));
                                const getY = (price: number) => (chartHeight - paddingY) - ((price - minPrice) / (maxPrice - minPrice)) * (chartHeight - 2 * paddingY);
                                
                                const isClosed = row.status?.toLowerCase() === "win" || row.status?.toLowerCase() === "loss";
                                const lineColor = pctChangeSinceRec >= 0 ? "#10b981" : "#f43f5e";
                                const exitColor = (row.status || '').toLowerCase() === 'win' ? '#10b981' : '#f43f5e';
                                
                                const signalDateStr = new Date(row.created_at).toISOString().split('T')[0];
                                const exitDateStr = new Date(row.updated_at).toISOString().split('T')[0];
                                
                                const entryIdx = shareCandles.findIndex(c => c.date >= signalDateStr);
                                const exitIdx = isClosed ? shareCandles.findIndex(c => c.date >= exitDateStr) : -1;

                                // Build polyline points
                                const points = shareCandles.map((c, i) => `${getX(i)},${getY(c.close)}`).join(" ");
                                
                                // Build gradient area points
                                const areaPoints = [
                                    `${getX(0)},${chartHeight}`,
                                    ...shareCandles.map((c, i) => `${getX(i)},${getY(c.close)}`),
                                    `${getX(N - 1)},${chartHeight}`
                                ].join(" ");

                                return (
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block text-left">
                                            {isAr ? "أداء السعر" : "Price Action"}
                                        </span>
                                        <div className="relative h-[120px] w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 rounded-sm overflow-hidden p-1">
                                            <svg width={chartWidth} height={chartHeight} className="overflow-visible">
                                                <defs>
                                                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
                                                        <stop offset="100%" stopColor={lineColor} stopOpacity="0.0" />
                                                    </linearGradient>
                                                </defs>

                                                {/* Grid Lines */}
                                                <line x1={0} y1={chartHeight * 0.25} x2={chartWidth} y2={chartHeight * 0.25} stroke={theme === "dark" ? "#18181b" : "#e4e4e7"} strokeWidth={0.5} strokeDasharray="2 2" opacity={theme === "dark" ? 0.3 : 0.6} />
                                                <line x1={0} y1={chartHeight * 0.5} x2={chartWidth} y2={chartHeight * 0.5} stroke={theme === "dark" ? "#18181b" : "#e4e4e7"} strokeWidth={0.5} strokeDasharray="2 2" opacity={theme === "dark" ? 0.3 : 0.6} />
                                                <line x1={0} y1={chartHeight * 0.75} x2={chartWidth} y2={chartHeight * 0.75} stroke={theme === "dark" ? "#18181b" : "#e4e4e7"} strokeWidth={0.5} strokeDasharray="2 2" opacity={theme === "dark" ? 0.3 : 0.6} />
                                                
                                                {/* Area under the line */}
                                                <polygon
                                                    points={areaPoints}
                                                    fill="url(#chartGradient)"
                                                />

                                                {/* Line Chart */}
                                                <polyline
                                                    fill="none"
                                                    stroke={lineColor}
                                                    strokeWidth="2.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    points={points}
                                                />

                                                {/* Markers & Dots */}
                                                {shareCandles.map((c, i) => {
                                                    const x = getX(i);
                                                    const y = getY(c.close);
                                                    const isEntry = i === entryIdx;
                                                    const isExit = i === exitIdx;

                                                    return (
                                                        <g key={i}>
                                                            {/* Small dot on every point for cleaner look */}
                                                            <circle cx={x} cy={y} r="2" fill={lineColor} opacity="0.5" />

                                                            {/* Entry Point */}
                                                            {isEntry && (
                                                                <g>
                                                                    <circle cx={x} cy={y} r="5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
                                                                    <polygon 
                                                                        points={`${x},${y + 8} ${x - 3},${y + 13} ${x + 3},${y + 13}`} 
                                                                        fill="#10b981" 
                                                                    />
                                                                    <text 
                                                                        x={x} 
                                                                        y={y + 21} 
                                                                        fill="#10b981" 
                                                                        fontSize="7" 
                                                                        fontWeight="black" 
                                                                        textAnchor="middle"
                                                                    >
                                                                        {isAr ? "دخول" : "Buy"}
                                                                    </text>
                                                                </g>
                                                            )}

                                                            {/* Exit Point */}
                                                            {isExit && (
                                                                <g>
                                                                    <circle cx={x} cy={y} r="5" fill={exitColor} stroke="#ffffff" strokeWidth="1.5" />
                                                                    <polygon 
                                                                        points={`${x},${y - 8} ${x - 3},${y - 13} ${x + 3},${y - 13}`} 
                                                                        fill={exitColor} 
                                                                    />
                                                                    <text 
                                                                        x={x} 
                                                                        y={y - 17} 
                                                                        fill={exitColor} 
                                                                        fontSize="7" 
                                                                        fontWeight="black" 
                                                                        textAnchor="middle"
                                                                    >
                                                                        {isAr ? "خروج" : "Exit"}
                                                                    </text>
                                                                </g>
                                                            )}
                                                        </g>
                                                    );
                                                })}
                                            </svg>
                                        </div>
                                    </div>
                                );
                            })() : null}

                            {/* Bottom Disclaimer and Website Link */}
                            <div className="mt-2 pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-4">
                                <p className="text-[8px] text-zinc-500 font-bold leading-normal max-w-[200px] text-left">
                                    {translate("shareDisclaimer")}
                                </p>
                                <span className="text-[10px] font-black text-indigo-600 dark:text-teal-400 tracking-wider">
                                    egxbots.com
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Sharing / Actions Bar */}
                    <div className="flex flex-col gap-4">
                        {/* Primary Image & Copy Buttons */}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={handleDownloadImage}
                                disabled={isDownloading}
                                className="h-10 px-4 border-2 border-black bg-teal-400 hover:bg-teal-300 text-zinc-950 text-xs font-black flex items-center justify-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all disabled:opacity-50"
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>{translate("shareDownloading")}</span>
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        <span>{translate("shareDownload")}</span>
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleCopyText}
                                className="h-10 px-4 border-2 border-black bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-white text-xs font-black flex items-center justify-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                            >
                                {isCopied ? (
                                    <>
                                        <Check className="w-4 h-4 text-emerald-500" />
                                        <span>{translate("shareCopied")}</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        <span>{translate("shareCopy")}</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Social Media Share Buttons */}
                        <div className="grid grid-cols-4 gap-2">
                            <button
                                onClick={() => handleShare("x")}
                                className="h-9 border-2 border-black bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-150"
                            >
                                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                                <span className="hidden sm:inline">X</span>
                            </button>

                            <button
                                onClick={() => handleShare("telegram")}
                                className="h-9 border-2 border-black bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-150"
                            >
                                <Send className="w-3.5 h-3.5 text-sky-500" />
                                <span className="hidden sm:inline">Telegram</span>
                            </button>

                            <button
                                onClick={() => handleShare("whatsapp")}
                                className="h-9 border-2 border-black bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-150"
                            >
                                <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="hidden sm:inline">WhatsApp</span>
                            </button>

                            <button
                                onClick={() => handleShare("facebook")}
                                className="h-9 border-2 border-black bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-150"
                            >
                                <svg className="w-3.5 h-3.5 fill-current text-blue-600" viewBox="0 0 24 24">
                                    <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
                                </svg>
                                <span className="hidden sm:inline">Facebook</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    // ─── Main Table ────────────────────────────────────────────────────────────
    return (
        <div
            onClick={handleLandingClick}
            className={`w-full max-w-none mx-auto flex flex-col space-y-6 ${isLandingPage && !user ? "cursor-pointer" : ""}`}
        >
            {/* Dialog */}
            {renderDialog()}

            {/* Share Dialog */}
            {renderShareDialog()}

            {/* Header Content Info Box */}
            <SpotlightCard 
                radius={450}
                className="flex flex-col gap-3 p-8 border-4 border-black dark:border-white bg-zinc-950 text-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] hover:shadow-[6px_6px_0px_rgba(245,158,11,1)] transition-all duration-300"
            >
                <div className="flex flex-col gap-3 w-full z-10">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.25)] flex-shrink-0">
                                <Layers className="w-6 h-6 text-amber-500" />
                            </div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">{translate("title")}</h2>
                        </div>
                        {limit === Infinity && (
                            <button
                                onClick={() => loadRecommendations(isLandingPage)}
                                disabled={recsLoading}
                                className="h-10 px-4 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-black dark:text-white font-bold uppercase text-xs flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${recsLoading ? "animate-spin" : ""}`} />
                                {isAr ? "تحديث" : "Refresh"}
                            </button>
                        )}
                    </div>
                    <p className="text-xs font-bold leading-relaxed text-zinc-400 max-w-3xl">{translate("subtitle")}</p>

                    {!isLandingPage && !hideTelegramToggle && (
                        <TelegramServiceToggle
                            serviceType="stock_score"
                            botId="stock_score"
                            className="mt-4"
                        />
                    )}
                </div>
            </SpotlightCard>

            {/* Outdated Warning Panel */}
            {isOutdated && (
                <div className="p-4 border-4 border-black dark:border-white neobrutal-bg-pink text-black dark:text-black font-bold flex items-center justify-between text-xs shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
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

            {/* Performance Summary Cards */}
            {limit === Infinity && (!isLandingPage || user) && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                    {/* Active Trades */}
                    <SpotlightCard className="p-3 sm:p-4 border-2 sm:border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] dark:sm:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:shadow-[4px_4px_0px_rgba(245,158,11,1)] transition-all duration-300">
                        <div className="relative z-10 flex items-center gap-2.5 sm:gap-3 w-full min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-none bg-amber-500/10 dark:bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center flex-shrink-0">
                                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider leading-none mb-1.5 truncate">
                                    {isAr ? "التوصيات النشطة" : "Active Trades"}
                                </p>
                                <p className="text-lg sm:text-2xl font-black font-mono leading-none">{stats.activeCount}</p>
                            </div>
                        </div>
                    </SpotlightCard>

                    {/* Closed Trades */}
                    <SpotlightCard className="p-3 sm:p-4 border-2 sm:border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] dark:sm:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:shadow-[4px_4px_0px_rgba(245,158,11,1)] transition-all duration-300">
                        <div className="relative z-10 flex items-center gap-2.5 sm:gap-3 w-full min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-none bg-amber-500/10 dark:bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center flex-shrink-0">
                                <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider leading-none mb-1.5 truncate">
                                    {isAr ? "الصفقات المغلقة" : "Closed Trades"}
                                </p>
                                <p className="text-lg sm:text-2xl font-black font-mono leading-none">{stats.closedCount}</p>
                            </div>
                        </div>
                    </SpotlightCard>

                    {/* Win Rate */}
                    <SpotlightCard className="p-3 sm:p-4 border-2 sm:border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] dark:sm:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:shadow-[4px_4px_0px_rgba(245,158,11,1)] transition-all duration-300">
                        <div className="relative z-10 flex items-center gap-2.5 sm:gap-3 w-full min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-none bg-amber-500/10 dark:bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center flex-shrink-0">
                                <Target className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider leading-none mb-1.5 truncate">
                                    {isAr ? "نسبة النجاح" : "Win Rate"}
                                </p>
                                <p className="text-lg sm:text-2xl font-black font-mono text-emerald-500 leading-none truncate" dir="ltr">
                                    {stats.winRate.toFixed(1)}%
                                </p>
                            </div>
                        </div>
                    </SpotlightCard>

                    {/* Average Return */}
                    <SpotlightCard className="p-3 sm:p-4 border-2 sm:border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] dark:sm:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:shadow-[4px_4px_0px_rgba(245,158,11,1)] transition-all duration-300">
                        <div className="relative z-10 flex items-center gap-2.5 sm:gap-3 w-full min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-none bg-amber-500/10 dark:bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center flex-shrink-0">
                                <Award className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider leading-none mb-1.5 truncate">
                                    {isAr ? "متوسط العائد" : "Avg Return"}
                                </p>
                                <p className={`text-lg sm:text-2xl font-black font-mono leading-none truncate ${stats.avgReturn >= 0 ? "text-emerald-500" : "text-rose-500"}`} dir="ltr">
                                    {stats.avgReturn >= 0 ? "+" : ""}{stats.avgReturn.toFixed(1)}%
                                </p>
                            </div>
                        </div>
                    </SpotlightCard>
                </div>
            )}

            {/* Tabs Navigation Bar */}
            {limit === Infinity && (!isLandingPage || user) && (
                <div className="flex flex-col sm:flex-row border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] p-1.5 gap-2 select-none">
                    {[
                        { id: "active", label: isAr ? "الصفقات النشطة (المفتوحة)" : "Active Trades (Open)", count: tabCounts.activeCount },
                        { id: "closed", label: isAr ? "أرشيف العمليات (المغلقة)" : "Closed Archive", count: tabCounts.closedCount },
                        { id: "calendar", label: isAr ? "📅 تقويم أرباح التوصيات" : "📅 Profit Calendar", count: tabCounts.totalCount },
                        { id: "all", label: isAr ? "جميع الصفقات" : "All Trades", count: tabCounts.totalCount }
                    ].map(tab => {
                        const isSelected = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id as any);
                                    setCurrentPage(1);
                                }}
                                className={`flex-1 py-2.5 sm:py-3 px-3 sm:px-4 font-black text-xs sm:text-sm flex items-center justify-between sm:justify-center gap-2 transition-all duration-100 active:scale-98 border-2 ${
                                    isSelected
                                        ? "bg-black dark:bg-white border-black dark:border-white shadow-[2px_2px_0px_rgba(0,0,0,0.2)]"
                                        : "bg-white dark:bg-zinc-950 text-black dark:text-white border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                }`}
                                style={{
                                    color: isSelected ? (theme === "dark" ? "#000000" : "#ffffff") : undefined
                                }}
                            >
                                <span 
                                    className="font-black"
                                    style={{
                                        color: isSelected ? (theme === "dark" ? "#000000" : "#ffffff") : undefined
                                    }}
                                >
                                    {tab.label}
                                </span>
                                <span className={`px-2 py-0.5 text-xs font-bold font-mono ${
                                    isSelected
                                        ? "bg-zinc-800 dark:bg-zinc-200 text-zinc-100 dark:text-zinc-900"
                                        : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800"
                                }`}>
                                    {tab.count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Calendar View Tab */}
            {activeTab === "calendar" ? (
                <RecommendationCalendar
                    recommendations={recommendations}
                    loading={recsLoading}
                    onSelectStock={handleStockClick}
                />
            ) : (
                <>
            {/* Interactive Filters */}
            {limit === Infinity && (!isLandingPage || user) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 p-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                    <div className="relative flex items-center">
                        <Search className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <input
                            type="text"
                            placeholder={translate("searchPlaceholder")}
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-4 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 text-black dark:text-white font-bold text-sm focus:outline-none focus:ring-0"
                        />
                    </div>
                    <div className="relative flex items-center">
                        <Filter className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <select
                            value={selectedSector}
                            onChange={(e) => { setSelectedSector(e.target.value); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-8 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 text-black dark:text-white font-bold text-sm appearance-none focus:outline-none focus:ring-0"
                        >
                            <option value="">{translate("allSectors")}</option>
                            {sectors.map(sec => (
                                <option key={sec} value={sec}>{sec}</option>
                            ))}
                        </select>
                    </div>
                    <div className="relative flex items-center">
                        <Filter className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <select
                            value={selectedSignal}
                            onChange={(e) => { setSelectedSignal(e.target.value); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-8 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 text-black dark:text-white font-bold text-sm appearance-none focus:outline-none focus:ring-0"
                        >
                            <option value="">{translate("allSignals")}</option>
                            <option value="BUY">{translate("buy")}</option>
                            <option value="SELL">{translate("sell")}</option>
                        </select>
                    </div>
                    <div className="relative flex items-center">
                        <Calendar className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <select
                            value={timeRange}
                            onChange={(e) => { setTimeRange(e.target.value as any); setCurrentPage(1); }}
                            className="w-full h-11 pl-10 pr-8 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 text-black dark:text-white font-bold text-sm appearance-none focus:outline-none focus:ring-0"
                        >
                            <option value="all">{isAr ? "كل الأوقات" : "All Time"}</option>
                            <option value="7d">{isAr ? "آخر 7 أيام" : "Last 7 Days"}</option>
                            <option value="30d">{isAr ? "آخر 30 يوم" : "Last 30 Days"}</option>
                        </select>
                    </div>
                    <div className="relative flex items-center">
                        <Filter className="absolute left-3 w-4 h-4 text-zinc-500" />
                        <select
                            value={`${sortBy}:${sortOrder}`}
                            onChange={(e) => {
                                const [by, order] = e.target.value.split(":");
                                setSortBy(by);
                                setSortOrder(order as "asc" | "desc");
                                setCurrentPage(1);
                            }}
                            className="w-full h-11 pl-10 pr-8 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 text-black dark:text-white font-bold text-sm appearance-none focus:outline-none focus:ring-0"
                        >
                            <option value="precision:desc">{isAr ? "ترتيب: تقييم الذكاء (الأعلى)" : "Sort: AI Score (Highest)"}</option>
                            <option value="profit_loss_pct:desc">{isAr ? "ترتيب: العائد (الأعلى)" : "Sort: Return (Highest)"}</option>
                            <option value="profit_loss_pct:asc">{isAr ? "ترتيب: العائد (الأقل)" : "Sort: Return (Lowest)"}</option>
                            <option value="created_at:desc">{isAr ? "ترتيب: التاريخ (الأحدث)" : "Sort: Date (Newest)"}</option>
                            <option value="symbol:asc">{isAr ? "ترتيب: اسم السهم (أبجدي)" : "Sort: Symbol (A-Z)"}</option>
                        </select>
                    </div>
                    <button
                        onClick={() => { setShariaOnly(prev => !prev); setCurrentPage(1); }}
                        title={translate("shariaHint")}
                        className={`h-11 px-4 border-2 border-black dark:border-white font-black text-sm flex items-center justify-center gap-2 transition-all duration-100 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${
                            shariaOnly
                                ? "neobrutal-bg-green text-black"
                                : "bg-zinc-50 dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                        aria-pressed={shariaOnly}
                    >
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span className="truncate">{translate("shariaOnly")}</span>
                    </button>
                </div>
            )}

            {/* Table wrapper */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] overflow-hidden">
                {recsLoading ? (
                    <div className="p-6 space-y-3">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 p-3 animate-pulse">
                                <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
                                    <div className="h-3 w-40 bg-zinc-100 dark:bg-zinc-800/50 rounded" />
                                </div>
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div className="h-6 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
                                <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
                            </div>
                        ))}
                    </div>
                ) : displayRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-4 text-zinc-400">
                        <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                            <Search className="w-8 h-8 text-zinc-400" />
                        </div>
                        <p className="text-sm font-black uppercase tracking-widest">{translate("noResults")}</p>
                        {(searchTerm || selectedSector || selectedSignal || activeTab !== "active" || timeRange !== "all" || shariaOnly || sortBy !== "precision" || sortOrder !== "desc") && (
                            <button
                                onClick={() => {
                                    setSearchTerm("");
                                    setSelectedSector("");
                                    setSelectedSignal("");
                                    setActiveTab("active");
                                    setTimeRange("all");
                                    setShariaOnly(false);
                                    setSortBy("precision");
                                    setSortOrder("desc");
                                }}
                                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                            >
                                {isAr ? "مسح الفلاتر" : "Clear Filters"}
                            </button>
                        )}
                    </div>
                ) : isLandingPage ? (
                    renderLandingCards()
                ) : (
                    <>
                        {/* Mobile Cards View (Dashboard) */}
                        <div className="md:hidden flex flex-col divide-y-4 divide-black dark:divide-white">
                            {displayRows.map((row, index) => {
                                const rankNum = limit !== Infinity ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1;
                                const aiScoreNum = Number((row.precision * 10).toFixed(0));
                                const cInfo = getCountryFlag(row.country, row.exchange);
                                const statusLower = row.status?.toLowerCase() || "open";
                                let rowBgClass = "";
                                if (statusLower === "win") {
                                    rowBgClass = "bg-emerald-500/5 dark:bg-emerald-500/10 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20";
                                } else if (statusLower === "loss") {
                                    rowBgClass = "bg-rose-500/5 dark:bg-rose-500/10 hover:bg-rose-500/10 dark:hover:bg-rose-500/20";
                                } else {
                                    rowBgClass = "hover:bg-zinc-50 dark:hover:bg-zinc-900";
                                }
                                
                                return (
                                    <div
                                        key={row.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleStockClick(row);
                                        }}
                                        className={`group cursor-pointer transition-all duration-150 ${rowBgClass} p-4 space-y-4`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 border-2 border-black dark:border-white neobrutal-bg-yellow flex items-center justify-center font-black font-mono text-sm text-black">
                                                    {rankNum}
                                                </div>
                                                <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="md" />
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-base font-black text-indigo-600 dark:text-indigo-400">{row.symbol}</span>
                                                        {isShariaCompliant(row.symbol) && (
                                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-black dark:border-white bg-emerald-400 text-black text-[8px] font-black uppercase tracking-wider shadow-[1px_1px_0px_rgba(0,0,0,1)] dark:shadow-[1px_1px_0px_rgba(255,255,255,1)]">
                                                                <ShieldCheck className="w-2.5 h-2.5" />
                                                                {translate("halal")}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[140px]" title={row.name}>
                                                        {row.name}
                                                    </span>
                                                </div>
                                            </div>
                                            {renderCircularScore(aiScoreNum, "AI")}
                                        </div>
                                        <div className="flex items-center justify-between flex-wrap gap-3">
                                            <div className="flex items-center gap-2">
                                                {renderSignalBadge(row)}
                                                {getStatusBadge(row.status || "open", row.profit_loss_pct)}
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs font-black text-zinc-500 uppercase">
                                                <span className="text-lg leading-none">{cInfo.flag}</span>
                                                <span className="truncate max-w-[110px]">{row.sector || "N/A"}</span>
                                            </div>
                                        </div>
                                        {user && (
                                            <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800">
                                                {renderCircularScore(row.technical_score || 5, "Tech")}
                                                {renderCircularScore(row.fundamental_score || 5, "Fund")}
                                                {renderCircularScore(row.sentiment_score || 5, "Sent")}
                                                {renderCircularScore(getLowRiskScore(row), "Risk")}
                                            </div>
                                        )}
                                        <div className="flex justify-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShareRow(row);
                                                }}
                                                className="inline-flex items-center justify-center h-8 px-3 gap-2 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-teal-400 hover:text-black dark:hover:text-black transition-all cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none text-[10px] font-black uppercase tracking-wider"
                                            >
                                                <Share2 className="w-3.5 h-3.5" />
                                                {translate("shareTrade")}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto w-full">
                            <table className="w-full min-w-[1150px] text-left border-collapse whitespace-nowrap lg:whitespace-normal">
                            <thead>
                                <tr className="text-xs font-black uppercase tracking-wider text-black dark:text-white select-none">
                                    <th 
                                        onClick={() => handleHeaderClick("precision")}
                                        className="bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-12 text-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {translate("rank")}
                                            {renderSortIcon("precision")}
                                        </div>
                                    </th>
                                    <th 
                                        onClick={() => handleHeaderClick("symbol")}
                                        className="bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-6 py-4 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none text-left"
                                    >
                                        <div className="flex items-center gap-1 justify-start">
                                            {translate("stockName")}
                                            {renderSortIcon("symbol")}
                                        </div>
                                    </th>
                                    <th className="hidden md:table-cell bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-6 py-4 w-24 text-center">
                                        {translate("country")}
                                    </th>
                                    <th 
                                        onClick={() => handleHeaderClick("precision")}
                                        className="bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-24 text-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {translate("aiScore")}
                                            {renderSortIcon("precision")}
                                        </div>
                                    </th>
                                    <th className="bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-24 text-center">
                                        {translate("signal")}
                                    </th>

                                    {user && (
                                        <>
                                            <th 
                                                onClick={() => handleHeaderClick("technical_score")}
                                                className="hidden md:table-cell bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-24 text-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {translate("techScore")}
                                                    {renderSortIcon("technical_score")}
                                                </div>
                                            </th>
                                            <th 
                                                onClick={() => handleHeaderClick("fundamental_score")}
                                                className="hidden md:table-cell bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-24 text-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {translate("fundScore")}
                                                    {renderSortIcon("fundamental_score")}
                                                </div>
                                            </th>
                                            <th 
                                                onClick={() => handleHeaderClick("sentiment_score")}
                                                className="hidden md:table-cell bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-24 text-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {translate("sentScore")}
                                                    {renderSortIcon("sentiment_score")}
                                                </div>
                                            </th>
                                        </>
                                    )}

                                    <th className="hidden md:table-cell bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-24 text-center">
                                        {translate("lowRisk")}
                                    </th>
                                    <th 
                                        onClick={() => handleHeaderClick("profit_loss_pct")}
                                        className="bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-28 text-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {isAr ? "الحالة" : "Status"}
                                            {renderSortIcon("profit_loss_pct")}
                                        </div>
                                    </th>
                                    <th className="bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-4 py-4 w-20 text-center select-none">
                                        {isAr ? "مشاركة" : "Share"}
                                    </th>
                                    <th className="hidden lg:table-cell bg-zinc-100 dark:bg-zinc-900 border-b-4 border-black dark:border-white px-6 py-4 text-left">
                                        {translate("sector")}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y-2 divide-black dark:divide-white">
                                {displayRows.map((row, index) => {
                                    const cInfo = getCountryFlag(row.country, row.exchange);
                                    const rankNum = limit !== Infinity ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1;
                                    const aiScoreNum = Number((row.precision * 10).toFixed(0));

                                    const statusLower = row.status?.toLowerCase() || "open";
                                    let rowBgClass = "";
                                    if (statusLower === "win") {
                                        rowBgClass = "bg-emerald-500/5 dark:bg-emerald-500/10 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20";
                                    } else if (statusLower === "loss") {
                                        rowBgClass = "bg-rose-500/5 dark:bg-rose-500/10 hover:bg-rose-500/10 dark:hover:bg-rose-500/20";
                                    } else {
                                        rowBgClass = "hover:bg-zinc-50 dark:hover:bg-zinc-900";
                                    }

                                    return (
                                        <tr
                                            key={row.id}
                                            className={`group hover:scale-[1.005] transition-all duration-150 text-sm cursor-pointer ${rowBgClass}`}
                                            onClick={(e) => {
                                                if (!isLandingPage || user) {
                                                    e.stopPropagation();
                                                    handleStockClick(row);
                                                }
                                            }}
                                        >
                                            {/* Rank */}
                                            <td className="px-4 py-4 text-center font-black font-mono text-zinc-500">
                                                {rankNum}
                                            </td>

                                            {/* Company / Symbol */}
                                            <td className="px-6 py-4 font-black">
                                                <div className="flex items-center gap-3">
                                                    <StockLogo symbol={row.symbol} logoUrl={row.logo_url} size="md" />
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-base text-indigo-600 dark:text-indigo-400 hover:underline">{row.symbol}</span>
                                                            {isShariaCompliant(row.symbol) && (
                                                                <span
                                                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-black dark:border-white bg-emerald-400 text-black text-[8px] font-black uppercase tracking-wider shadow-[1px_1px_0px_rgba(0,0,0,1)] dark:shadow-[1px_1px_0px_rgba(255,255,255,1)]"
                                                                    title={translate("shariaHint")}
                                                                >
                                                                    <ShieldCheck className="w-2.5 h-2.5" />
                                                                    {translate("halal")}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[120px] md:max-w-[220px]" title={row.name}>
                                                            {row.name}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Country */}
                                            <td className="hidden md:table-cell px-6 py-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5" title={cInfo.name}>
                                                    <span className="text-lg leading-none">{cInfo.flag}</span>
                                                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{row.exchange}</span>
                                                </div>
                                            </td>

                                            {/* AI Score */}
                                            <td className="px-4 py-4 text-center">
                                                {renderCircularScore(aiScoreNum, "AI")}
                                            </td>

                                            {/* Signal Type */}
                                            <td className="px-4 py-4 text-center">
                                                {row.status?.toLowerCase() === "win" || row.status?.toLowerCase() === "loss" ? (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black dark:border-white font-black text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                                                        <Minus className="w-3.5 h-3.5 shrink-0" />
                                                        {translate("exit")}
                                                    </span>
                                                ) : row.signal.toUpperCase() === "BUY" ? (
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

                                            {/* Technical, Fundamental, Sentiment (Registered only) */}
                                            {user && (
                                                <>
                                                    <td className="hidden md:table-cell px-4 py-4 text-center">
                                                        {renderCircularScore(row.technical_score || 5, "Tech")}
                                                    </td>
                                                    <td className="hidden md:table-cell px-4 py-4 text-center">
                                                        {renderCircularScore(row.fundamental_score || 5, "Fund")}
                                                    </td>
                                                    <td className="hidden md:table-cell px-4 py-4 text-center">
                                                        {renderCircularScore(row.sentiment_score || 5, "Sent")}
                                                    </td>
                                                </>
                                            )}

                                            {/* Low Risk */}
                                            <td className="hidden md:table-cell px-4 py-4 text-center">
                                                {renderCircularScore(getLowRiskScore(row), "Risk")}
                                            </td>

                                            {/* Status */}
                                            <td className="px-4 py-4 text-center">
                                                {getStatusBadge(row.status || "open", row.profit_loss_pct)}
                                            </td>

                                            {/* Share Action */}
                                            <td className="px-4 py-4 text-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShareRow(row);
                                                    }}
                                                    className="inline-flex items-center justify-center w-8 h-8 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-teal-400 hover:text-black dark:hover:text-black transition-all cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none duration-150"
                                                    title={translate("shareTrade")}
                                                 >
                                                     <Share2 className="w-4 h-4" />
                                                 </button>
                                             </td>

                                            {/* Sector */}
                                            <td className="hidden lg:table-cell px-6 py-4 text-xs font-black uppercase text-zinc-500">
                                                {row.sector || "N/A"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    </>
                )}
            </div>

            {/* Pagination */}
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
                            className="w-10 h-10 border-2 border-black dark:border-white flex items-center justify-center bg-white dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                        >
                            {isAr ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="w-10 h-10 border-2 border-black dark:border-white flex items-center justify-center bg-white dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                        >
                            {isAr ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            )}
            </>
            )}
        </div>
    );
}
