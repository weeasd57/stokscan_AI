"use client";

import { createPortal } from "react-dom";
import { useState, useEffect, useMemo } from "react";
import { 
    Sliders, Search, Loader2, Globe, Database, TrendingUp, X, Filter, 
    ChevronLeft, ChevronRight, 
    BarChart3, PieChart, Landmark, Coins, Scale, Percent, Minus, Plus, 
    Info, LayoutTemplate, Settings2, ChevronDown, ChevronUp, Star, ExternalLink, Brain,
    Bell, Save
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWatchlist } from "@/contexts/WatchlistContext";
import { useAppState } from "@/contexts/AppStateContext";
import { useTechnicalScanner } from "@/contexts/TechnicalScannerContext";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { TechResult } from "@/lib/api";
import StockLogo from "@/components/StockLogo";
import ScannerTemplates, { type ScannerTemplateId } from "@/components/ScannerTemplates";
import TradingViewChart from "@/components/TradingViewChartDynamic";
import { isShariaCompliant } from "@/lib/shariaStocks";
const DEFAULT_PILLS = ["price", "rsi", "marketcap", "sector", "divergence", "sharia"];

export default function TechnicalScannerPage() {
    const { t, language } = useLanguage();
    const { saveSymbol, removeSymbolBySymbol, isSaved } = useWatchlist();
    const { addSymbolToCompare } = useAppState();
    
    const {
        state: {
            country,
            results,
            hasScanned,
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
            avoidDistribution,
            requireAccumulation,
            cmfMin,
            shariaOnly,
            activeSymbol,
            chartHeight,
            divergenceType,
            divergenceIndicator,
            divergenceMinStrength,
        },
        setTechScanner,
        runTechScan,
        loading,
        error,
    } = useTechnicalScanner();

    // Alert state: save scanner config & send Telegram alert
    const { user } = useAuth();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const [alertSending, setAlertSending] = useState(false);
    const [showAlertModal, setShowAlertModal] = useState(false);
    const [alertName, setAlertName] = useState("");
    const [alertSaveError, setAlertSaveError] = useState("");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleSaveAlert = async () => {
        if (!user || !alertName.trim()) {
            setAlertSaveError("Please enter a name for the alert");
            return;
        }
        setAlertSending(true);
        setAlertSaveError("");
        try {
            const alertTitle = alertName.trim();
            const filters = {
                country,
                limit: 100,
                rsi_min: rsiMin || undefined,
                rsi_max: rsiMax || undefined,
                min_price: minPrice || undefined,
                above_ema50: aboveEma50,
                above_ema200: aboveEma200,
                adx_min: adxMin || undefined,
                adx_max: adxMax || undefined,
                atr_min: atrMin || undefined,
                atr_max: atrMax || undefined,
                stoch_k_min: stochKMin || undefined,
                stoch_k_max: stochKMax || undefined,
                roc_min: rocMin || undefined,
                roc_max: rocMax || undefined,
                above_vwap20: aboveVwap20,
                volume_above_sma20: volumeAboveSma20,
                market_cap_min: marketCapMin || undefined,
                market_cap_max: marketCapMax || undefined,
                sector: sector || undefined,
                industry: industry || undefined,
                golden_cross: goldenCross,
                use_ai_filter: useAiFilter,
                min_ai_precision: minAiPrecision || undefined,
                avoid_distribution: avoidDistribution,
                require_accumulation: requireAccumulation,
                cmf_min: cmfMin || undefined,
                divergence_type: divergenceType !== "NONE" ? divergenceType : undefined,
                divergence_indicator: divergenceIndicator !== "ANY" ? divergenceIndicator : undefined,
                divergence_min_strength: divergenceMinStrength && parseFloat(divergenceMinStrength) > 0 ? parseFloat(divergenceMinStrength) / 100 : undefined,
            };
            const payload = {
                user_id: user.id,
                name: alertTitle,
                filters,
                is_active: true,
                last_triggered_at: null,
                last_triggered_matches: [],
            };

            const { data: existingAlert, error: lookupErr } = await supabase
                .from("technical_alerts")
                .select("id")
                .eq("user_id", user.id)
                .eq("name", alertTitle)
                .maybeSingle();

            if (lookupErr) throw lookupErr;

            if (existingAlert?.id) {
                const { error: updateErr } = await supabase
                    .from("technical_alerts")
                    .update(payload)
                    .eq("id", existingAlert.id);
                if (updateErr) throw updateErr;
            } else {
                const { error: insertErr } = await supabase
                    .from("technical_alerts")
                    .insert(payload);
                if (insertErr) throw insertErr;
            }

            setShowAlertModal(false);
            setAlertName("");
        } catch (e: any) {
            console.error("Save alert error:", e);
            setAlertSaveError(e?.message || "Failed to save alert");
        } finally {
            setAlertSending(false);
        }
    };

    // Resizable Panels States
    const [sidebarWidth, setSidebarWidth] = useState<number>(320);
    const [isResizingHeight, setIsResizingHeight] = useState<boolean>(false);
    const [isResizingWidth, setIsResizingWidth] = useState<boolean>(false);

    // Resizing Height Effect
    useEffect(() => {
        if (!isResizingHeight) return;

        const handleMouseMove = (e: MouseEvent) => {
            const container = document.getElementById("technical-screener-workspace");
            if (container) {
                const rect = container.getBoundingClientRect();
                const newHeight = Math.max(250, Math.min(800, e.clientY - rect.top));
                setTechScanner({ chartHeight: newHeight });
            }
        };

        const handleMouseUp = () => {
            setIsResizingHeight(false);
            document.body.style.cursor = "default";
            document.body.style.userSelect = "auto";
        };

        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isResizingHeight]);

    // Resizing Width Effect
    useEffect(() => {
        if (!isResizingWidth) return;

        const handleMouseMove = (e: MouseEvent) => {
            const container = document.getElementById("chart-pane-container");
            if (container) {
                const parentRect = container.parentElement?.getBoundingClientRect();
                if (parentRect) {
                    const newWidth = Math.max(200, Math.min(600, parentRect.right - e.clientX));
                    setSidebarWidth(newWidth);
                }
            }
        };

        const handleMouseUp = () => {
            setIsResizingWidth(false);
            document.body.style.cursor = "default";
            document.body.style.userSelect = "auto";
        };

        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isResizingWidth]);

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
    const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

    // Synchronize visible filter pills based on active filter state from session state
    useEffect(() => {
        const activeList = [...DEFAULT_PILLS];
        if (aboveEma50 && !activeList.includes("ema50")) activeList.push("ema50");
        if (aboveEma200 && !activeList.includes("ema200")) activeList.push("ema200");
        if (goldenCross && !activeList.includes("golden")) activeList.push("golden");
        if (volumeAboveSma20 && !activeList.includes("volume20")) activeList.push("volume20");
        if (aboveVwap20 && !activeList.includes("vwap20")) activeList.push("vwap20");
        if (useAiFilter && !activeList.includes("ai")) activeList.push("ai");
        if ((avoidDistribution || requireAccumulation || cmfMin) && !activeList.includes("marketmaker")) activeList.push("marketmaker");
        if (industry && !activeList.includes("industry")) activeList.push("industry");
        if ((adxMin || adxMax) && !activeList.includes("adx")) activeList.push("adx");
        if ((atrMin || atrMax) && !activeList.includes("atr")) activeList.push("atr");
        if ((rocMin || rocMax) && !activeList.includes("roc")) activeList.push("roc");

        setVisibleFilters(prev => {
            const merged = new Set([...prev, ...activeList]);
            return Array.from(merged);
        });
    }, [aboveEma50, aboveEma200, goldenCross, volumeAboveSma20, aboveVwap20, useAiFilter, avoidDistribution, requireAccumulation, cmfMin, industry, adxMin, adxMax, atrMin, atrMax, rocMin, rocMax]);

    // Synchronize activeSymbol with loaded results
    useEffect(() => {
        if (activeSymbol !== null && results.length > 0) {
            const exists = results.some(r => r.symbol === activeSymbol);
            if (!exists) {
                setTechScanner({ activeSymbol: null });
            }
        }
    }, [results, activeSymbol, setTechScanner]);

    // Sorting & Filtering memo
    const filteredResults = useMemo(() => {
        let res = [...results];
        if (searchTerm) {
            const low = searchTerm.toLowerCase();
            res = res.filter(r => r.symbol.toLowerCase().includes(low) || r.name.toLowerCase().includes(low));
        }
        if (shariaOnly) {
            res = res.filter(r => isShariaCompliant(r.symbol));
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
    }, [searchTerm, results, sortBy, sortOrder, shariaOnly]);

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
        { id: 'ai', label: 'AI Scanner', icon: Brain },
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
            avoidDistribution: false,
            requireAccumulation: false,
            cmfMin: "",
            shariaOnly: false,
            divergenceType: "NONE",
            divergenceIndicator: "ANY",
            divergenceMinStrength: "0",
        });
        setVisibleFilters(DEFAULT_PILLS);
        setActiveFilterPopover(null);
        setTimeout(() => void runTechScan({ force: true }), 0);
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
            avoidDistribution: false,
            requireAccumulation: false,
            cmfMin: "",
            shariaOnly: false,
            divergenceType: "NONE",
            divergenceIndicator: "ANY",
            divergenceMinStrength: "0",
        };

        const presets: Record<ScannerTemplateId, Partial<typeof baseUpdate>> = {
            macd_cross: { goldenCross: true, aboveEma50: true },
            rsi_oversold: { rsiMax: "30" },
            volume_breakout: { volumeAboveSma20: true },
            sma_200_breakout: { aboveEma200: true },
            smart_money_flow: { avoidDistribution: true, requireAccumulation: true, cmfMin: "0.05" },
            rsi_bullish_divergence: { divergenceType: "BULLISH", divergenceIndicator: "RSI", divergenceMinStrength: "40" },
            bearish_divergence_alert: { divergenceType: "BEARISH", divergenceIndicator: "ANY", divergenceMinStrength: "30" },
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
            case "marketmaker":
                const mmMode = requireAccumulation ? "accumulation" : avoidDistribution ? "avoid" : "all";
                return {
                    label: language === "ar" ? "صانع السوق" : "Market Maker",
                    valueDisplay: mmMode === "accumulation"
                        ? (language === "ar" ? "تجميع فقط" : "Accum only")
                        : mmMode === "avoid"
                            ? (cmfMin ? `CMF >= ${cmfMin}` : (language === "ar" ? "منع التصريف" : "No dist"))
                            : (cmfMin ? `CMF >= ${cmfMin}` : "Off"),
                    isActive: mmMode !== "all" || !!cmfMin,
                    onReset: () => {
                        setTechScanner({ avoidDistribution: false, requireAccumulation: false, cmfMin: "" });
                        removeFilterIfNonDefault("marketmaker");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">
                                {language === "ar" ? "فلتر التجميع والتصريف" : "Accumulation / Distribution Filter"}
                            </h4>
                            <p className="text-[10px] text-[#787b86] leading-relaxed">
                                {language === "ar"
                                    ? "اختر وضع الفلتر: إظهار كل الأسهم، منع التصريف، أو التجميع فقط."
                                    : "Choose the filter mode: show all stocks, avoid distribution, or accumulation only."}
                            </p>
                            <div className="space-y-1.5">
                                {[
                                    { id: "all", label: language === "ar" ? "كل الأسهم (بدون فلتر)" : "All stocks (no filter)" },
                                    { id: "avoid", label: language === "ar" ? "منع التصريف القوي / CMF < -0.10" : "Avoid distribution / CMF < -0.10" },
                                    { id: "accumulation", label: language === "ar" ? "عرض التجميع فقط" : "Accumulation only" },
                                ].map((opt) => (
                                    <label
                                        key={opt.id}
                                        className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none"
                                    >
                                        <input
                                            type="radio"
                                            name="marketmaker-mode"
                                            checked={mmMode === opt.id}
                                            onChange={() => {
                                                setTechScanner({
                                                    avoidDistribution: opt.id === "avoid",
                                                    requireAccumulation: opt.id === "accumulation",
                                                });
                                            }}
                                            className="rounded-full border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                        />
                                        <span>{opt.label}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-[#787b86] font-bold uppercase">CMF 20 Min (optional)</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    placeholder="e.g. 0.05"
                                    value={cmfMin}
                                    onChange={(e) => setTechScanner({ cmfMin: e.target.value })}
                                    className="w-full h-8 px-2 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ avoidDistribution: false, requireAccumulation: false, cmfMin: "" });
                                        removeFilterIfNonDefault("marketmaker");
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
            case "sharia":
                return {
                    label: language === "ar" ? "متوافقة شرعياً" : "Sharia",
                    valueDisplay: shariaOnly ? (language === "ar" ? "مفعّل" : "On") : "Off",
                    isActive: shariaOnly,
                    onReset: () => {
                        setTechScanner({ shariaOnly: false });
                        removeFilterIfNonDefault("sharia");
                    },
                    renderPopover: () => (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase">
                                {language === "ar" ? "الأسهم المتوافقة مع الشريعة الإسلامية" : "Sharia-Compliant Stocks"}
                            </h4>
                            <p className="text-[10px] text-[#787b86] leading-relaxed">
                                {language === "ar"
                                    ? "عرض أسهم البورصة المصرية المتوافقة شرعياً فقط (يستثني البنوك والتأمين والكحول والتبغ ولحم الخنزير)."
                                    : "Show only EGX stocks screened for Sharia compliance (excludes banks, insurance, alcohol, tobacco & pork)."}
                            </p>
                            <label className="flex items-center gap-2.5 text-xs text-[#d1d4dc] cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={shariaOnly}
                                    onChange={(e) => setTechScanner({ shariaOnly: e.target.checked })}
                                    className="rounded border-[#2a2e39] bg-[#1c2030] text-[#2962ff] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                />
                                <span>{language === "ar" ? "المتوافقة شرعياً فقط" : "Sharia-Compliant Only"}</span>
                            </label>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ shariaOnly: false });
                                        removeFilterIfNonDefault("sharia");
                                        setActiveFilterPopover(null);
                                    }}
                                    className="flex-1 h-7 text-[10px] font-bold text-[#b2b5be] hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={() => { setActiveFilterPopover(null); }}
                                    className="flex-1 h-7 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] text-white rounded"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )
                };
            case "divergence":
                return {
                    label: language === "ar" ? "التباعدات 🔀" : "Divergences 🔀",
                    valueDisplay: divergenceType !== "NONE" 
                        ? `${divergenceIndicator === "ANY" ? (language === "ar" ? "أي مؤشر" : "Any") : divergenceIndicator} ${divergenceType === "BULLISH" ? "🟢" : divergenceType === "BEARISH" ? "🔴" : "🔀"}`
                        : (language === "ar" ? "الكل" : "Any"),
                    isActive: divergenceType !== "NONE",
                    onReset: () => {
                        setTechScanner({ divergenceType: "NONE", divergenceIndicator: "ANY", divergenceMinStrength: "0" });
                        removeFilterIfNonDefault("divergence");
                        setTimeout(() => void runTechScan({ force: true }), 0);
                    },
                    renderPopover: () => (
                        <div className="space-y-3.5">
                            <h4 className="text-xs font-bold text-[#787b86] uppercase tracking-wider">
                                {language === "ar" ? "فلاتر التباعد الذكية" : "Smart Divergence Filters"}
                            </h4>
                            
                            {/* Type selector */}
                            <div className="space-y-1">
                                <label className="text-[10px] text-zinc-400 font-semibold block text-left">
                                    {language === "ar" ? "الاتجاه" : "Direction"}
                                </label>
                                <select
                                    value={divergenceType}
                                    onChange={(e) => setTechScanner({ divergenceType: e.target.value })}
                                    className="w-full h-8.5 px-3 rounded-lg bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] focus:ring-1 focus:ring-[#2962ff]/30 font-semibold cursor-pointer transition-all duration-200"
                                >
                                    <option value="NONE">{language === "ar" ? "بدون تباعد (الكل)" : "No Divergence (All)"}</option>
                                    <option value="BULLISH">{language === "ar" ? "🟢 تباعد صعودي (شراء)" : "🟢 Bullish Divergence"}</option>
                                    <option value="BEARISH">{language === "ar" ? "🔴 تباعد هبوطي (بيع)" : "🔴 Bearish Divergence"}</option>
                                    <option value="ANY">{language === "ar" ? "🔀 أي تباعد" : "🔀 Any Divergence"}</option>
                                </select>
                            </div>

                            {/* Indicator selector */}
                            <div className="space-y-1">
                                <label className="text-[10px] text-zinc-400 font-semibold block text-left">
                                    {language === "ar" ? "المؤشر الفني" : "Technical Indicator"}
                                </label>
                                <select
                                    value={divergenceIndicator}
                                    disabled={divergenceType === "NONE"}
                                    onChange={(e) => setTechScanner({ divergenceIndicator: e.target.value })}
                                    className="w-full h-8.5 px-3 rounded-lg bg-[#1c2030] border border-[#2a2e39] text-white text-xs focus:outline-none focus:border-[#2962ff] focus:ring-1 focus:ring-[#2962ff]/30 font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <option value="ANY">{language === "ar" ? "جميع المؤشرات" : "All Indicators"}</option>
                                    <option value="RSI">RSI (Relative Strength Index)</option>
                                    <option value="MACD">MACD (Moving Average Convergence Divergence)</option>
                                    <option value="STOCH">Stochastic %K</option>
                                </select>
                            </div>

                            {/* Min Strength Slider */}
                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-[10px]">
                                    <span className="text-zinc-400 font-semibold">{language === "ar" ? "الحد الأدنى لقوة التباعد" : "Min Divergence Strength"}</span>
                                    <span className="text-indigo-400 font-bold font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded">{divergenceMinStrength}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="5"
                                    disabled={divergenceType === "NONE"}
                                    value={divergenceMinStrength}
                                    onChange={(e) => setTechScanner({ divergenceMinStrength: e.target.value })}
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#2962ff] disabled:opacity-30 disabled:cursor-not-allowed"
                                />
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setTechScanner({ divergenceType: "NONE", divergenceIndicator: "ANY", divergenceMinStrength: "0" });
                                        removeFilterIfNonDefault("divergence");
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7.5 text-[10px] font-bold text-zinc-400 hover:text-white bg-[#1c2030] border border-[#2a2e39] rounded-lg transition-all duration-150 hover:bg-[#202538]"
                                >
                                    {language === "ar" ? "إعادة تعيين" : "Reset"}
                                </button>
                                <button
                                    onClick={() => {
                                        setActiveFilterPopover(null);
                                        setTimeout(() => void runTechScan({ force: true }), 0);
                                    }}
                                    className="flex-1 h-7.5 text-[10px] font-bold bg-[#2962ff] hover:bg-[#1a4eff] active:bg-[#0c3eff] text-white rounded-lg transition-all duration-150 shadow-[0_0_10px_rgba(41,98,255,0.3)] hover:shadow-[0_0_15px_rgba(41,98,255,0.5)]"
                                >
                                    {language === "ar" ? "تطبيق" : "Apply"}
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
        if (avoidDistribution || requireAccumulation || cmfMin) count++;
        if (shariaOnly) count++;
        if (divergenceType && divergenceType !== "NONE") count++;
        return count;
    }, [minPrice, rsiMin, rsiMax, marketCapMin, marketCapMax, sector, industry, aboveEma50, aboveEma200, goldenCross, volumeAboveSma20, aboveVwap20, adxMin, adxMax, atrMin, atrMax, rocMin, rocMax, useAiFilter, avoidDistribution, requireAccumulation, cmfMin, shariaOnly, divergenceType]);

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
            { id: "moneyflow", label: "Money Flow" },
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
            { id: "marketmaker", label: "Market Maker Flow", desc: "Avoid distribution or require accumulation with CMF 20", cat: "moneyflow" },
            { id: "ai", label: "Random Forest AI Filter", desc: "Machine Learning trade prediction filter", cat: "ai" },
            { id: "sharia", label: "Sharia-Compliant Stocks", desc: "Show only EGX stocks screened for Islamic Sharia compliance", cat: "security" },
            { id: "divergence", label: "Technical Divergence", desc: "Scan for RSI, MACD, and Stochastic divergences", cat: "technical" }
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
        <div className="technical-shell app-page-shell flex flex-col h-full bg-[#0c0d12] text-[#d1d4dc] font-sans selection:bg-[#2962ff]/30 selection:text-white relative min-h-[calc(100vh-100px)] border border-[#2a2e39]">
            {/* --- Scanner Templates --- */}
            <div className="px-4 py-3 sm:px-6 bg-[#0c0d12] border-b border-[#2a2e39]">
                <ScannerTemplates onSelect={applyTemplate} />
            </div>

            {/* --- Horizontal Filter Pills Bar Wrapper (Fixed z-index and clipping wrapper) --- */}
            <div className="relative filter-wrapper !z-50">
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2e39] bg-[#131722] gap-4 z-40 relative">
                    {/* Left scrollable pills */}
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth flex-1">
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
                            <button
                                key={filterId}
                                onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const wrapper = e.currentTarget.closest(".filter-wrapper");
                                    const wrapperRect = wrapper?.getBoundingClientRect();
                                    if (wrapperRect) {
                                        setPopoverPosition({
                                            top: rect.bottom - wrapperRect.top,
                                            left: Math.max(16, Math.min(rect.left - wrapperRect.left, wrapperRect.width - 270))
                                        });
                                    }
                                    setActiveFilterPopover(activeFilterPopover === filterId ? null : filterId);
                                    setShowAddFilterMenu(false);
                                }}
                                className={`
                                    h-8 px-3 rounded border flex items-center gap-1.5 text-xs font-medium transition-all active:scale-95 shrink-0
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
                        );
                    })}

                    {/* '+' Add Filter Button */}
                    <button
                        onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const wrapper = e.currentTarget.closest(".filter-wrapper");
                            const wrapperRect = wrapper?.getBoundingClientRect();
                            if (wrapperRect) {
                                setPopoverPosition({
                                    top: rect.bottom - wrapperRect.top,
                                    left: Math.max(16, Math.min(rect.left - wrapperRect.left, wrapperRect.width - 410))
                                });
                            }
                            setShowAddFilterMenu(!showAddFilterMenu);
                            setActiveFilterPopover(null);
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded bg-[#1c2030] border border-[#2a2e39] text-[#b2b5be] hover:text-white hover:bg-[#2a2e39] transition-all active:scale-95 shrink-0"
                        title="Add Filter"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                    
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

                    {/* Right actions (Search, Reset, Alerts) */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Search Bar */}
                        <div className="relative hidden sm:block">
                            <input
                                type="text"
                                placeholder="Search Symbol..."
                                value={searchTerm}
                                onChange={(e) => setTechScanner({ searchTerm: e.target.value })}
                                className="w-36 sm:w-48 h-8 pl-8 pr-3 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs placeholder-[#787b86] focus:outline-none focus:border-[#2962ff] transition-all"
                            />
                            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#787b86]" />
                            {searchTerm && (
                                <button onClick={() => setTechScanner({ searchTerm: "" })} className="absolute right-2.5 top-2.5 text-[#787b86] hover:text-white">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Alert Button: opens modal to name & save alert */}
                        {user && (
                            <button
                                onClick={() => {
                                    setAlertName("");
                                    setAlertSaveError("");
                                    setShowAlertModal(true);
                                }}
                                className="flex items-center gap-1.5 px-2.5 h-8 text-[11px] font-bold rounded transition-colors active:scale-95 uppercase tracking-wider border bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30"
                                title="Save scanner alert"
                            >
                                <Bell className="w-3.5 h-3.5" />
                                <span className="hidden xs:inline">Alert</span>
                            </button>
                        )}

                        {/* Reset Button */}
                        <button
                            onClick={handleResetFilters}
                            className="flex items-center gap-1 px-2.5 h-8 text-[11px] font-bold text-[#b2b5be] hover:text-white hover:bg-[#1c2030] border border-[#2a2e39] rounded transition-colors active:scale-95 uppercase tracking-wider"
                            title="Clear all filters"
                        >
                            <X className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline">Reset</span>
                        </button>

                    </div>
                </div>

                {/* Mobile Search Bar (Only shown on mobile) */}
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

                {/* Popovers rendered OUTSIDE of the overflow scrolling container */}
                {activeFilterPopover && popoverPosition && (
                    <div 
                        className="!absolute !z-[150] p-4 bg-[#131722] border border-[#2a2e39] rounded shadow-2xl w-64 space-y-3 text-left mt-1"
                        style={{ top: `${popoverPosition.top}px`, left: `${popoverPosition.left}px` }}
                    >
                        {getFilterConfig(activeFilterPopover)?.renderPopover()}
                    </div>
                )}

                {showAddFilterMenu && popoverPosition && (
                    <div 
                        className="!absolute !z-[150] mt-1"
                        style={{ top: `${popoverPosition.top}px`, left: `${popoverPosition.left}px` }}
                    >
                        <AddFilterPopover onClose={() => setShowAddFilterMenu(false)} />
                    </div>
                )}
            </div>

            {/* --- Main Workspace (Vertical Split Screen Layout: Chart on Top, Table below) --- */}
            <div id="technical-screener-workspace" className="flex-1 min-h-0 flex flex-col relative">
                
                {/* --- Top Pane: TradingView Chart & Details Sidebar --- */}
                {activeSymbol && (
                    <>
                        <div 
                            style={{ height: `${chartHeight}px`, overflow: 'hidden' }}
                            className="w-full flex flex-col bg-[#131722] shrink-0 relative"
                        >
                            {(() => {
                                const currentStock = results.find(r => r.symbol === activeSymbol);
                                if (!currentStock) return null;
                                return (
                                    <div id="chart-pane-container" className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#131722]" style={{ overflow: 'hidden' }}>
                                        {/* Active Stock details header */}
                                        <div className="p-3 border-b border-[#2a2e39] bg-[#0c0d12] flex items-center justify-between shrink-0">
                                            <div className="flex items-center gap-3">
                                                <StockLogo symbol={currentStock.symbol} logoUrl={currentStock.logo_url} size="md" />
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-white text-sm uppercase">{currentStock.symbol}</span>
                                                        <span className="text-[10px] text-[#787b86] font-semibold truncate max-w-[120px] sm:max-w-none">{currentStock.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <span className="font-mono text-white font-bold">{formatNum(currentStock.last_close)}</span>
                                                        <span className={`font-mono font-bold ${currentStock.change_p >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                                            {currentStock.change_p >= 0 ? "+" : ""}{currentStock.change_p.toFixed(2)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {/* Pop Out Button */}
                                                <button
                                                    onClick={() => {
                                                        const exchange = country?.toLowerCase() === "egypt" ? "EGX" : (country?.toLowerCase() === "crypto" ? "CRYPTO" : "US");
                                                        const popoutUrl = `/chart/popout?symbol=${encodeURIComponent(activeSymbol)}&exchange=${encodeURIComponent(exchange)}`;
                                                        window.open(popoutUrl, "_blank", "width=1200,height=750,menubar=no,status=no,toolbar=no");
                                                    }}
                                                    className="w-8 h-8 rounded border border-zinc-700 bg-[#1c2030] text-[#b2b5be] hover:bg-zinc-800 hover:text-white flex items-center justify-center transition-colors active:scale-95"
                                                    title="Pop Out Chart"
                                                >
                                                    <ExternalLink className="h-4 w-4" />
                                                </button>

                                                {/* Close button to hide chart */}
                                                <button
                                                    onClick={() => {
                                                        setTechScanner({ activeSymbol: null, selectedStock: null });
                                                    }}
                                                    className="w-8 h-8 rounded border border-[#ef5350]/30 bg-[#1c2030] text-[#ef5350] hover:bg-[#ef5350]/15 hover:text-[#ef5350] flex items-center justify-center transition-colors active:scale-95 ml-1"
                                                    title="Close Chart"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* TradingView Dynamic Chart Embed */}
                                        <div 
                                            className="flex-1 min-h-0 w-full bg-[#131722] relative"
                                            style={{ overflow: 'hidden' }}
                                            onWheel={(e) => {
                                                // ✅ Capture wheel events inside the chart zone
                                                // so the page doesn't scroll when user zooms/scrolls the chart
                                                e.stopPropagation();
                                            }}
                                        >
                                            <TradingViewChart 
                                                symbol={activeSymbol} 
                                                theme="dark" 
                                                exchange={country?.toLowerCase() === "egypt" ? "EGX" : (country?.toLowerCase() === "crypto" ? "CRYPTO" : "US")} 
                                            />
                                        </div>

                                        {/* Horizontal Symbol Profile & Stats Bar */}
                                        <div className="border-t border-[#2a2e39] bg-[#0c0d12] px-4 py-2.5 flex items-center overflow-x-auto no-scrollbar gap-6 shrink-0 select-none">
                                            {/* Market Cap */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                                    <Coins className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">Mkt Cap</span>
                                                    <span className="font-mono font-bold text-zinc-100 text-xs mt-0.5">{formatCompact(currentStock.market_cap)}</span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* Sector */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                                                    <PieChart className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col max-w-[120px]">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">Sector</span>
                                                    <span className="font-bold text-zinc-100 text-xs truncate mt-0.5" title={currentStock.sector}>{currentStock.sector || "-"}</span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* P/E Ratio */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                                                    <Scale className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">P/E Ratio</span>
                                                    <span className="font-mono font-bold text-zinc-100 text-xs mt-0.5">{formatNum(currentStock.pe_ratio, 1)}</span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* EPS */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shrink-0">
                                                    <Landmark className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">EPS (TTM)</span>
                                                    <span className="font-mono font-bold text-zinc-100 text-xs mt-0.5">{formatNum(currentStock.eps, 2)}</span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* RSI (14) */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
                                                    <Percent className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">RSI (14)</span>
                                                    <span className={`font-mono font-bold text-xs mt-0.5 ${currentStock.rsi < 35 ? "text-[#26a69a]" : currentStock.rsi > 65 ? "text-[#ef5350]" : "text-zinc-100"}`}>
                                                        {currentStock.rsi.toFixed(1)}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* EMA 50 */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                                                    <TrendingUp className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">EMA 50</span>
                                                    <span className="font-mono font-bold text-zinc-100 text-xs mt-0.5">{formatNum(currentStock.ema50)}</span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* EMA 200 */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                                                    <TrendingUp className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">EMA 200</span>
                                                    <span className="font-mono font-bold text-zinc-100 text-xs mt-0.5">{formatNum(currentStock.ema200)}</span>
                                                </div>
                                            </div>

                                            <div className="h-6 w-[1px] bg-zinc-800" />

                                            {/* ADX */}
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-md bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                                                    <Globe className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider leading-none">ADX (14)</span>
                                                    <span className="font-mono font-bold text-zinc-100 text-xs mt-0.5">{formatNum(currentStock.adx14, 1)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Horizontal Resize Handle */}
                        <div 
                            onMouseDown={() => setIsResizingHeight(true)}
                            className="w-full h-1 cursor-ns-resize bg-zinc-800/40 hover:bg-indigo-600 transition-colors z-40 relative shrink-0 border-t border-b border-[#2a2e39]"
                            title="Drag to resize chart height"
                        />
                    </>
                )}

                {/* --- Bottom Pane: Screener Table (Unified Layout) --- */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0c0d12]">
                    
                    {/* Toolbar tab switcher */}
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
                    </div>

                    {/* Screener Results Table List */}
                    <div className="flex-1 overflow-auto custom-scrollbar bg-[#0c0d12]">
                        {loading && results.length === 0 ? (
                            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4">
                                <Loader2 className="h-8 w-8 animate-spin text-[#2962ff]" />
                                <p className="text-xs font-bold text-[#787b86] uppercase tracking-wider">Loading Stocks List...</p>
                            </div>
                        ) : results.length === 0 ? (
                            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 text-[#787b86]">
                                <Database className="h-8 w-8 opacity-20" />
                                <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest">No Stocks Found</p>
                                {!hasScanned && (
                                    <button
                                        onClick={() => runTechScan({ force: true })}
                                        className="mt-2 px-4 py-2 bg-[#2962ff] hover:bg-[#1e4bd1] text-white text-xs font-bold rounded-lg transition-colors"
                                    >
                                        Scan Now
                                    </button>
                                )}
                                {hasScanned && (
                                    <p className="text-xs text-zinc-500 mt-2">
                                        Try adjusting filters or click Scan again
                                    </p>
                                )}
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm whitespace-nowrap table-fixed border-collapse">
                                <thead className="sticky top-0 z-20 bg-[#131722] text-[#787b86] border-b border-[#2a2e39] shadow-sm">
                                    <tr>
                                        {/* Sortable Symbol */}
                                        <th 
                                            className="w-36 px-4 py-2 text-left border-r border-[#2a2e39] border-b border-[#2a2e39] font-bold uppercase tracking-wider text-[10px] text-[#787b86] cursor-pointer hover:bg-[#1e222d] transition-colors"
                                            onClick={() => handleSort("symbol")}
                                        >
                                            <div className="flex items-center gap-1 justify-start">
                                                <span>Symbol</span>
                                                {sortBy === "symbol" ? (
                                                    sortOrder === "asc" ? <ChevronUp className="w-3 h-3 text-[#2962ff]" /> : <ChevronDown className="w-3 h-3 text-[#2962ff]" />
                                                ) : (
                                                    <ChevronDown className="w-3 h-3 text-[#787b86]/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                )}
                                            </div>
                                        </th>
                                        
                                        {/* Sortable Price */}
                                        <SortableHeader label="Price" field="last_close" widthClass="w-24" />
                                        
                                        {/* Sortable Change */}
                                        <SortableHeader label="Chg %" field="change_p" widthClass="w-24" />

                                        {currentTab === 'ai' && (
                                            <>
                                                <SortableHeader label="AI Score" field="ai_score" widthClass="w-24" align="center" />
                                                <SortableHeader label="Fundamental" field="fundamental_score" widthClass="w-28" align="center" />
                                                <SortableHeader label="Technical" field="technical_score" widthClass="w-28" align="center" />
                                                <SortableHeader label="Sentiment" field="sentiment_score" widthClass="w-28" align="center" />
                                                <SortableHeader label="Industry" field="industry" widthClass="w-36" align="left" />
                                            </>
                                        )}

                                        {currentTab === 'overview' && (
                                            <>
                                                <SortableHeader label="Volume" field="volume" widthClass="w-24" />
                                                <SortableHeader label="Mkt Cap" field="market_cap" widthClass="w-28" />
                                                <SortableHeader label="P/E" field="pe_ratio" widthClass="w-20" />
                                                <SortableHeader label="EPS" field="eps" widthClass="w-24" />
                                            </>
                                        )}
                                        {currentTab === 'performance' && (
                                            <>
                                                <SortableHeader label="RSI" field="rsi" widthClass="w-20" align="center" />
                                                <SortableHeader label="EMA 50" field="ema50" widthClass="w-24" />
                                                <SortableHeader label="EMA 200" field="ema200" widthClass="w-24" />
                                                <SortableHeader label="Momentum" field="momentum" widthClass="w-24" />
                                                <SortableHeader label="ADX" field="adx14" widthClass="w-20" />
                                                <SortableHeader label="ROC" field="roc12" widthClass="w-24" />
                                            </>
                                        )}
                                        {currentTab === 'dividends' && (
                                            <>
                                                <SortableHeader label="Yield %" field="dividend_yield" widthClass="w-24" />
                                            </>
                                        )}
                                        {currentTab === 'valuation' && (
                                            <>
                                                <SortableHeader label="Mkt Cap" field="market_cap" widthClass="w-28" />
                                                <SortableHeader label="P/E" field="pe_ratio" widthClass="w-20" />
                                                <SortableHeader label="EPS" field="eps" widthClass="w-24" />
                                                <SortableHeader label="Yield %" field="dividend_yield" widthClass="w-24" />
                                            </>
                                        )}
                                        {currentTab === 'financials' && (
                                            <>
                                                <SortableHeader label="Mkt Cap" field="market_cap" widthClass="w-28" />
                                            </>
                                        )}

                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#2a2e39]">
                                    {pagedResults.map((r) => (
                                        <tr
                                            key={r.symbol}
                                            onClick={() => {
                                                setTechScanner({ activeSymbol: r.symbol, selectedStock: r });
                                            }}
                                            className={`
                                                group transition-all duration-150 cursor-pointer
                                                ${activeSymbol === r.symbol ? "bg-[#2962ff]/10" : "hover:bg-[#1e222d] bg-transparent"}
                                            `}
                                        >
                                            <td className="px-4 py-2 border-r border-[#2a2e39]">
                                                <div className="flex items-center gap-2">
                                                    <StockLogo symbol={r.symbol} logoUrl={r.logo_url} size="sm" />
                                                    <div className="flex flex-col min-w-0">
                                                        <div className="flex items-center gap-1">
                                                            <span className="font-bold text-white text-xs group-hover:text-[#2962ff] transition-colors uppercase tracking-tight">{r.symbol}</span>
                                                            {isShariaCompliant(r.symbol) && (
                                                                <span className="inline-flex items-center px-1 py-0.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[8px] font-black uppercase tracking-wider rounded-sm" title={language === "ar" ? "سهم متوافق شرعياً" : "Sharia-compliant stock"}>
                                                                    {language === "ar" ? "حلال" : "Halal"}
                                                                </span>
                                                            )}
                                                            {r.divergence_summary && (
                                                                <span className={`inline-flex items-center px-1.5 py-0.5 text-[8px] font-black tracking-wider rounded border ${
                                                                    r.rsi_divergence === "BULLISH" || r.macd_divergence === "BULLISH" || r.stoch_divergence === "BULLISH"
                                                                        ? "bg-purple-500/15 border-purple-500/30 text-purple-400" 
                                                                        : "bg-amber-500/15 border-amber-500/30 text-amber-400"
                                                                }`} title={r.divergence_summary}>
                                                                    {r.rsi_divergence === "BULLISH" || r.macd_divergence === "BULLISH" || r.stoch_divergence === "BULLISH" ? "↗" : "↘"}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[9px] text-[#787b86] font-semibold uppercase tracking-wider truncate max-w-[80px]">{r.name || 'Unknown'}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <span className="font-mono text-xs font-bold text-[#d1d4dc]">{formatNum(r.last_close)}</span>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <span className={`font-mono text-xs font-bold ${r.change_p >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                                    {r.change_p >= 0 ? "+" : ""}{r.change_p.toFixed(2)}%
                                                </span>
                                            </td>
                                            {currentTab === 'ai' && (
                                                <>
                                                    {/* AI Score (1-10) */}
                                                    <td className="px-4 py-2 text-center">
                                                        {r.ai_score !== undefined && r.ai_score !== null ? (
                                                            <div className={`
                                                                inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-black border
                                                                ${r.ai_score >= 8 
                                                                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" 
                                                                    : r.ai_score >= 5 
                                                                    ? "bg-amber-500/15 text-amber-400 border-amber-500/30" 
                                                                    : "bg-red-500/15 text-red-400 border-red-500/30"}
                                                            `}>
                                                                {r.ai_score}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[#787b86] font-bold text-xs">—</span>
                                                        )}
                                                    </td>

                                                    {/* Fundamental Score (1-10) */}
                                                    <td className="px-4 py-2 text-center">
                                                        {r.fundamental_score !== undefined && r.fundamental_score !== null ? (
                                                            <div className={`
                                                                inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black border
                                                                ${r.fundamental_score >= 7 
                                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                                                                    : r.fundamental_score >= 4 
                                                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20" 
                                                                    : "bg-red-500/10 text-red-400 border-red-500/20"}
                                                            `}>
                                                                {r.fundamental_score}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[#787b86] font-bold text-xs">—</span>
                                                        )}
                                                    </td>

                                                    {/* Technical Score (1-10) */}
                                                    <td className="px-4 py-2 text-center">
                                                        {r.technical_score !== undefined && r.technical_score !== null ? (
                                                            <div className={`
                                                                inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black border
                                                                ${r.technical_score >= 7 
                                                                    ? "bg-emerald-500/10 text-emerald-400 border-[#26a69a]/20" 
                                                                    : r.technical_score >= 4 
                                                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20" 
                                                                    : "bg-red-500/10 text-red-400 border-red-500/20"}
                                                            `}>
                                                                {r.technical_score}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[#787b86] font-bold text-xs">—</span>
                                                        )}
                                                    </td>

                                                    {/* Sentiment Score (1-10) */}
                                                    <td className="px-4 py-2 text-center">
                                                        {r.sentiment_score !== undefined && r.sentiment_score !== null ? (
                                                            <div className={`
                                                                inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black border
                                                                ${r.sentiment_score >= 7 
                                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                                                                    : r.sentiment_score >= 4 
                                                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20" 
                                                                    : "bg-red-500/10 text-red-400 border-red-500/20"}
                                                            `}>
                                                                {r.sentiment_score}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[#787b86] font-bold text-xs">—</span>
                                                        )}
                                                    </td>

                                                    {/* Industry */}
                                                    <td className="px-4 py-2 text-left font-semibold text-xs text-[#b2b5be] truncate max-w-[120px]">
                                                        {r.industry || "—"}
                                                    </td>
                                                </>
                                            )}
                                            {currentTab === 'overview' && (
                                                <>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-xs">{formatCompact(r.volume)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#d1d4dc] font-bold text-xs">{formatCompact(r.market_cap)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.pe_ratio, 1)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.eps, 2)}</td>
                                                </>
                                            )}
                                            {currentTab === 'performance' && (
                                                <>
                                                    <td className="px-4 py-2 text-center">
                                                        <div className={`
                                                            inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold
                                                            ${r.rsi < 35 ? "bg-[#26a69a]/10 text-[#26a69a]" : r.rsi > 65 ? "bg-[#ef5350]/10 text-[#ef5350]" : "bg-[#1c2030] text-[#b2b5be]"}
                                                        `}>{r.rsi.toFixed(0)}</div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-[10px]">{formatNum(r.ema50)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-[10px]">{formatNum(r.ema200)}</td>
                                                    <td className="px-4 py-2 text-right">
                                                        <span className={`font-mono font-bold text-[10px] ${r.momentum >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                                            {r.momentum >= 0 ? "+" : ""}{(r.momentum * 100).toFixed(1)}%
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-[10px]">{formatNum(r.adx14, 1)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-[10px]">{formatNum(r.roc12, 1)}%</td>
                                                </>
                                            )}
                                            {currentTab === 'dividends' && (
                                                <>
                                                    <td className="px-4 py-2 text-right font-mono text-[#2962ff] font-bold text-xs">{r.dividend_yield ? `${formatNum(r.dividend_yield * 100, 2)}%` : "-"}</td>
                                                </>
                                            )}
                                            {currentTab === 'valuation' && (
                                                <>
                                                    <td className="px-4 py-2 text-right font-mono text-[#d1d4dc] font-bold text-xs">{formatCompact(r.market_cap)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.pe_ratio, 1)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#b2b5be] text-xs">{formatNum(r.eps, 2)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-[#2962ff] text-xs">{r.dividend_yield ? `${formatNum(r.dividend_yield * 100, 2)}%` : "-"}</td>
                                                </>
                                            )}
                                            {currentTab === 'financials' && (
                                                <>
                                                    <td className="px-4 py-2 text-right font-mono text-[#d1d4dc] font-bold text-xs">{formatCompact(r.market_cap)}</td>
                                                </>
                                            )}

                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Pagination Footer */}
                    {totalPages > 1 && (
                        <div className="px-4 py-2.5 border-t border-[#2a2e39] bg-[#131722] flex items-center justify-between z-30">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[#787b86]">
                                Page <span className="text-white font-bold">{currentPage}</span> / <span className="text-[#b2b5be]">{totalPages}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    className="h-7 px-3 rounded border border-[#2a2e39] bg-[#1c2030] flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#b2b5be] hover:text-white hover:bg-[#2a2e39] transition-all disabled:opacity-20 active:scale-95"
                                >
                                    <ChevronLeft className="w-3 h-3" /> Prev
                                </button>
                                <button
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    className="h-7 px-3 rounded border border-[#2a2e39] bg-[#1c2030] flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#b2b5be] hover:text-white hover:bg-[#2a2e39] transition-all disabled:opacity-20 active:scale-95"
                                >
                                    Next <ChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Save Alert Modal ── */}
            {mounted && showAlertModal
                ? createPortal(
                    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
                        <div className="w-full max-w-md border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[10px_10px_0px_rgba(0,0,0,1)] dark:shadow-[10px_10px_0px_rgba(255,255,255,1)] p-6 space-y-5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 border-4 border-black dark:border-white bg-amber-400 text-black flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                                        <Bell className="h-5 w-5" />
                                    </div>
                                    <h2 className="text-xl font-black text-black dark:text-white uppercase tracking-tight">
                                        {language === "ar" ? "حفظ تنبيه الماسح" : "Save Scanner Alert"}
                                    </h2>
                                </div>
                                <button
                                    onClick={() => setShowAlertModal(false)}
                                    className="w-8 h-8 flex items-center justify-center border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
                                {language === "ar"
                                    ? "سيتم حفظ إعدادات الماسح الحالية وتشغيلها يومياً. عند ظهور نتائج جديدة سيتم إرسال تنبيه إلى تليجرام."
                                    : "Your current scanner settings will be saved and run daily. New matches will be sent as a Telegram alert."}
                            </p>

                            <div>
                                <label className="block text-xs font-black text-black dark:text-white uppercase tracking-widest mb-2">
                                    {language === "ar" ? "اسم التنبيه" : "Alert Name"}
                                </label>
                                <input
                                    type="text"
                                    value={alertName}
                                    onChange={(e) => { setAlertName(e.target.value); setAlertSaveError(""); }}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveAlert(); }}
                                    placeholder={language === "ar" ? "مثال: أسهم oversold" : "e.g. Oversold stocks"}
                                    className="w-full h-12 px-4 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 text-black dark:text-white font-bold text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]"
                                    autoFocus
                                />
                                {alertSaveError && (
                                    <p className="mt-2 text-xs font-bold text-red-500">{alertSaveError}</p>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowAlertModal(false)}
                                    className="flex-1 h-12 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white font-black text-sm uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                                >
                                    {language === "ar" ? "إلغاء" : "Cancel"}
                                </button>
                                <button
                                    onClick={handleSaveAlert}
                                    disabled={alertSending || !alertName.trim()}
                                    className="flex-1 h-12 border-4 border-black dark:border-white bg-amber-400 text-black font-black text-sm uppercase tracking-widest hover:bg-amber-300 transition-colors shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {alertSending ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Save className="w-4 h-4" />
                                    )}
                                    {language === "ar" ? "حفظ" : "Save"}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )
                : null}
        </div>
    );
}
