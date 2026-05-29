"use client";

import { useState, useEffect, useMemo } from "react";
import { Sliders, Search, Loader2, Globe, Database, TrendingUp, X, Filter, Bookmark, BookmarkCheck, ArrowLeftRight, ChevronLeft, ChevronRight, BarChart3, PieChart, Landmark, Coins, Scale, Percent, Minus, Plus, Info, LayoutTemplate, Settings2, Bell, BellRing, Trash, Check, AlertCircle } from "lucide-react";
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

    // Filtered Results memo
    const filteredResults = useMemo(() => {
        let res = [...results];
        if (searchTerm) {
            const low = searchTerm.toLowerCase();
            res = res.filter(r => r.symbol.toLowerCase().includes(low) || r.name.toLowerCase().includes(low));
        }
        return res;
    }, [searchTerm, results]);

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

    // Reset all scanner filters
    const handleResetFilters = () => {
        setTechScanner(prev => ({
            ...prev,
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
        }));
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
            ai_growth: { useAiFilter: true, minAiPrecision: "0.65", aboveEma50: true },
            macd_cross: { goldenCross: true, aboveEma50: true },
            rsi_oversold: { rsiMax: "30" },
            volume_breakout: { volumeAboveSma20: true },
            sma_200_breakout: { aboveEma200: true },
        };

        setTechScanner(prev => ({ ...prev, ...baseUpdate, ...presets[id] }));
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

    // Filter Dropdown Component
    function FilterDropdown({ label, value, active, onClick }: { label: string; value: string; active?: boolean; onClick: () => void }) {
        return (
            <button
                onClick={onClick}
                className={`
                    h-8 sm:h-10 px-2.5 sm:px-4 rounded-lg sm:rounded-xl border flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-bold transition-all shrink-0 active:scale-95
                    ${active
                        ? "bg-blue-600/10 border-blue-500/30 text-blue-400"
                        : "bg-zinc-900/50 border-white/10 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-white/20"}
                `}
            >
                <span className="opacity-70">{label}</span>
                <span className="font-black">{value}</span>
            </button>
        );
    }

    return (
        <div className="flex flex-col gap-0 relative min-h-[calc(100vh-100px)] bg-black/20 rounded-2xl sm:rounded-3xl overflow-hidden border border-white/5">
            {/* --- TradingView-Style Header --- */}
            <div className="flex flex-col gap-1 px-4 py-3 sm:p-6 sm:pb-4 border-b border-white/5 bg-zinc-950/40 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight">Technical Stock Screener</h1>
                    {loading && <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-blue-500" />}
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-zinc-600 font-bold">Egyptian Stock Exchange (EGX)</span>
                    {scannedCount > 0 && (
                        <span className="text-zinc-500 text-xs">
                             · {filteredResults.length} of {scannedCount} scanned
                        </span>
                    )}
                </div>
            </div>

            <div className="px-4 pt-4 sm:px-6 sm:pt-6">
                <ScannerTemplates onSelect={applyTemplate} />
            </div>

            {/* --- Inline Filter Bar --- */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-4 border-b border-white/5 bg-zinc-950/20 relative z-30">
                {/* Market (Locked) */}
                <div className="h-8 sm:h-10 flex items-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-xl border border-white/10 bg-zinc-900/50 px-3 sm:px-4 text-xs sm:text-sm font-bold text-zinc-200 select-none shrink-0">
                    <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-500" />
                    <span className="tracking-wide">Egypt (EGX)</span>
                </div>

                {/* Price Filter */}
                <div className="relative">
                    <FilterDropdown
                        label="Min Price"
                        value={minPrice ? `>= ${minPrice} EGP` : "Any"}
                        active={!!minPrice}
                        onClick={() => setActiveFilterPopover(activeFilterPopover === 'price' ? null : 'price')}
                    />
                    {activeFilterPopover === 'price' && (
                        <div className="absolute top-full left-0 mt-2 p-4 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-[150] w-64 space-y-3">
                            <h4 className="text-xs font-black uppercase text-zinc-400">Minimum Stock Price</h4>
                            <input
                                type="number"
                                placeholder="Min Price (EGP)"
                                value={minPrice}
                                onChange={(e) => setTechScanner(prev => ({ ...prev, minPrice: e.target.value }))}
                                className="w-full h-9 px-3 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                            />
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setTechScanner(prev => ({ ...prev, minPrice: "" }))}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-white rounded bg-zinc-900 transition-colors"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* RSI Filter */}
                <div className="relative">
                    <FilterDropdown
                        label="RSI"
                        value={rsiMin || rsiMax ? `${rsiMin || 0}-${rsiMax || 100}` : "Any"}
                        active={!!(rsiMin || rsiMax)}
                        onClick={() => setActiveFilterPopover(activeFilterPopover === 'rsi' ? null : 'rsi')}
                    />
                    {activeFilterPopover === 'rsi' && (
                        <div className="absolute top-full left-0 mt-2 p-4 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-[150] w-64 space-y-3">
                            <h4 className="text-xs font-black uppercase text-zinc-400">RSI Range (14)</h4>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    placeholder="Min"
                                    value={rsiMin}
                                    onChange={(e) => setTechScanner(prev => ({ ...prev, rsiMin: e.target.value }))}
                                    className="w-full h-9 px-3 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max"
                                    value={rsiMax}
                                    onChange={(e) => setTechScanner(prev => ({ ...prev, rsiMax: e.target.value }))}
                                    className="w-full h-9 px-3 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setTechScanner(prev => ({ ...prev, rsiMin: "", rsiMax: "" }))}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-white rounded bg-zinc-900 transition-colors"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Market Cap Filter */}
                <div className="relative">
                    <FilterDropdown
                        label="Mkt Cap"
                        value={marketCapMin || marketCapMax ? `${marketCapMin ? formatCompact(Number(marketCapMin)) : '0'}-${marketCapMax ? formatCompact(Number(marketCapMax)) : '∞'}` : "Any"}
                        active={!!(marketCapMin || marketCapMax)}
                        onClick={() => setActiveFilterPopover(activeFilterPopover === 'marketcap' ? null : 'marketcap')}
                    />
                    {activeFilterPopover === 'marketcap' && (
                        <div className="absolute top-full left-0 mt-2 p-4 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-[150] w-64 space-y-3">
                            <h4 className="text-xs font-black uppercase text-zinc-400">Market Cap (EGP)</h4>
                            <div className="flex flex-col gap-2">
                                <input
                                    type="number"
                                    placeholder="Min Cap (e.g. 10000000)"
                                    value={marketCapMin}
                                    onChange={(e) => setTechScanner(prev => ({ ...prev, marketCapMin: e.target.value }))}
                                    className="w-full h-9 px-3 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                                />
                                <input
                                    type="number"
                                    placeholder="Max Cap (e.g. 500000000)"
                                    value={marketCapMax}
                                    onChange={(e) => setTechScanner(prev => ({ ...prev, marketCapMax: e.target.value }))}
                                    className="w-full h-9 px-3 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setTechScanner(prev => ({ ...prev, marketCapMin: "", marketCapMax: "" }))}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-white rounded bg-zinc-900 transition-colors"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sector Filter */}
                <div className="relative">
                    <FilterDropdown
                        label="Sector"
                        value={sector || "All"}
                        active={!!sector}
                        onClick={() => setActiveFilterPopover(activeFilterPopover === 'sector' ? null : 'sector')}
                    />
                    {activeFilterPopover === 'sector' && (
                        <div className="absolute top-full left-0 mt-2 p-4 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-[150] w-64 space-y-3">
                            <h4 className="text-xs font-black uppercase text-zinc-400">EGX Sectors</h4>
                            <select
                                value={sector}
                                onChange={(e) => setTechScanner(prev => ({ ...prev, sector: e.target.value }))}
                                className="w-full h-9 px-2 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500"
                            >
                                <option value="">{language === "ar" ? "كل القطاعات" : "All Sectors"}</option>
                                <option value="Finance">{language === "ar" ? "الخدمات المالية والبنوك" : "Finance / Banking"}</option>
                                <option value="Process Industries">{language === "ar" ? "الصناعات التحويلية" : "Process Industries"}</option>
                                <option value="Consumer Non-Durables">{language === "ar" ? "الأغذية والسلع الاستهلاكية" : "Consumer Non-Durables"}</option>
                                <option value="Health Technology">{language === "ar" ? "الرعاية الصحية والأدوية" : "Health Technology"}</option>
                                <option value="Non-Energy Minerals">{language === "ar" ? "المعادن والتعدين" : "Non-Energy Minerals"}</option>
                                <option value="Industrial Services">{language === "ar" ? "الخدمات الصناعية والإنشاءات" : "Industrial Services"}</option>
                                <option value="Consumer Services">{language === "ar" ? "الخدمات الترفيهية والسياحة" : "Consumer Services"}</option>
                                <option value="Producer Manufacturing">{language === "ar" ? "التصنيع والإنتاج" : "Producer Manufacturing"}</option>
                                <option value="Distribution Services">{language === "ar" ? "التجارة والتوزيع" : "Distribution Services"}</option>
                                <option value="Consumer Durables">{language === "ar" ? "السلع الاستهلاكية المعمرة" : "Consumer Durables"}</option>
                                <option value="Transportation">{language === "ar" ? "الشحن والنقل" : "Transportation"}</option>
                                <option value="Utilities">{language === "ar" ? "المرافق والخدمات العامة" : "Utilities"}</option>
                                <option value="Communications">{language === "ar" ? "الاتصالات والتكنولوجيا" : "Communications"}</option>
                            </select>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setTechScanner(prev => ({ ...prev, sector: "" }))}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-white rounded bg-zinc-900 transition-colors"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Technical Indicators & AI Filter */}
                <div className="relative">
                    <FilterDropdown
                        label="Indicators & AI"
                        value={
                            (aboveEma50 ? "EMA50 " : "") +
                            (aboveEma200 ? "EMA200 " : "") +
                            (goldenCross ? "GoldenCross " : "") +
                            (volumeAboveSma20 ? "VolSpike " : "") +
                            (aboveVwap20 ? "VWAP " : "") +
                            (useAiFilter ? "AI " : "") || "None"
                        }
                        active={aboveEma50 || aboveEma200 || goldenCross || volumeAboveSma20 || aboveVwap20 || useAiFilter}
                        onClick={() => setActiveFilterPopover(activeFilterPopover === 'indicators' ? null : 'indicators')}
                    />
                    {activeFilterPopover === 'indicators' && (
                        <div className="absolute top-full left-0 mt-2 p-5 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-[150] w-72 space-y-4">
                            <h4 className="text-xs font-black uppercase text-zinc-400">Technical & AI Filters</h4>
                            <div className="space-y-2.5 max-h-60 overflow-y-auto no-scrollbar pr-1">
                                <label className="flex items-center gap-3 text-xs font-medium text-zinc-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={aboveEma50}
                                        onChange={(e) => setTechScanner(prev => ({ ...prev, aboveEma50: e.target.checked }))}
                                        className="rounded border-white/10 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                    />
                                    Price &gt; EMA 50
                                </label>
                                <label className="flex items-center gap-3 text-xs font-medium text-zinc-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={aboveEma200}
                                        onChange={(e) => setTechScanner(prev => ({ ...prev, aboveEma200: e.target.checked }))}
                                        className="rounded border-white/10 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                    />
                                    Price &gt; EMA 200
                                </label>
                                <label className="flex items-center gap-3 text-xs font-medium text-zinc-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={goldenCross}
                                        onChange={(e) => setTechScanner(prev => ({ ...prev, goldenCross: e.target.checked }))}
                                        className="rounded border-white/10 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                    />
                                    Golden Cross (50 &gt; 200)
                                </label>
                                <label className="flex items-center gap-3 text-xs font-medium text-zinc-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={volumeAboveSma20}
                                        onChange={(e) => setTechScanner(prev => ({ ...prev, volumeAboveSma20: e.target.checked }))}
                                        className="rounded border-white/10 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                    />
                                    Volume &gt; SMA 20
                                </label>
                                <label className="flex items-center gap-3 text-xs font-medium text-zinc-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={aboveVwap20}
                                        onChange={(e) => setTechScanner(prev => ({ ...prev, aboveVwap20: e.target.checked }))}
                                        className="rounded border-white/10 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                    />
                                    Price &gt; VWAP 20
                                </label>
                                <div className="border-t border-white/5 my-2 pt-2" />
                                <label className="flex items-center gap-3 text-xs font-medium text-zinc-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={useAiFilter}
                                        onChange={(e) => setTechScanner(prev => ({ ...prev, useAiFilter: e.target.checked }))}
                                        className="rounded border-white/10 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 h-4 w-4"
                                    />
                                    Use AI Predictions (Random Forest)
                                </label>
                                {useAiFilter && (
                                    <div className="pl-7 space-y-1">
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Min AI Precision</span>
                                        <input
                                            type="number"
                                            step="0.05"
                                            min="0"
                                            max="1"
                                            value={minAiPrecision}
                                            onChange={(e) => setTechScanner(prev => ({ ...prev, minAiPrecision: e.target.value }))}
                                            className="w-full h-8 px-2 rounded-lg bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setTechScanner(prev => ({
                                        ...prev,
                                        aboveEma50: false,
                                        aboveEma200: false,
                                        goldenCross: false,
                                        volumeAboveSma20: false,
                                        aboveVwap20: false,
                                        useAiFilter: false,
                                        minAiPrecision: "0.6",
                                    }))}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-white rounded bg-zinc-900 transition-colors"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={applyFilter}
                                    className="flex-1 h-8 text-[10px] font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Reset Filters Icon Button */}
                <button
                    onClick={handleResetFilters}
                    className="h-8 sm:h-10 w-8 sm:w-10 flex items-center justify-center rounded-lg sm:rounded-xl border border-white/10 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-white hover:border-white/20 transition-all shrink-0 active:scale-95"
                    title="Reset All Filters"
                >
                    <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </button>

                {/* Alerts Button */}
                {user && (
                    <button
                        onClick={() => {
                            setShowManageAlertsDialog(true);
                            void fetchAlerts();
                            void fetchTelegramChatId();
                        }}
                        className="h-8 sm:h-10 px-3 flex items-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-xl border border-white/10 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-white hover:border-white/20 transition-all shrink-0 active:scale-95 ml-auto"
                        title="Telegram Scan Notifications"
                    >
                        <Bell className="h-4 w-4 text-amber-500" />
                        <span className="hidden xs:inline text-xs font-bold uppercase tracking-wider">Telegram Alerts</span>
                    </button>
                )}
            </div>

            {/* --- Tab Navigation --- */}
            <div className="flex items-center gap-2 px-3 sm:px-6 py-2 sm:py-3 border-b border-white/5 bg-zinc-950/10 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-0.5 sm:gap-1.5 p-0.5 sm:p-1 rounded-xl bg-zinc-900/40 border border-white/5 w-full sm:w-auto">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setTechScanner(prev => ({ ...prev, currentTab: tab.id as any }))}
                            className={`
                                relative h-8 sm:h-9 px-2.5 sm:px-4 flex-1 sm:flex-initial flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-wider sm:tracking-widest transition-all duration-200
                                ${currentTab === tab.id
                                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                                    : "text-zinc-500 hover:text-white hover:bg-white/5 active:scale-95"}
                            `}
                        >
                            <tab.icon className="w-3.5 h-3.5 sm:w-3.5 sm:h-3.5 shrink-0" />
                            <span className="hidden xs:inline sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* --- Results Content --- */}
            <div className="flex-1 flex flex-col min-h-0 relative">
                <div className="flex-1 overflow-auto custom-scrollbar">
                    {loading && results.length === 0 ? (
                        <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-6">
                            <div className="relative">
                                <div className="absolute inset-0 blur-3xl bg-blue-500/20 animate-pulse" />
                                <Loader2 className="h-12 w-12 animate-spin text-blue-500 relative z-10" />
                            </div>
                            <div className="flex flex-col items-center gap-1">
                                <p className="text-sm font-black text-white uppercase tracking-[0.3em] animate-pulse">Scanning Egyptian Market</p>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Applying technical & fundamental filters...</p>
                            </div>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-6 text-zinc-700">
                            <Database className="h-16 w-16 opacity-10" />
                            <div className="text-center space-y-2">
                                <p className="text-lg font-black text-white uppercase tracking-widest opacity-20">No Stocks Found</p>
                                <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Try adjusting your filters</p>
                            </div>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm whitespace-nowrap table-fixed border-collapse">
                            <thead className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-md text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 border-b border-white/10 shadow-xl">
                                <tr>
                                    <th className="w-64 px-8 py-5 text-left border-r border-white/5">Symbol</th>
                                    <th className="w-32 px-6 py-5 text-right">Price</th>
                                    <th className="w-32 px-6 py-5 text-right">Change %</th>
                                    {currentTab === 'overview' && (
                                        <>
                                            <th className="w-32 px-6 py-5 text-right">Volume</th>
                                            <th className="w-32 px-6 py-5 text-right">Mkt Cap</th>
                                            <th className="w-28 px-6 py-5 text-right">P/E</th>
                                            <th className="w-32 px-6 py-5 text-right">EPS</th>
                                            <th className="w-48 px-6 py-5 text-left">Sector</th>
                                        </>
                                    )}
                                    {currentTab === 'performance' && (
                                        <>
                                            <th className="w-32 px-6 py-5 text-center">RSI</th>
                                            <th className="w-32 px-6 py-5 text-right">EMA 50</th>
                                            <th className="w-32 px-6 py-5 text-right">EMA 200</th>
                                            <th className="w-32 px-6 py-5 text-right">Momentum</th>
                                            <th className="w-32 px-6 py-5 text-right">ADX</th>
                                            <th className="w-32 px-6 py-5 text-right">ROC (12)</th>
                                        </>
                                    )}
                                    {currentTab === 'dividends' && (
                                        <>
                                            <th className="w-32 px-6 py-5 text-right">Yield %</th>
                                            <th className="w-48 px-6 py-5 text-left font-mono">Industry</th>
                                        </>
                                    )}
                                    {currentTab === 'valuation' && (
                                        <>
                                            <th className="w-32 px-6 py-5 text-right">Mkt Cap</th>
                                            <th className="w-32 px-6 py-5 text-right">P/E</th>
                                            <th className="w-32 px-6 py-5 text-right">EPS</th>
                                            <th className="w-32 px-6 py-5 text-right">Yield %</th>
                                        </>
                                    )}
                                    {currentTab === 'financials' && (
                                        <>
                                            <th className="w-48 px-6 py-5 text-left">Sector</th>
                                            <th className="w-48 px-6 py-5 text-left">Industry</th>
                                            <th className="w-32 px-6 py-5 text-right">Mkt Cap</th>
                                        </>
                                    )}
                                    <th className="w-20 px-8 py-5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.03]">
                                {pagedResults.map((r) => (
                                    <tr
                                        key={r.symbol}
                                        onClick={() => setTechScanner(prev => ({ ...prev, selectedStock: r }))}
                                        className={`
                                            group transition-all
                                            ${selectedStock?.symbol === r.symbol ? "bg-blue-600/10" : "hover:bg-white/[0.03]"}
                                        `}
                                    >
                                        <td className="px-8 py-4 border-r border-white/5">
                                            <div className="flex items-center gap-4">
                                                <StockLogo symbol={r.symbol} logoUrl={r.logo_url} size="md" />
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-black text-white text-sm group-hover:text-blue-400 transition-colors uppercase tracking-tight">{r.symbol}</span>
                                                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest truncate">{r.name || 'Unknown'}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="font-mono font-black text-zinc-100">{formatNum(r.last_close)}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className={`font-mono font-black ${r.change_p >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                {r.change_p >= 0 ? "+" : ""}{r.change_p.toFixed(2)}%
                                            </span>
                                        </td>
                                        {currentTab === 'overview' && (
                                            <>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-400 text-xs">{formatCompact(r.volume)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-100 font-bold text-xs">{formatCompact(r.market_cap)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-400 text-xs">{formatNum(r.pe_ratio, 1)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-400 text-xs">{formatNum(r.eps, 2)}</td>
                                                <td className="px-6 py-4 text-left">
                                                    <span className="inline-flex px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-black uppercase font-mono text-zinc-500">{r.sector || '-'}</span>
                                                </td>
                                            </>
                                        )}
                                        {currentTab === 'performance' && (
                                            <>
                                                <td className="px-6 py-4 text-center">
                                                    <div className={`
                                                        inline-flex px-2 py-0.5 rounded text-[10px] font-black
                                                        ${r.rsi < 35 ? "bg-emerald-500/10 text-emerald-400" : r.rsi > 65 ? "bg-red-500/10 text-red-400" : "bg-zinc-900 text-zinc-500"}
                                                    `}>{r.rsi.toFixed(0)}</div>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-500 text-xs">{formatNum(r.ema50)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-500 text-xs">{formatNum(r.ema200)}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className={`font-mono font-black text-xs ${r.momentum >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {r.momentum >= 0 ? "+" : ""}{(r.momentum * 100).toFixed(2)}%
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-500 text-xs">{formatNum(r.adx14, 1)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-500 text-xs">{formatNum(r.roc12, 1)}%</td>
                                            </>
                                        )}
                                        {currentTab === 'dividends' && (
                                            <>
                                                <td className="px-6 py-4 text-right font-mono text-blue-400 font-black">{r.dividend_yield ? `${formatNum(r.dividend_yield * 100, 2)}%` : "-"}</td>
                                                <td className="px-6 py-4 text-left font-mono text-zinc-500 text-[10px] uppercase truncate">{r.industry || "-"}</td>
                                            </>
                                        )}
                                        {currentTab === 'valuation' && (
                                            <>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-100 font-bold">{formatCompact(r.market_cap)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-400">{formatNum(r.pe_ratio, 1)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-400">{formatNum(r.eps, 2)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-blue-400">{r.dividend_yield ? `${formatNum(r.dividend_yield * 100, 2)}%` : "-"}</td>
                                            </>
                                        )}
                                        {currentTab === 'financials' && (
                                            <>
                                                <td className="px-6 py-4 text-left">
                                                    <span className="inline-flex px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-black uppercase font-mono text-zinc-400">{r.sector || '-'}</span>
                                                </td>
                                                <td className="px-6 py-4 text-left">
                                                    <span className="inline-flex px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-black uppercase font-mono text-zinc-500">{r.industry || '-'}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-zinc-100 font-bold">{formatCompact(r.market_cap)}</td>
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
                                                className={`p-2 rounded-xl transition-all ${isSaved(r.symbol) ? "text-blue-400 bg-blue-500/10" : "text-zinc-600 hover:text-white hover:bg-zinc-800"}`}
                                            >
                                                {isSaved(r.symbol) ? <BookmarkCheck className="h-4.5 w-4.5" /> : <Bookmark className="h-4.5 w-4.5" />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* --- Pagination Footer --- */}
                {totalPages > 1 && (
                    <div className="px-4 sm:px-8 py-3 sm:py-4 border-t border-white/5 bg-zinc-950/80 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 z-30">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            Page <span className="text-white">{currentPage}</span> / <span className="text-white">{totalPages}</span>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                className="flex-1 sm:flex-initial h-9 sm:h-10 px-4 sm:px-6 rounded-xl border border-white/5 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-20 active:scale-95"
                            >
                                <ChevronLeft className="w-4 h-4" /> Prev
                            </button>
                            <button
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                className="flex-1 sm:flex-initial h-9 sm:h-10 px-4 sm:px-6 rounded-xl border border-white/5 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-20 active:scale-95"
                            >
                                Next <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* --- Detail Slide-over --- */}
                {selectedStock && (
                    <>
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] animate-in fade-in duration-300" onClick={() => setTechScanner(prev => ({ ...prev, selectedStock: null }))} />
                        <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] md:w-[450px] bg-zinc-950 border-l border-white/10 z-[201] animate-in slide-in-from-right duration-500 flex flex-col shadow-[0_0_100px_rgba(0,0,0,0.8)]">
                            <div className="p-4 sm:p-8 pb-3 sm:pb-4 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
                                <div className="flex items-center gap-3 sm:gap-5">
                                    <StockLogo symbol={selectedStock.symbol} logoUrl={selectedStock.logo_url} size="xl" />
                                    <div className="flex flex-col gap-0.5 sm:gap-1">
                                        <h2 className="text-2xl sm:text-4xl font-black text-white font-mono tracking-tighter leading-none">{selectedStock.symbol}</h2>
                                        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-zinc-500 max-w-[180px] sm:max-w-none truncate">{selectedStock.name}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setTechScanner(prev => ({ ...prev, selectedStock: null }))}
                                    className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-zinc-900/50 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all border border-white/5 active:scale-95"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 space-y-6 sm:space-y-10">
                                {/* Key Stats Grid */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-6 bg-zinc-900/40 rounded-3xl border border-white/5 space-y-1 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <TrendingUp className="w-8 h-8 text-blue-500" />
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Price</div>
                                        <div className="text-3xl font-mono font-black text-white">{formatNum(selectedStock.last_close)}</div>
                                        <div className={`text-[11px] font-black ${selectedStock.change_p >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {selectedStock.change_p >= 0 ? "+" : ""}{selectedStock.change_p.toFixed(2)}% Today
                                        </div>
                                    </div>
                                    <div className="p-6 bg-zinc-900/40 rounded-3xl border border-white/5 space-y-1 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Percent className="w-8 h-8 text-purple-500" />
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">RSI (14)</div>
                                        <div className={`text-3xl font-mono font-black ${selectedStock.rsi < 35 ? "text-emerald-400" : selectedStock.rsi > 65 ? "text-red-400" : "text-zinc-100"}`}>
                                            {selectedStock.rsi.toFixed(1)}
                                        </div>
                                        <div className="text-[10px] font-bold uppercase tracking-tighter text-zinc-600">
                                            {selectedStock.rsi < 35 ? "Oversold" : selectedStock.rsi > 65 ? "Overbought" : "Neutral Range"}
                                        </div>
                                    </div>
                                </div>

                                {/* Fundamentals Group */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-[11px] font-black text-white uppercase tracking-[0.3em] border-b border-white/5 pb-4">
                                        <Landmark className="w-4 h-4 text-amber-500" />
                                        Company Profile
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {[
                                            { label: "Market Cap", val: formatCompact(selectedStock.market_cap), icon: Database },
                                            { label: "Sector", val: selectedStock.sector || "-", icon: LayoutTemplate },
                                            { label: "Industry", val: selectedStock.industry || "-", icon: PieChart },
                                            { label: "P/E Ratio", val: formatNum(selectedStock.pe_ratio, 1), icon: Scale },
                                            { label: "Dividend Yield", val: selectedStock.dividend_yield ? `${(selectedStock.dividend_yield * 100).toFixed(2)}%` : "N/A", icon: Coins },
                                            { label: "EPS (TTM)", val: formatNum(selectedStock.eps, 2), icon: Coins },
                                            { label: "Beta", val: formatNum(selectedStock.beta, 2), icon: TrendingUp },
                                        ].map((m) => (
                                            <div key={m.label} className="flex justify-between items-center p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-all">
                                                <div className="flex items-center gap-3">
                                                    <m.icon className="w-3.5 h-3.5 text-zinc-500" />
                                                    <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{m.label}</span>
                                                </div>
                                                <span className="font-mono font-black text-sm text-zinc-200">{m.val}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Technical Analysis Group */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-[11px] font-black text-white uppercase tracking-[0.3em] border-b border-white/5 pb-4">
                                        <BarChart3 className="w-4 h-4 text-blue-500" />
                                        Technical Analysis
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {[
                                            { label: "EMA 50", val: formatNum(selectedStock.ema50) },
                                            { label: "EMA 200", val: formatNum(selectedStock.ema200) },
                                            { label: "Momentum", val: `${(selectedStock.momentum * 100).toFixed(2)}%`, color: selectedStock.momentum >= 0 ? "text-emerald-400" : "text-red-400" },
                                            { label: "ADX (Trend)", val: formatNum(selectedStock.adx14, 1) },
                                            { label: "ROC (Rate of Chg)", val: `${formatNum(selectedStock.roc12, 1)}%` },
                                        ].map((m) => (
                                            <div key={m.label} className="flex justify-between items-center p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                                                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{m.label}</span>
                                                <span className={`font-mono font-black text-sm ${m.color || "text-zinc-200"}`}>{m.val}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 sm:p-8 border-t border-white/5 bg-white/[0.02] flex gap-3 sm:gap-4">
                                <button
                                    onClick={() => addSymbolToCompare(selectedStock.symbol)}
                                    className="flex-1 h-12 sm:h-14 flex items-center justify-center gap-2 sm:gap-3 rounded-xl sm:rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] sm:text-[11px] uppercase tracking-[0.15em] sm:tracking-[0.2em] shadow-2xl shadow-blue-500/20 transition-all group active:scale-[0.98]"
                                >
                                    <ArrowLeftRight className="h-4 w-4 group-hover:rotate-12 transition-transform" />
                                    Compare
                                </button>
                                <button
                                    onClick={() => {
                                        if (isSaved(selectedStock.symbol)) removeSymbolBySymbol(selectedStock.symbol);
                                        else saveSymbol({ symbol: selectedStock.symbol, name: selectedStock.name, source: "tech_scanner", metadata: {} });
                                    }}
                                    className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-xl sm:rounded-2xl border border-white/10 bg-zinc-900 group active:scale-95"
                                >
                                    {isSaved(selectedStock.symbol) ? (
                                        <BookmarkCheck className="h-5 w-5 text-blue-400" />
                                    ) : (
                                        <Bookmark className="h-5 w-5 text-zinc-500 group-hover:text-white" />
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
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[210] animate-in fade-in duration-300" onClick={() => setShowManageAlertsDialog(false)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg p-6 bg-zinc-950 border border-white/10 rounded-3xl z-[211] animate-in zoom-in-95 duration-300 shadow-[0_0_100px_rgba(0,0,0,0.8)] space-y-6">
                        <div className="flex justify-between items-center pb-3 border-b border-white/5">
                            <div className="flex items-center gap-2">
                                <BellRing className="w-5 h-5 text-amber-500" />
                                <h3 className="text-lg font-black text-white uppercase tracking-wider">Telegram Alerts</h3>
                            </div>
                            <button
                                onClick={() => setShowManageAlertsDialog(false)}
                                className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors"
                            >
                                <X className="w-4.5 h-4.5" />
                            </button>
                        </div>

                        {/* Telegram chat ID warning */}
                        {!fetchingTelegramChatId && !telegramChatId && (
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3">
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
                                <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Active Alerts</span>
                                <button
                                    disabled={!telegramChatId}
                                    onClick={() => setShowCreateAlertDialog(true)}
                                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-20 text-[10px] font-black uppercase tracking-wider text-white transition-all flex items-center gap-1 active:scale-95"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Create Alert
                                </button>
                            </div>

                            <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {alertsLoading ? (
                                    <div className="flex justify-center py-8">
                                        <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
                                    </div>
                                ) : alerts.length === 0 ? (
                                    <div className="text-center py-8 text-zinc-600 text-xs font-bold uppercase tracking-widest">
                                        No Technical Alerts Set
                                    </div>
                                ) : (
                                    alerts.map((a) => (
                                        <div key={a.id} className="p-4 rounded-2xl bg-zinc-900/50 border border-white/5 hover:border-white/10 transition-colors flex justify-between items-center">
                                            <div className="space-y-1.5 min-w-0 pr-4">
                                                <h4 className="font-black text-sm text-white font-mono truncate">{a.name}</h4>
                                                <div className="flex flex-wrap gap-1">
                                                    <span className="px-1.5 py-0.5 rounded bg-blue-600/10 border border-blue-500/20 text-[9px] font-mono text-blue-400 uppercase font-black">
                                                        {a.filters.country || "Egypt"}
                                                    </span>
                                                    {Object.entries(a.filters).map(([k, v]) => {
                                                        if (k === "country" || k === "limit" || v === undefined || v === null || v === false) return null;
                                                        return (
                                                            <span key={k} className="px-1.5 py-0.5 rounded bg-zinc-800 border border-white/5 text-[9px] font-mono text-zinc-500 uppercase font-bold">
                                                                {k}: {String(v)}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                {/* Active Toggle Switch */}
                                                <button
                                                    onClick={() => handleToggleAlert(a.id, !a.is_active)}
                                                    className={`
                                                        w-9 h-5 rounded-full p-0.5 transition-all
                                                        ${a.is_active ? "bg-blue-600 flex justify-end" : "bg-zinc-800 flex justify-start"}
                                                    `}
                                                >
                                                    <span className="w-4 h-4 rounded-full bg-white block shadow-md" />
                                                </button>
                                                {/* Delete Alert */}
                                                <button
                                                    onClick={() => handleDeleteAlert(a.id)}
                                                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
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
                    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[220] animate-in fade-in duration-300" onClick={() => setShowCreateAlertDialog(false)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md p-6 bg-zinc-950 border border-white/10 rounded-3xl z-[221] animate-in zoom-in-95 duration-300 shadow-[0_0_100px_rgba(0,0,0,0.8)] space-y-6">
                        <div className="flex justify-between items-center pb-3 border-b border-white/5">
                            <h3 className="text-sm font-black text-white uppercase tracking-wider">Create Telegram Alert</h3>
                            <button
                                onClick={() => setShowCreateAlertDialog(false)}
                                className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Alert Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. RSI Oversold Egyptian Stocks"
                                    value={newAlertName}
                                    onChange={(e) => setNewAlertName(e.target.value)}
                                    className="w-full h-10 px-3 rounded-xl bg-zinc-900 border border-white/10 text-white text-xs focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-2xl space-y-2">
                                <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Active Filters Included:</h4>
                                <div className="space-y-1.5 text-xs text-zinc-400 font-mono">
                                    <div>• Market: <span className="text-white">Egypt (EGX)</span></div>
                                    {minPrice && <div>• Min Price: <span className="text-white">&gt;= {minPrice} EGP</span></div>}
                                    {(rsiMin || rsiMax) && <div>• RSI: <span className="text-white">{rsiMin || 0} - {rsiMax || 100}</span></div>}
                                    {marketCapMin && <div>• Min Market Cap: <span className="text-white">{formatCompact(Number(marketCapMin))} EGP</span></div>}
                                    {marketCapMax && <div>• Max Market Cap: <span className="text-white">{formatCompact(Number(marketCapMax))} EGP</span></div>}
                                    {sector && <div>• Sector: <span className="text-white">{sector}</span></div>}
                                    {aboveEma50 && <div>• Price &gt; EMA 50: <span className="text-white">Yes</span></div>}
                                    {aboveEma200 && <div>• Price &gt; EMA 200: <span className="text-white">Yes</span></div>}
                                    {goldenCross && <div>• Golden Cross (50 &gt; 200): <span className="text-white">Yes</span></div>}
                                    {volumeAboveSma20 && <div>• Vol &gt; SMA 20: <span className="text-white">Yes</span></div>}
                                    {aboveVwap20 && <div>• Price &gt; VWAP 20: <span className="text-white">Yes</span></div>}
                                    {useAiFilter && <div>• AI Predictions: <span className="text-white">Precision &gt;= {minAiPrecision}</span></div>}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowCreateAlertDialog(false)}
                                className="flex-1 h-11 rounded-xl border border-white/5 text-xs font-black uppercase tracking-wider text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateAlert}
                                disabled={savingAlert || !newAlertName.trim()}
                                className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-20 text-xs font-black uppercase tracking-wider text-white transition-all flex items-center justify-center gap-2 active:scale-95"
                            >
                                {savingAlert ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Alert"}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
