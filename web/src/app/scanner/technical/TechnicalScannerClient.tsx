"use client";

import { useState, useEffect, useMemo } from "react";
import { 
    Sliders, Search, Loader2, Globe, Database, TrendingUp, X, Filter, 
    Bookmark, BookmarkCheck, ArrowLeftRight, ChevronLeft, ChevronRight, 
    BarChart3, PieChart, Landmark, Coins, Scale, Percent, Minus, Plus, 
    Info, LayoutTemplate, Settings2, Bell, BellRing, Trash, Check, 
    AlertCircle, ChevronDown, ChevronUp, Star
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWatchlist } from "@/contexts/WatchlistContext";
import { useAppState } from "@/contexts/AppStateContext";
import { useTechnicalScanner } from "@/contexts/TechnicalScannerContext";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getTechnicalAlerts, createTechnicalAlert, deleteTechnicalAlert, toggleTechnicalAlert, type TechnicalAlert, type TechFilter } from "@/lib/api";
import type { TechResult } from "@/lib/api";
import StockLogo from "@/components/StockLogo";
import ScannerTemplates, { type ScannerTemplateId } from "@/components/ScannerTemplates";

const DEFAULT_PILLS = ["price", "rsi", "marketcap", "sector"];

export default function TechnicalScannerPage() {
    const { t, language } = useLanguage();
    const { user } = useAuth();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const { saveSymbol, removeSymbolBySymbol, isSaved } = useWatchlist();
    const { addSymbolToCompare } = useAppState();
    
    const {
        state: {
            country,
            results,
            scannedCount,
            searchTerm,
            rsiMin,
            rsiMax,
            aboveEma50,
            aboveEma200,
            adxMin,
            adxMax,
            atrMin,
            atrMax,
            stochKMin,
            stochKMax,
            rocMin,
            rocMax,
            aboveVwap20,
            volumeAboveSma20,
            goldenCross,
            selectedStock,
            currentTab,
            marketCapMin,
            marketCapMax,
            sector,
            industry,
            minPrice,
            useAiFilter,
            minAiPrecision,
        },
        setTechScanner,
        runTechScan,
        loading,
        error,
    } = useTechnicalScanner();

    // Client-side Sorting State
    const [sortBy, setSortBy] = useState<string>("");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    // Dynamic Filter Pills Visibility State
    const [visibleFilters, setVisibleFilters] = useState<string[]>(DEFAULT_PILLS);
    const [showAddFilterMenu, setShowAddFilterMenu] = useState(false);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 15;

    // Active filter popover state
    const [activeFilterPopover, setActiveFilterPopover] = useState<string | null>(null);

    // Alerts state
    const [alerts, setAlerts] = useState<TechnicalAlert[]>([]);
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [showManageAlertsDialog, setShowManageAlertsDialog] = useState(false);
    const [showCreateAlertDialog, setShowCreateAlertDialog] = useState(false);
    const [newAlertName, setNewAlertName] = useState("");
    const [telegramChatId, setTelegramChatId] = useState("");
    const [savingAlert, setSavingAlert] = useState(false);
    const [fetchingTelegramChatId, setFetchingTelegramChatId] = useState(false);

    // Synchronize visible filter pills based on active filter state from session state
    useEffect(() => {
        const activeList = [...DEFAULT_PILLS];
        if (aboveEma50 && !activeList.includes("ema50")) activeList.push("ema50");
        if (aboveEma200 && !activeList.includes("ema200")) activeList.push("ema200");
        if (goldenCross && !activeList.includes("golden")) activeList.push("golden");
        if (volumeAboveSma20 && !activeList.includes("volume20")) activeList.push("volume20");
        if (aboveVwap20 && !activeList.includes("vwap20")) activeList.push("vwap20");
        if (useAiFilter && !activeList.includes("ai")) activeList.push("ai");
        if (industry && !activeList.includes("industry")) activeList.push("industry");
        if ((adxMin || adxMax) && !activeList.includes("adx")) activeList.push("adx");
        if ((atrMin || atrMax) && !activeList.includes("atr")) activeList.push("atr");
        if ((rocMin || rocMax) && !activeList.includes("roc")) activeList.push("roc");

        setVisibleFilters(prev => {
            const merged = new Set([...prev, ...activeList]);
            return Array.from(merged);
        });
    }, [aboveEma50, aboveEma200, goldenCross, volumeAboveSma20, aboveVwap20, useAiFilter, industry, adxMin, adxMax, atrMin, atrMax, rocMin, rocMax]);

    // Sorting & Filtering memo
    const filteredResults = useMemo(() => {
        let res = [...results];
        if (searchTerm) {
            const low = searchTerm.toLowerCase();
            res = res.filter(r => r.symbol.toLowerCase().includes(low) || r.name.toLowerCase().includes(low));
        }

        if (sortBy) {
            res.sort((a, b) => {
                let valA = a[sortBy as keyof typeof a];
                let valB = b[sortBy as keyof typeof b];

                if (valA === undefined || valA === null) valA = 0;
                if (valB === undefined || valB === null) valB = 0;

                if (typeof valA === "string") {
                    const strA = valA as string;
                    const strB = valB as string;
                    return sortOrder === "asc" 
                        ? strA.localeCompare(strB)
                        : strB.localeCompare(strA);
                } else {
                    const numA = valA as number;
                    const numB = valB as number;
                    return sortOrder === "asc"
                        ? numA - numB
                        : numB - numA;
                }
            });
        }

        return res;
    }, [searchTerm, results, sortBy, sortOrder]);

    // Reset page on search or new results
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, results.length]);

    const totalPages = Math.ceil(filteredResults.length / pageSize);
    const pagedResults = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredResults.slice(start, start + pageSize);
    }, [filteredResults, currentPage]);

    const TABS = [
        { id: 'overview', label: 'Overview', icon: LayoutTemplate },
        { id: 'performance', label: 'Performance', icon: BarChart3 },
        { id: 'valuation', label: 'Valuation', icon: PieChart },
        { id: 'dividends', label: 'Dividends', icon: Coins },
        { id: 'financials', label: 'Financials', icon: Scale },
    ] as const;

    // Apply filters and re-run scan
    const applyFilter = () => {
        setActiveFilterPopover(null);
        void runTechScan({ force: true });
    };

    // Helper to clean filter display and visibility
    const removeFilterIfNonDefault = (id: string) => {
        if (!DEFAULT_PILLS.includes(id)) {
            setVisibleFilters(prev => prev.filter(f => f !== id));
        }
    };

    // Reset all scanner filters
    const handleResetFilters = () => {
        setTechScanner({
            rsiMin: "",
            rsiMax: "",
            minPrice: "",
            aboveEma50: false,
            aboveEma200: false,
            adxMin: "",
            adxMax: "",
            atrMin: "",
            atrMax: "",
            stochKMin: "",
            stochKMax: "",
            rocMin: "",
            rocMax: "",
            aboveVwap20: false,
            volumeAboveSma20: false,
            goldenCross: false,
            marketCapMin: "",
            marketCapMax: "",
            sector: "",
            industry: "",
            useAiFilter: false,
            minAiPrecision: "0.6",
        });
        setVisibleFilters(DEFAULT_PILLS);
        setActiveFilterPopover(null);
        setTimeout(() => void runTechScan({ force: true }), 0);
    };

    // Fetch alerts for user
    const fetchAlerts = async () => {
        if (!user) return;
        setAlertsLoading(true);
        try {
            const data = await getTechnicalAlerts(user.id);
            setAlerts(data);
        } catch (err) {
            console.error("Failed to load alerts:", err);
        } finally {
            setAlertsLoading(false);
        }
    };

    // Fetch telegram chat ID from user profile
    const fetchTelegramChatId = async () => {
        if (!user) return;
        setFetchingTelegramChatId(true);
        try {
            const { data } = await supabase.from("profiles").select("telegram_chat_id").eq("id", user.id).maybeSingle();
            setTelegramChatId(data?.telegram_chat_id || "");
        } catch (err) {
            console.error("Failed to fetch telegram chat id:", err);
        } finally {
            setFetchingTelegramChatId(false);
        }
    };

    // Save alert config
    const handleCreateAlert = async () => {
        if (!user || !newAlertName.trim()) return;
        setSavingAlert(true);
        try {
            const currentFilters: TechFilter = {
                country,
                rsi_min: rsiMin ? parseFloat(rsiMin) : undefined,
                rsi_max: rsiMax ? parseFloat(rsiMax) : undefined,
                min_price: minPrice ? parseFloat(minPrice) : undefined,
                above_ema50: aboveEma50,
                above_ema200: aboveEma200,
                adx_min: adxMin ? parseFloat(adxMin) : undefined,
                adx_max: adxMax ? parseFloat(adxMax) : undefined,
                atr_min: atrMin ? parseFloat(atrMin) : undefined,
                atr_max: atrMax ? parseFloat(atrMax) : undefined,
                stoch_k_min: stochKMin ? parseFloat(stochKMin) : undefined,
                stoch_k_max: stochKMax ? parseFloat(stochKMax) : undefined,
                roc_min: rocMin ? parseFloat(rocMin) : undefined,
                roc_max: rocMax ? parseFloat(rocMax) : undefined,
                above_vwap20: aboveVwap20,
                volume_above_sma20: volumeAboveSma20,
                market_cap_min: marketCapMin ? parseFloat(marketCapMin) : undefined,
                market_cap_max: marketCapMax ? parseFloat(marketCapMax) : undefined,
                sector: sector || undefined,
                industry: industry || undefined,
                golden_cross: goldenCross,
                use_ai_filter: useAiFilter,
                min_ai_precision: minAiPrecision ? parseFloat(minAiPrecision) : undefined,
            };
            await createTechnicalAlert({
                user_id: user.id,
                name: newAlertName.trim(),
                filters: currentFilters
            });
            setNewAlertName("");
            setShowCreateAlertDialog(false);
            await fetchAlerts();
        } catch (err) {
            console.error("Failed to create alert:", err);
        } finally {
            setSavingAlert(false);
        }
    };

    const handleDeleteAlert = async (id: string) => {
        try {
            await deleteTechnicalAlert(id);
            await fetchAlerts();
        } catch (err) {
            console.error("Failed to delete alert:", err);
        }
    };

    const handleToggleAlert = async (id: string, active: boolean) => {
        try {
            await toggleTechnicalAlert(id, active);
            await fetchAlerts();
        } catch (err) {
            console.error("Failed to toggle alert:", err);
        }
    };

    function applyTemplate(id: ScannerTemplateId) {
        const baseUpdate = {
            searchTerm: "",
            rsiMin: "",
            rsiMax: "",
            minPrice: "",
            aboveEma50: false,
            aboveEma200: false,
            adxMin: "",
            adxMax: "",
            atrMin: "",
            atrMax: "",
            stochKMin: "",
            stochKMax: "",
            rocMin: "",
            rocMax: "",
            aboveVwap20: false,
            volumeAboveSma20: false,
            goldenCross: false,
            marketCapMin: "",
            marketCapMax: "",
            sector: "",
            industry: "",
            useAiFilter: false,
            minAiPrecision: "0.6",
        };

        const presets: Record<ScannerTemplateId, Partial<typeof baseUpdate>> = {
            macd_cross: { goldenCross: true, aboveEma50: true },
            rsi_oversold: { rsiMax: "30" },
            volume_breakout: { volumeAboveSma20: true },
            sma_200_breakout: { aboveEma200: true },
        };

        setTechScanner({ ...baseUpdate, ...presets[id] });
        setTimeout(() => void runTechScan({ force: true }), 0);
    }

    const formatNum = (val: number | undefined | null, decimals = 2) => {
        if (val === undefined || val === null || isNaN(val)) return "N/A";
        return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    const formatCompact = (val: number | undefined | null) => {
        if (val === undefined || val === null || isNaN(val)) return "-";
        if (val >= 1e12) return (val / 1e12).toFixed(2) + "T";
        if (val >= 1e9) return (val / 1e9).toFixed(2) + "B";
        if (val >= 1e6) return (val / 1e6).toFixed(2) + "M";
        return val.toLocaleString();
    };

    // Client-side Sorting Trigger
    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(prev => prev === "asc" ? "desc" : "asc");
        } else {
            setSortBy(field);
            setSortOrder("desc");
        }
    };

    // TradingView Custom Header Cell with Sort Indicators
    function SortableHeader({ label, field, align = "right", widthClass }: { label: string; field: string; align?: "left" | "right" | "center"; widthClass: string }) {
        const isCurrent = sortBy === field;
        return (
            <th 
                onClick={() => handleSort(field)}
                className={`
                    ${widthClass} px-6 py-3 cursor-pointer select-none hover:bg-[#1e222d] transition-colors border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86] group
                    ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}
                `}
            >
                <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
                    <span>{label}</span>
                    {isCurrent ? (
                        sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-[#2962ff]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#2962ff]" />
                    ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[#787b86]/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                </div>
            </th>
        );
    }

    // Dynamic Filter Pill Configuration
    const getFilterConfig = (id: string) => {
        switch (id) {
            case "price":
                return {
                    label: "Price",
                    valueDisplay: minPrice ? `>= ${minPrice} EGP` : "Any",
                    isActive: !!minPrice,
                    onReset: () => {
                        setTechScanner({ minPrice: "" });
                        removeFilterIfNonDefault("price");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">Minimum Stock Price</h4>
                            <input
                                type="number"
                                placeholder="Min Price (EGP)"
                                value={minPrice}
                                onChange={(e) => setTechScanner({ minPrice: e.target.value })}
                                className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                            />
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ minPrice: "" });
                                        removeFilterIfNonDefault("price");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "rsi":
                return {
                    label: "RSI (14)",
                    valueDisplay: rsiMin || rsiMax ? `${rsiMin || 0}-${rsiMax || 100}` : "Any",
                    isActive: !!(rsiMin || rsiMax),
                    onReset: () => {
                        setTechScanner({ rsiMin: "", rsiMax: "" });
                        removeFilterIfNonDefault("rsi");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">RSI Range (14)</h4>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    placeholder="Min"
                                    value={rsiMin}
                                    onChange={(e) => setTechScanner({ rsiMin: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max"
                                    value={rsiMax}
                                    onChange={(e) => setTechScanner({ rsiMax: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ rsiMin: "", rsiMax: "" });
                                        removeFilterIfNonDefault("rsi");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "marketcap":
                return {
                    label: "Mkt Cap",
                    valueDisplay: marketCapMin || marketCapMax ? `${marketCapMin ? formatCompact(Number(marketCapMin)) : '0'}-${marketCapMax ? formatCompact(Number(marketCapMax)) : '∞'}` : "Any",
                    isActive: !!(marketCapMin || marketCapMax),
                    onReset: () => {
                        setTechScanner({ marketCapMin: "", marketCapMax: "" });
                        removeFilterIfNonDefault("marketcap");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">Market Cap (EGP)</h4>
                            <div className="flex flex-col gap-2">
                                <input
                                    type="number"
                                    placeholder="Min Cap (e.g. 10000000)"
                                    value={marketCapMin}
                                    onChange={(e) => setTechScanner({ marketCapMin: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max Cap (e.g. 500000000)"
                                    value={marketCapMax}
                                    onChange={(e) => setTechScanner({ marketCapMax: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ marketCapMin: "", marketCapMax: "" });
                                        removeFilterIfNonDefault("marketcap");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "sector":
                return {
                    label: "Sector",
                    valueDisplay: sector || "All",
                    isActive: !!sector,
                    onReset: () => {
                        setTechScanner({ sector: "" });
                        removeFilterIfNonDefault("sector");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">EGX Sectors</h4>
                            <select
                                value={sector}
                                onChange={(e) => setTechScanner({ sector: e.target.value })}
                                className="w-full h-8 px-2 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff]"
                            >
                                <option value="">All Sectors</option>
                                <option value="Finance">Finance / Banking</option>
                                <option value="Process Industries">Process Industries</option>
                                <option value="Consumer Non-Durables">Consumer Non-Durables</option>
                                <option value="Health Technology">Health Technology</option>
                                <option value="Non-Energy Minerals">Non-Energy Minerals</option>
                                <option value="Industrial Services">Industrial Services</option>
                                <option value="Consumer Services">Consumer Services</option>
                                <option value="Producer Manufacturing">Producer Manufacturing</option>
                                <option value="Distribution Services">Distribution Services</option>
                                <option value="Consumer Durables">Consumer Durables</option>
                                <option value="Transportation">Transportation</option>
                                <option value="Utilities">Utilities</option>
                                <option value="Communications">Communications</option>
                            </select>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ sector: "" });
                                        removeFilterIfNonDefault("sector");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "industry":
                return {
                    label: "Industry",
                    valueDisplay: industry || "Any",
                    isActive: !!industry,
                    onReset: () => {
                        setTechScanner({ industry: "" });
                        removeFilterIfNonDefault("industry");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">Industry Filter</h4>
                            <input
                                type="text"
                                placeholder="e.g. Chemicals"
                                value={industry}
                                onChange={(e) => setTechScanner({ industry: e.target.value })}
                                className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff]"
                            />
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ industry: "" });
                                        removeFilterIfNonDefault("industry");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "ema50":
                return {
                    label: "EMA 50 Check",
                    valueDisplay: aboveEma50 ? "Above" : "Any",
                    isActive: aboveEma50,
                    onReset: () => {
                        setTechScanner({ aboveEma50: false });
                        removeFilterIfNonDefault("ema50");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">EMA 50 Filter</h4>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={aboveEma50}
                                    onChange={(e) => setTechScanner({ aboveEma50: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>Price &gt; EMA 50</span>
                            </label>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ aboveEma50: false });
                                        removeFilterIfNonDefault("ema50");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "ema200":
                return {
                    label: "EMA 200 Check",
                    valueDisplay: aboveEma200 ? "Above" : "Any",
                    isActive: aboveEma200,
                    onReset: () => {
                        setTechScanner({ aboveEma200: false });
                        removeFilterIfNonDefault("ema200");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">EMA 200 Filter</h4>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={aboveEma200}
                                    onChange={(e) => setTechScanner({ aboveEma200: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>Price &gt; EMA 200</span>
                            </label>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ aboveEma200: false });
                                        removeFilterIfNonDefault("ema200");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "golden":
                return {
                    label: "Golden Cross",
                    valueDisplay: goldenCross ? "Active" : "Any",
                    isActive: goldenCross,
                    onReset: () => {
                        setTechScanner({ goldenCross: false });
                        removeFilterIfNonDefault("golden");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">Golden Cross Filter</h4>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={goldenCross}
                                    onChange={(e) => setTechScanner({ goldenCross: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>EMA 50 &gt; EMA 200</span>
                            </label>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ goldenCross: false });
                                        removeFilterIfNonDefault("golden");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "volume20":
                return {
                    label: "Vol > SMA 20",
                    valueDisplay: volumeAboveSma20 ? "Above" : "Any",
                    isActive: volumeAboveSma20,
                    onReset: () => {
                        setTechScanner({ volumeAboveSma20: false });
                        removeFilterIfNonDefault("volume20");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">Volume Spike Filter</h4>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={volumeAboveSma20}
                                    onChange={(e) => setTechScanner({ volumeAboveSma20: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>Volume &gt; Simple SMA 20</span>
                            </label>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ volumeAboveSma20: false });
                                        removeFilterIfNonDefault("volume20");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "vwap20":
                return {
                    label: "VWAP Check",
                    valueDisplay: aboveVwap20 ? "Above" : "Any",
                    isActive: aboveVwap20,
                    onReset: () => {
                        setTechScanner({ aboveVwap20: false });
                        removeFilterIfNonDefault("vwap20");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">VWAP 20 Filter</h4>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={aboveVwap20}
                                    onChange={(e) => setTechScanner({ aboveVwap20: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>Price &gt; VWAP 20</span>
                            </label>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ aboveVwap20: false });
                                        removeFilterIfNonDefault("vwap20");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "adx":
                return {
                    label: "ADX",
                    valueDisplay: adxMin || adxMax ? `${adxMin || 0}-${adxMax || 100}` : "Any",
                    isActive: !!(adxMin || adxMax),
                    onReset: () => {
                        setTechScanner({ adxMin: "", adxMax: "" });
                        removeFilterIfNonDefault("adx");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">ADX Trend Range</h4>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    placeholder="Min"
                                    value={adxMin}
                                    onChange={(e) => setTechScanner({ adxMin: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max"
                                    value={adxMax}
                                    onChange={(e) => setTechScanner({ adxMax: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ adxMin: "", adxMax: "" });
                                        removeFilterIfNonDefault("adx");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "atr":
                return {
                    label: "ATR",
                    valueDisplay: atrMin || atrMax ? `${atrMin || 0}-${atrMax || 100}` : "Any",
                    isActive: !!(atrMin || atrMax),
                    onReset: () => {
                        setTechScanner({ atrMin: "", atrMax: "" });
                        removeFilterIfNonDefault("atr");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">ATR Range</h4>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    placeholder="Min"
                                    value={atrMin}
                                    onChange={(e) => setTechScanner({ atrMin: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max"
                                    value={atrMax}
                                    onChange={(e) => setTechScanner({ atrMax: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ atrMin: "", atrMax: "" });
                                        removeFilterIfNonDefault("atr");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "roc":
                return {
                    label: "ROC",
                    valueDisplay: rocMin || rocMax ? `${rocMin || 0}-${rocMax || 100}` : "Any",
                    isActive: !!(rocMin || rocMax),
                    onReset: () => {
                        setTechScanner({ rocMin: "", rocMax: "" });
                        removeFilterIfNonDefault("roc");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">ROC Range (12)</h4>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    placeholder="Min"
                                    value={rocMin}
                                    onChange={(e) => setTechScanner({ rocMin: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max"
                                    value={rocMax}
                                    onChange={(e) => setTechScanner({ rocMax: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ rocMin: "", rocMax: "" });
                                        removeFilterIfNonDefault("roc");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            case "ai":
                return {
                    label: "AI Target",
                    valueDisplay: useAiFilter ? `>= ${minAiPrecision}` : "Off",
                    isActive: useAiFilter,
                    onReset: () => {
                        setTechScanner({ useAiFilter: false });
                        removeFilterIfNonDefault("ai");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">AI Analytics Filter</h4>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={useAiFilter}
                                    onChange={(e) => setTechScanner({ useAiFilter: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>Enable AI Predictions</span>
                            </label>
                            {useAiFilter && (
                                <div className="space-y-1">
                                    <span className="text-[10px] text-[#787b86] font-bold uppercase">Min Precision</span>
                                    <input
                                        type="number"
                                        step="0.05"
                                        min="0"
                                        max="1"
                                        value={minAiPrecision}
                                        onChange={(e) => setTechScanner({ minAiPrecision: e.target.value })}
                                        className="w-full h-8 px-2 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                    />
                                </div>
                            )}
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ useAiFilter: false });
                                        removeFilterIfNonDefault("ai");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )
                };
            default:
                return null;
        }
    };

    // Check if any filters are active
    const activeFiltersCount = useMemo(() => {
        let count = 0;
        if (minPrice) count++;
        if (rsiMin || rsiMax) count++;
        if (marketCapMin || marketCapMax) count++;
        if (sector) count++;
        if (industry) count++;
        if (aboveEma50) count++;
        if (aboveEma200) count++;
        if (goldenCross) count++;
        if (volumeAboveSma20) count++;
        if (aboveVwap20) count++;
        if (adxMin || adxMax) count++;
        if (atrMin || atrMax) count++;
        if (rocMin || rocMax) count++;
        if (useAiFilter) count++;
        return count;
    }, [minPrice, rsiMin, rsiMax, marketCapMin, marketCapMax, sector, industry, aboveEma50, aboveEma200, goldenCross, volumeAboveSma20, aboveVwap20, adxMin, adxMax, atrMin, atrMax, rocMin, rocMax, useAiFilter]);

    const hasAnyActiveFilter = activeFiltersCount > 0;

    // Split category popover for dynamic add filter '+' button
    function AddFilterPopover({ onClose }: { onClose: () => void }) {
        const [activeCategory, setActiveCategory] = useState<string>("all");
        const [searchQuery, setSearchQuery] = useState<string>("");

        const CATEGORIES = [
            { id: "all", label: "All Filters" },
            { id: "security", label: "Security Info" },
            { id: "market", label: "Market Data" },
            { id: "technical", label: "Technicals" },
            { id: "ai", label: "AI Analytics" }
        ];

        const ALL_FILTERS = [
            { id: "price", label: "Min Price", desc: "Minimum stock price in EGP", cat: "market" },
            { id: "rsi", label: "Relative Strength Index (RSI)", desc: "14-period RSI indicator", cat: "technical" },
            { id: "marketcap", label: "Market Capitalization", desc: "Total market value of shares", cat: "market" },
            { id: "sector", label: "Sector", desc: "Company's macroeconomic sector", cat: "security" },
            { id: "industry", label: "Industry", desc: "Company's specific industry", cat: "security" },
            { id: "ema50", label: "Price > EMA 50", desc: "Price sits above 50-day exponential average", cat: "technical" },
            { id: "ema200", label: "Price > EMA 200", desc: "Price sits above 200-day exponential average", cat: "technical" },
            { id: "golden", label: "Golden Cross (50 > 200)", desc: "50 EMA crossed above 200 EMA", cat: "technical" },
            { id: "volume20", label: "Volume > SMA 20", desc: "Volume above 20-day simple volume average", cat: "technical" },
            { id: "vwap20", label: "Price > VWAP 20", desc: "Close price sits above Volume Weighted Average Price", cat: "technical" },
            { id: "adx", label: "Average Directional Index (ADX)", desc: "Trend strength indicator", cat: "technical" },
            { id: "atr", label: "Average True Range (ATR)", desc: "Market volatility indicator", cat: "technical" },
            { id: "roc", label: "Rate of Change (ROC)", desc: "12-period speed momentum indicator", cat: "technical" },
            { id: "ai", label: "Random Forest AI Filter", desc: "Machine Learning trade prediction filter", cat: "ai" }
        ];

        const filteredList = ALL_FILTERS.filter(item => {
            const matchesCat = activeCategory === "all" || item.cat === activeCategory;
            const matchesSearch = item.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  item.desc.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCat && matchesSearch;
        });

        const handleSelectFilter = (id: string) => {
            if (!visibleFilters.includes(id)) {
                setVisibleFilters(prev => [...prev, id]);
            }
            onClose();
            setActiveFilterPopover(id);
        };

        return (
            <div className="absolute top-full left-0 mt-2 bg-[#131722] border border-[#2a2e39] rounded-lg shadow-2xl z-[200] w-[400px] overflow-hidden flex flex-col h-80 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Search Header */}
                <div className="p-3 border-b border-[#2a2e39] relative">
                    <input
                        type="text"
                        placeholder="Search filters..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-8 pl-8 pr-3 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs placeholder-[#787b86] focus:outline-none focus:border-[#2962ff]"
                        autoFocus
                    />
                    <Search className="absolute left-5.5 top-5 w-3.5 h-3.5 text-[#787b86]" />
                </div>

                {/* Split Content */}
                <div className="flex-1 flex min-h-0">
                    {/* Left Pane (Categories) */}
                    <div className="w-1/3 bg-[#0c0d12] border-r border-[#2a2e39] overflow-y-auto no-scrollbar py-2">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`
                                    w-full text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors
                                    ${activeCategory === cat.id
                                        ? "text-white bg-[#1c2030]"
                                        : "text-[#787b86] hover:text-white"}
                                `}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>

                    {/* Right Pane (Filters) */}
                    <div className="w-2/3 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {filteredList.length === 0 ? (
                            <div className="text-center py-12 text-[#787b86] text-xs">No filters found</div>
                        ) : (
                            filteredList.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => handleSelectFilter(item.id)}
                                    className="w-full text-left p-2 rounded hover:bg-[#1c2030] border border-transparent hover:border-[#2a2e39] transition-all group flex flex-col gap-0.5"
                                >
                                    <span className="text-xs font-bold text-[#d1d4dc] group-hover:text-[#2962ff] transition-colors">{item.label}</span>
                                    <span className="text-[9px] text-[#787b86] line-clamp-1">{item.desc}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0c0d12] text-[#d1d4dc] font-sans selection:bg-[#2962ff]/30 selection:text-white relative min-h-[calc(100vh-100px)] border border-[#2a2e39]">
            {/* --- TradingView-Style Header --- */}
            <div className="flex items-center justify-between border-b border-[#2a2e39] bg-[#131722] px-4 py-3 sm:px-6">
                <div className="flex items-center gap-3">
                    <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                        <Database className="w-4 h-4 text-[#2962ff]" />
                        <span>Stock Screener</span>
                    </h1>
                    <div className="h-4 w-[1px] bg-[#2a2e39]" />
                    {/* All Stocks / Filter Dropdown selector */}
                    <div className="relative">
                        <button className="flex items-center gap-1 text-xs font-bold text-white hover:text-[#2962ff] transition-colors">
                            <span>Egypt Stocks</span>
                            <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    {loading && <Loader2 className="h-4 w-4 animate-spin text-[#2962ff]" />}
                </div>
                
                {/* Top Right Actions */}
                <div className="flex items-center gap-3">
                    {/* Search Bar */}
                    <div className="relative hidden sm:block">
                        <input
                            type="text"
                            placeholder="Search Symbol..."
                            value={searchTerm}
                            onChange={(e) => setTechScanner({ searchTerm: e.target.value })}
                            className="w-48 sm:w-64 h-8 pl-8 pr-3 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs placeholder-[#787b86] focus:outline-none focus:border-[#2962ff] transition-all"
                        />
                        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#787b86]" />
                        {searchTerm && (
                            <button onClick={() => setTechScanner({ searchTerm: "" })} className="absolute right-2.5 top-2.5 text-[#787b86] hover:text-white">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Reset Button */}
                    <button
                        onClick={handleResetFilters}
                        className="flex items-center gap-1 px-2.5 h-8 text-[11px] font-bold text-[#b2b5be] hover:text-white hover:bg-[#1c2030] border border-[#2a2e39] rounded transition-colors active:scale-95 uppercase tracking-wider"
                        title="Clear all filters"
                    >
                        <X className="w-3.5 h-3.5" />
                        <span className="hidden xs:inline">Reset</span>
                    </button>

                    {/* Telegram Alerts */}
                    {user && (
                        <button
                            onClick={() => {
                                setShowManageAlertsDialog(true);
                                void fetchAlerts();
                                void fetchTelegramChatId();
                            }}
                            className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded transition-colors active:scale-95 shadow-md shadow-[#2962ff]/20 uppercase tracking-wider"
                        >
                            <Bell className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline">Alerts</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Mobile Search Bar */}
            <div className="sm:hidden p-3 border-b border-[#2a2e39] bg-[#131722] flex items-center">
                <div className="relative w-full">
                    <input
                        type="text"
                        placeholder="Search Symbol..."
                        value={searchTerm}
                        onChange={(e) => setTechScanner({ searchTerm: e.target.value })}
                        className="w-full h-8 pl-8 pr-3 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs placeholder-[#787b86] focus:outline-none focus:border-[#2962ff] transition-all"
                    />
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#787b86]" />
                    {searchTerm && (
                        <button onClick={() => setTechScanner({ searchTerm: "" })} className="absolute right-2.5 top-2.5 text-[#787b86] hover:text-white">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* --- Scanner Templates --- */}
            <div className="px-4 py-3 sm:px-6 bg-[#0c0d12] border-b border-[#2a2e39]">
                <ScannerTemplates onSelect={applyTemplate} />
            </div>

            {/* --- Horizontal Filter Pills Bar --- */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2a2e39] bg-[#131722] overflow-x-auto no-scrollbar scroll-smooth relative z-40">
                {/* Country indicator (Pinned) */}
                <div className="flex items-center gap-1.5 h-8 px-3 rounded bg-[#1c2030] border border-[#2a2e39] text-[11px] font-bold text-white shrink-0 uppercase tracking-wider">
                    <Globe className="w-3.5 h-3.5 text-[#2962ff]" />
                    <span>Egypt (EGX)</span>
                </div>

                {/* Dynamic Filter Pills */}
                {visibleFilters.map((filterId) => {
                    const config = getFilterConfig(filterId);
                    if (!config) return null;
                    const isFilterActive = config.isActive;
                    return (
                        <div key={filterId} className="relative shrink-0">
                            <button
                                onClick={() => setActiveFilterPopover(activeFilterPopover === filterId ? null : filterId)}
                                className={`
                                    h-8 px-3 rounded border flex items-center gap-1.5 text-xs font-medium transition-all active:scale-95
                                    ${isFilterActive
                                        ? "bg-[#2962ff]/10 border-[#2962ff]/30 text-[#2962ff] font-semibold"
                                        : "bg-[#1c2030] border-[#2a2e39] text-[#b2b5be] hover:text-[#d1d4dc] hover:bg-[#2a2e39]"}
                                `}
                            >
                                <span>{config.label}:</span>
                                <span className={isFilterActive ? "text-white font-mono" : "text-[#787b86] font-normal"}>
                                    {config.valueDisplay}
                                </span>
                                {isFilterActive && (
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            config.onReset();
                                        }}
                                        className="p-0.5 rounded-full hover:bg-[#2962ff]/20 text-[#2962ff] hover:text-white transition-colors"
                                    >
                                        <X className="w-3 h-3" />
                                    </span>
                                )}
                            </button>
                            {activeFilterPopover === filterId && (
                                <div className="absolute top-full left-0 mt-2 p-4 bg-[#131722] border border-[#2a2e39] rounded shadow-2xl z-[150] w-64 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200 text-left">
                                    {config.renderPopover()}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* '+' Add Filter Button */}
                <div className="relative shrink-0">
                    <button
                        onClick={() => setShowAddFilterMenu(!showAddFilterMenu)}
                        className="w-8 h-8 flex items-center justify-center rounded bg-[#1c2030] border border-[#2a2e39] text-[#b2b5be] hover:text-white hover:bg-[#2a2e39] transition-all active:scale-95"
                        title="Add Filter"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                    {showAddFilterMenu && (
                        <AddFilterPopover onClose={() => setShowAddFilterMenu(false)} />
                    )}
                </div>
                
                {/* Reset All filter pill if any is active */}
                {hasAnyActiveFilter && (
                    <button
                        onClick={handleResetFilters}
                        className="h-8 px-2 flex items-center justify-center text-xs text-[#ef5350] hover:text-white transition-colors shrink-0 font-bold"
                    >
                        Clear All ({activeFiltersCount})
                    </button>
                )}
            </div>

            {/* --- View Toolbar (Tab Switcher) --- */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2e39] bg-[#0c0d12]">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setTechScanner({ currentTab: tab.id as any })}
                            className={`
                                h-7 px-3 rounded text-[11px] font-bold tracking-wider uppercase transition-colors shrink-0
                                ${currentTab === tab.id
                                    ? "bg-[#2962ff] text-white font-black"
                                    : "text-[#787b86] hover:text-[#d1d4dc] hover:bg-[#131722]"}
                            `}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="text-[10px] font-bold text-[#787b86] uppercase tracking-wider hidden xs:block">
                    {scannedCount > 0 && (
                        <span>{filteredResults.length} of {scannedCount} matched</span>
                    )}
                </div>
            </div>

            {/* --- Results Table --- */}
            <div className="flex-1 flex flex-col min-h-0 relative bg-[#0c0d12]">
                <div className="flex-1 overflow-auto custom-scrollbar">
                    {loading && results.length === 0 ? (
                        <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4">
                            <Loader2 className="h-8 w-8 animate-spin text-[#2962ff]" />
                            <div className="flex flex-col items-center gap-0.5">
                                <p className="text-xs font-bold text-white uppercase tracking-widest animate-pulse">Scanning Egyptian Market</p>
                                <p className="text-[9px] text-[#787b86] uppercase tracking-wider">Applying technical filters...</p>
                            </div>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4 text-[#787b86]">
                            <Database className="h-12 w-12 opacity-20" />
                            <div className="text-center">
                                <p className="text-sm font-bold text-white uppercase tracking-wider opacity-30">No Stocks Found</p>
                                <p className="text-[10px] text-[#787b86] uppercase tracking-widest">Adjust filters and try again</p>
                            </div>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm whitespace-nowrap table-fixed border-collapse">
                            <thead className="sticky top-0 z-20 bg-[#131722] text-[#787b86] shadow-md border-b border-[#2a2e39]">
                                <tr>
                                    {/* Sortable Symbol */}
                                    <th 
                                        className="w-64 px-8 py-3 text-left border-r border-[#2a2e39] border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86] cursor-pointer hover:bg-[#1e222d] transition-colors"
                                        onClick={() => handleSort("symbol")}
                                    >
                                        <div className="flex items-center gap-1 justify-start">
                                            <span>Symbol</span>
                                            {sortBy === "symbol" ? (
                                                sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-[#2962ff]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#2962ff]" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-[#787b86]/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                        </div>
                                    </th>
                                    
                                    {/* Sortable Price */}
                                    <SortableHeader label="Price" field="last_close" widthClass="w-32" />
                                    
                                    {/* Sortable Change */}
                                    <SortableHeader label="Chg %" field="change_p" widthClass="w-32" />

                                    {currentTab === 'overview' && (
                                        <>
                                            <SortableHeader label="Volume" field="volume" widthClass="w-32" />
                                            <SortableHeader label="Mkt Cap" field="market_cap" widthClass="w-32" />
                                            <SortableHeader label="P/E" field="pe_ratio" widthClass="w-28" />
                                            <SortableHeader label="EPS" field="eps" widthClass="w-32" />
                                            <th className="w-48 px-6 py-3 text-left border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86]">Sector</th>
                                        </>
                                    )}
                                    {currentTab === 'performance' && (
                                        <>
                                            <SortableHeader label="RSI" field="rsi" widthClass="w-32" align="center" />
                                            <SortableHeader label="EMA 50" field="ema50" widthClass="w-32" />
                                            <SortableHeader label="EMA 200" field="ema200" widthClass="w-32" />
                                            <SortableHeader label="Momentum" field="momentum" widthClass="w-32" />
                                            <SortableHeader label="ADX" field="adx14" widthClass="w-32" />
                                            <SortableHeader label="ROC (12)" field="roc12" widthClass="w-32" />
                                        </>
                                    )}
                                    {currentTab === 'dividends' && (
                                        <>
                                            <SortableHeader label="Yield %" field="dividend_yield" widthClass="w-32" />
                                            <th className="w-48 px-6 py-3 text-left border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86]">Industry</th>
                                        </>
                                    )}
                                    {currentTab === 'valuation' && (
                                        <>
                                            <SortableHeader label="Mkt Cap" field="market_cap" widthClass="w-32" />
                                            <SortableHeader label="P/E" field="pe_ratio" widthClass="w-32" />
                                            <SortableHeader label="EPS" field="eps" widthClass="w-32" />
                                            <SortableHeader label="Yield %" field="dividend_yield" widthClass="w-32" />
                                        </>
                                    )}
                                    {currentTab === 'financials' && (
                                        <>
                                            <th className="w-48 px-6 py-3 text-left border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86]">Sector</th>
                                            <th className="w-48 px-6 py-3 text-left border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86]">Industry</th>
                                            <SortableHeader label="Mkt Cap" field="market_cap" widthClass="w-32" />
                                        </>
                                    )}
                                    <th className="w-20 px-8 py-3 text-right border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[11px] text-[#787b86]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#2a2e39]">
                                {pagedResults.map((r) => (
                                    <tr
                                        key={r.symbol}
                                        onClick={() => setTechScanner({ selectedStock: r })}
                                        className={`
                                            group transition-all duration-150 cursor-pointer
                                            ${selectedStock?.symbol === r.symbol ? "bg-[#2962ff]/10" : "hover:bg-[#1e222d] bg-transparent"}
                                        `}
                                    >
                                        <td className="px-8 py-4 border-r border-[#2a2e39]">
                                            <div className="flex items-center gap-4">
                                                <StockLogo symbol={r.symbol} logoUrl={r.logo_url} size="md" />
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-bold text-white text-sm group-hover:text-[#2962ff] transition-colors uppercase tracking-tight">{r.symbol}</span>
                                                    <span className="text-[10px] text-[#787b86] font-semibold uppercase tracking-wider truncate">{r.name || 'Unknown'}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="font-mono font-bold text-[#d1d4dc]">{formatNum(r.last_close)}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className={`font-mono font-bold ${r.change_p >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                                {r.change_p >= 0 ? "+" : ""}{r.change_p.toFixed(2)}%
                                            </span>
                                        </td>
                                        {currentTab === 'overview' && (
                                            <>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatCompact(r.volume)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#d1d4dc] font-bold text-xs">{formatCompact(r.market_cap)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.pe_ratio, 1)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.eps, 2)}</td>
                                                <td className="px-6 py-4 text-left">
                                                    <span className="inline-flex px-2 py-0.5 rounded bg-[#1c2030] border border-[#2a2e39] text-[9px] font-bold uppercase font-mono text-[#b2b5be]">{r.sector || '-'}</span>
                                                </td>
                                            </>
                                        )}
                                        {currentTab === 'performance' && (
                                            <>
                                                <td className="px-6 py-4 text-center">
                                                    <div className={`
                                                        inline-flex px-2 py-0.5 rounded text-[10px] font-bold
                                                        ${r.rsi < 35 ? "bg-[#26a69a]/10 text-[#26a69a]" : r.rsi > 65 ? "bg-[#ef5350]/10 text-[#ef5350]" : "bg-[#1c2030] text-[#b2b5be]"}
                                                    `}>{r.rsi.toFixed(0)}</div>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.ema50)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.ema200)}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className={`font-mono font-bold text-xs ${r.momentum >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                                        {r.momentum >= 0 ? "+" : ""}{(r.momentum * 100).toFixed(2)}%
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.adx14, 1)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.roc12, 1)}%</td>
                                            </>
                                        )}
                                        {currentTab === 'dividends' && (
                                            <>
                                                <td className="px-6 py-4 text-right font-mono text-[#2962ff] font-bold">{r.dividend_yield ? `${formatNum(r.dividend_yield * 100, 2)}%` : "-"}</td>
                                                <td className="px-6 py-4 text-left font-mono text-[#787b86] text-[10px] uppercase truncate">{r.industry || "-"}</td>
                                            </>
                                        )}
                                        {currentTab === 'valuation' && (
                                            <>
                                                <td className="px-6 py-4 text-right font-mono text-[#d1d4dc] font-bold">{formatCompact(r.market_cap)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be]">{formatNum(r.pe_ratio, 1)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#b2b5be]">{formatNum(r.eps, 2)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-[#2962ff]">{r.dividend_yield ? `${formatNum(r.dividend_yield * 100, 2)}%` : "-"}</td>
                                            </>
                                        )}
                                        {currentTab === 'financials' && (
                                            <>
                                                <td className="px-6 py-4 text-left">
                                                    <span className="inline-flex px-2 py-0.5 rounded bg-[#1c2030] border border-[#2a2e39] text-[9px] font-bold uppercase font-mono text-[#b2b5be]">{r.sector || '-'}</span>
                                                </td>
                                                <td className="px-6 py-4 text-left">
                                                    <span className="inline-flex px-2 py-0.5 rounded bg-[#1c2030] border border-[#2a2e39] text-[9px] font-bold uppercase font-mono text-[#b2b5be]">{r.industry || '-'}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-[#d1d4dc] font-bold">{formatCompact(r.market_cap)}</td>
                                            </>
                                        )}
                                        <td className="px-8 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => {
                                                    if (isSaved(r.symbol)) removeSymbolBySymbol(r.symbol);
                                                    else saveSymbol({
                                                        symbol: r.symbol,
                                                        name: r.name,
                                                        source: "tech_scanner",
                                                        metadata: { logo_url: r.logo_url }
                                                    });
                                                }}
                                                className={`p-1.5 rounded transition-colors ${isSaved(r.symbol) ? "text-[#2962ff] bg-[#2962ff]/10" : "text-[#787b86] hover:text-white hover:bg-[#1c2030]"}`}
                                            >
                                                {isSaved(r.symbol) ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* --- Pagination Footer (TradingView Replica Style) --- */}
                {totalPages > 1 && (
                    <div className="px-4 sm:px-6 py-3 border-t border-[#2a2e39] bg-[#131722] flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 z-30">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#787b86]">
                            Page <span className="text-white font-bold">{currentPage}</span> / <span className="text-[#b2b5be]">{totalPages}</span>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                className="flex-1 sm:flex-initial h-8 px-4 rounded border border-[#2a2e39] bg-[#1c2030] flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#b2b5be] hover:text-white hover:bg-[#2a2e39] transition-all disabled:opacity-20 active:scale-95"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" /> Prev
                            </button>
                            <button
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                className="flex-1 sm:flex-initial h-8 px-4 rounded border border-[#2a2e39] bg-[#1c2030] flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#b2b5be] hover:text-white hover:bg-[#2a2e39] transition-all disabled:opacity-20 active:scale-95"
                            >
                                Next <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                {/* --- Detail Slide-over --- */}
                {selectedStock && (
                    <>
                        <div className="fixed inset-0 bg-black/60 z-[200] animate-in fade-in duration-200" onClick={() => setTechScanner({ selectedStock: null })} />
                        <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-[#131722] border-l border-[#2a2e39] z-[201] animate-in slide-in-from-right duration-300 flex flex-col shadow-2xl">
                            {/* Slide-over Header */}
                            <div className="p-4 flex items-center justify-between border-b border-[#2a2e39] bg-[#0c0d12]">
                                <div className="flex items-center gap-3">
                                    <StockLogo symbol={selectedStock.symbol} logoUrl={selectedStock.logo_url} size="xl" />
                                    <div className="flex flex-col gap-0.5">
                                        <h2 className="text-xl font-bold text-white tracking-tight leading-none uppercase">{selectedStock.symbol}</h2>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#787b86] max-w-[200px] truncate">{selectedStock.name}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setTechScanner({ selectedStock: null })}
                                    className="p-1.5 rounded bg-[#1c2030] text-[#787b86] hover:text-white hover:bg-[#2a2e39] transition-colors border border-[#2a2e39] active:scale-95"
                                >
                                    <X className="h-4.5 w-4.5" />
                                </button>
                            </div>

                            {/* Slide-over Content */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
                                {/* Highlights Grid */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 bg-[#0c0d12] rounded border border-[#2a2e39] space-y-1 relative overflow-hidden group">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#787b86]">Price</div>
                                        <div className="text-2xl font-mono font-bold text-white">{formatNum(selectedStock.last_close)}</div>
                                        <div className={`text-[10px] font-bold ${selectedStock.change_p >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                            {selectedStock.change_p >= 0 ? "+" : ""}{selectedStock.change_p.toFixed(2)}% Today
                                        </div>
                                    </div>
                                    <div className="p-4 bg-[#0c0d12] rounded border border-[#2a2e39] space-y-1 relative overflow-hidden group">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#787b86]">RSI (14)</div>
                                        <div className={`text-2xl font-mono font-bold ${selectedStock.rsi < 35 ? "text-[#26a69a]" : selectedStock.rsi > 65 ? "text-[#ef5350]" : "text-white"}`}>
                                            {selectedStock.rsi.toFixed(1)}
                                        </div>
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-[#787b86]">
                                            {selectedStock.rsi < 35 ? "Oversold" : selectedStock.rsi > 65 ? "Overbought" : "Neutral"}
                                        </div>
                                    </div>
                                </div>

                                {/* Fundamentals Group */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-white uppercase tracking-wider border-b border-[#2a2e39] pb-2">
                                        <Landmark className="w-3.5 h-3.5 text-amber-500" />
                                        <span>Company Profile</span>
                                    </div>
                                    <div className="grid grid-cols-1 divide-y divide-[#2a2e39]">
                                        {[
                                            { label: "Market Cap", val: formatCompact(selectedStock.market_cap), icon: Database },
                                            { label: "Sector", val: selectedStock.sector || "-", icon: LayoutTemplate },
                                            { label: "Industry", val: selectedStock.industry || "-", icon: PieChart },
                                            { label: "P/E Ratio", val: formatNum(selectedStock.pe_ratio, 1), icon: Scale },
                                            { label: "Dividend Yield", val: selectedStock.dividend_yield ? `${(selectedStock.dividend_yield * 100).toFixed(2)}%` : "N/A", icon: Coins },
                                            { label: "EPS (TTM)", val: formatNum(selectedStock.eps, 2), icon: Coins },
                                            { label: "Beta", val: formatNum(selectedStock.beta, 2), icon: TrendingUp },
                                        ].map((m) => (
                                            <div key={m.label} className="flex justify-between items-center py-2.5 bg-transparent hover:bg-[#1c2030] px-2 rounded transition-colors">
                                                <div className="flex items-center gap-2">
                                                    <m.icon className="w-3.5 h-3.5 text-[#787b86]" />
                                                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#787b86]">{m.label}</span>
                                                </div>
                                                <span className="font-mono font-bold text-sm text-[#d1d4dc]">{m.val}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Technical Analysis Group */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-white uppercase tracking-wider border-b border-[#2a2e39] pb-2">
                                        <BarChart3 className="w-3.5 h-3.5 text-[#2962ff]" />
                                        <span>Technical Analysis</span>
                                    </div>
                                    <div className="grid grid-cols-1 divide-y divide-[#2a2e39]">
                                        {[
                                            { label: "EMA 50", val: formatNum(selectedStock.ema50) },
                                            { label: "EMA 200", val: formatNum(selectedStock.ema200) },
                                            { label: "Momentum", val: `${(selectedStock.momentum * 100).toFixed(2)}%`, color: selectedStock.momentum >= 0 ? "text-[#26a69a]" : "text-[#ef5350]" },
                                            { label: "ADX (Trend)", val: formatNum(selectedStock.adx14, 1) },
                                            { label: "ROC (Rate of Chg)", val: `${formatNum(selectedStock.roc12, 1)}%` },
                                        ].map((m) => (
                                            <div key={m.label} className="flex justify-between items-center py-2.5 bg-transparent hover:bg-[#1c2030] px-2 rounded transition-colors">
                                                <span className="text-[11px] font-bold uppercase tracking-wider text-[#787b86]">{m.label}</span>
                                                <span className={`font-mono font-bold text-sm ${m.color || "text-[#d1d4dc]"}`}>{m.val}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Slide-over Actions */}
                            <div className="p-4 border-t border-[#2a2e39] bg-[#0c0d12] flex gap-3">
                                <button
                                    onClick={() => addSymbolToCompare(selectedStock.symbol)}
                                    className="flex-1 h-11 flex items-center justify-center gap-2 rounded bg-[#2962ff] hover:bg-[#1a4eff] text-white font-bold text-[11px] uppercase tracking-wider shadow-lg shadow-[#2962ff]/10 transition-colors active:scale-[0.98]"
                                >
                                    <ArrowLeftRight className="h-4 w-4" />
                                    Compare
                                </button>
                                <button
                                    onClick={() => {
                                        if (isSaved(selectedStock.symbol)) removeSymbolBySymbol(selectedStock.symbol);
                                        else saveSymbol({ symbol: selectedStock.symbol, name: selectedStock.name, source: "tech_scanner", metadata: {} });
                                    }}
                                    className="w-11 h-11 flex items-center justify-center rounded border border-[#2a2e39] bg-[#1c2030] text-[#787b86] hover:text-white hover:bg-[#2a2e39] transition-colors active:scale-95"
                                >
                                    {isSaved(selectedStock.symbol) ? (
                                        <BookmarkCheck className="h-4.5 w-4.5 text-[#2962ff]" />
                                    ) : (
                                        <Bookmark className="h-4.5 w-4.5" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* --- Manage Technical Scan Telegram Alerts Dialog --- */}
            {showManageAlertsDialog && (
                <>
                    <div className="fixed inset-0 bg-black/60 z-[210] animate-in fade-in duration-200" onClick={() => setShowManageAlertsDialog(false)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg p-6 bg-[#131722] border border-[#2a2e39] rounded-lg z-[211] animate-in zoom-in-95 duration-200 shadow-2xl space-y-5 text-left">
                        <div className="flex justify-between items-center pb-3 border-b border-[#2a2e39]">
                            <div className="flex items-center gap-2">
                                <BellRing className="w-5 h-5 text-amber-500" />
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Telegram Alerts</h3>
                            </div>
                            <button
                                onClick={() => setShowManageAlertsDialog(false)}
                                className="p-1 rounded bg-[#1c2030] hover:bg-[#2a2e39] text-[#787b86] hover:text-white transition-colors border border-[#2a2e39]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Telegram chat ID warning */}
                        {!fetchingTelegramChatId && !telegramChatId && (
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                <div className="space-y-1 text-xs text-amber-200">
                                    <p className="font-bold">معرف تيليجرام غير مفعّل!</p>
                                    <p className="opacity-80">
                                        لتلقي التنبيهات الفنية، يرجى التوجه لصفحة الملف الشخصي وتعيين معرف تيليجرام الخاص بك، ثم تفعيل البوت.
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-[#787b86] uppercase tracking-wider">Active Alerts</span>
                                <button
                                    disabled={!telegramChatId}
                                    onClick={() => setShowCreateAlertDialog(true)}
                                    className="px-3 py-1.5 rounded bg-[#2962ff] hover:bg-[#1a4eff] disabled:opacity-20 text-[10px] font-bold uppercase tracking-wider text-white transition-colors flex items-center gap-1 active:scale-95"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Create Alert
                                </button>
                            </div>

                            <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {alertsLoading ? (
                                    <div className="flex justify-center py-8">
                                        <Loader2 className="w-6 h-6 animate-spin text-[#787b86]" />
                                    </div>
                                ) : alerts.length === 0 ? (
                                    <div className="text-center py-8 text-[#787b86] text-xs font-bold uppercase tracking-wider">
                                        No Technical Alerts Set
                                    </div>
                                ) : (
                                    alerts.map((a) => (
                                        <div key={a.id} className="p-4 rounded bg-[#0c0d12] border border-[#2a2e39] flex justify-between items-center">
                                            <div className="space-y-1.5 min-w-0 pr-4">
                                                <h4 className="font-bold text-xs text-white font-mono truncate">{a.name}</h4>
                                                <div className="flex flex-wrap gap-1">
                                                    <span className="px-1.5 py-0.5 rounded bg-[#2962ff]/10 border border-[#2962ff]/20 text-[9px] font-mono text-[#2962ff] uppercase font-bold">
                                                        {a.filters.country || "Egypt"}
                                                    </span>
                                                    {Object.entries(a.filters).map(([k, v]) => {
                                                        if (k === "country" || k === "limit" || v === undefined || v === null || v === false) return null;
                                                        return (
                                                            <span key={k} className="px-1.5 py-0.5 rounded bg-[#1c2030] border border-[#2a2e39] text-[9px] font-mono text-[#b2b5be] uppercase font-semibold">
                                                                {k}: {String(v)}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <button
                                                    onClick={() => handleToggleAlert(a.id, !a.is_active)}
                                                    className={`
                                                        w-9 h-5 rounded-full p-0.5 transition-all
                                                        ${a.is_active ? "bg-[#2962ff] flex justify-end" : "bg-[#1c2030] flex justify-start"}
                                                    `}
                                                >
                                                    <span className="w-4 h-4 rounded-full bg-white block shadow-md" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteAlert(a.id)}
                                                    className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
                                                    title="Delete alert"
                                                >
                                                    <Trash className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* --- Create Technical Scan Telegram Alert Dialog --- */}
            {showCreateAlertDialog && (
                <>
                    <div className="fixed inset-0 bg-black/60 z-[220] animate-in fade-in duration-200" onClick={() => setShowCreateAlertDialog(false)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md p-6 bg-[#131722] border border-[#2a2e39] rounded-lg z-[221] animate-in zoom-in-95 duration-200 shadow-2xl space-y-5 text-left">
                        <div className="flex justify-between items-center pb-3 border-b border-[#2a2e39]">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Create Telegram Alert</h3>
                            <button
                                onClick={() => setShowCreateAlertDialog(false)}
                                className="p-1 rounded bg-[#1c2030] hover:bg-[#2a2e39] text-[#787b86] hover:text-white transition-colors border border-[#2a2e39]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] text-[#787b86] font-bold uppercase tracking-wider">Alert Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. RSI Oversold EGX Stocks"
                                    value={newAlertName}
                                    onChange={(e) => setNewAlertName(e.target.value)}
                                    className="w-full h-9 px-3 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff]"
                                />
                            </div>

                            <div className="p-4 bg-[#0c0d12] border border-[#2a2e39] rounded space-y-2">
                                <h4 className="text-[10px] font-bold uppercase text-[#787b86] tracking-wider">Active Filters Included:</h4>
                                <div className="space-y-1.5 text-xs text-[#b2b5be] font-mono">
                                    <div>• Market: <span className="text-white">Egypt (EGX)</span></div>
                                    {minPrice && <div>• Min Price: <span className="text-white">&gt;= {minPrice} EGP</span></div>}
                                    {(rsiMin || rsiMax) && <div>• RSI: <span className="text-white">{rsiMin || 0} - {rsiMax || 100}</span></div>}
                                    {marketCapMin && <div>• Min Market Cap: <span className="text-white">{formatCompact(Number(marketCapMin))} EGP</span></div>}
                                    {marketCapMax && <div>• Max Market Cap: <span className="text-white">{formatCompact(Number(marketCapMax))} EGP</span></div>}
                                    {sector && <div>• Sector: <span className="text-white">{sector}</span></div>}
                                    {aboveEma50 && <div>• Price &gt; EMA 50: <span className="text-white">Yes</span></div>}
                                    {aboveEma200 && <div>• Price &gt; EMA 200: <span className="text-white">Yes</span></div>}
                                    {goldenCross && <div>• Golden Cross: <span className="text-white">Yes</span></div>}
                                    {volumeAboveSma20 && <div>• Vol &gt; SMA 20: <span className="text-white">Yes</span></div>}
                                    {aboveVwap20 && <div>• Price &gt; VWAP 20: <span className="text-white">Yes</span></div>}
                                    {useAiFilter && <div>• AI Predictions: <span className="text-white">Precision &gt;= {minAiPrecision}</span></div>}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowCreateAlertDialog(false)}
                                className="flex-1 h-9 rounded bg-[#1c2030] hover:bg-[#2a2e39] border border-[#2a2e39] text-xs font-bold uppercase tracking-wider text-[#b2b5be] hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateAlert}
                                disabled={savingAlert || !newAlertName.trim()}
                                className="flex-1 h-9 rounded bg-[#2962ff] hover:bg-[#1a4eff] disabled:opacity-20 text-xs font-bold uppercase tracking-wider text-white transition-colors flex items-center justify-center gap-2 active:scale-95"
                            >
                                {savingAlert ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Alert"}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
