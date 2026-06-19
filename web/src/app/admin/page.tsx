"use client";

import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAppState } from "@/contexts/AppStateContext";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { getCountries, searchSymbols, type SymbolResult } from "@/lib/api";
import { Loader2, ShieldOff, Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { Toaster, toast } from "sonner";

import CountrySelectDialog from "@/components/CountrySelectDialog";
import AdminHeader from "./components/AdminHeader";
import DataManagerTab from "./components/DataManagerTab";
import AIAutomationTab from "./components/AIAutomationTab";
import BacktestTab from "./components/BacktestTab";
import SymbolDrillDownModal from "./components/SymbolDrillDownModal";
import RecalculateDialog from "./components/RecalculateDialog";
import LiveBotTab from "./components/LiveBotTab";
import ScheduleTab from "./components/ScheduleTab";
import HistoricalSimilarityTab from "./components/HistoricalSimilarityTab";
import DailyJobsTab from "./components/DailyJobsTab";
import UsersTab from "./components/UsersTab";
import ArticlesTab from "./components/ArticlesTab";

const SESSION_KEY = "admin_unlocked_v1";

export default function AdminPage() {
    const { language } = useLanguage();
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // ─── Password Gate State (MUST be before any conditional return) ──────────
    const [unlocked, setUnlocked] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [checking, setChecking] = useState(false);
    const [wrongPassword, setWrongPassword] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // ─── Admin Page State (always declared, regardless of unlocked status) ────
    const [countries, setCountries] = useState<string[]>([]);
    const [countriesLoading, setCountriesLoading] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState("Egypt");
    const [countryDialogOpen, setCountryDialogOpen] = useState(false);
    const [symbols, setSymbols] = useState<SymbolResult[]>([]);
    const [loadingSymbols, setLoadingSymbols] = useState(false);
    const [symbolsQuery, setSymbolsQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(100);
    const [activeMainTab, setActiveMainTab] = useState<"data" | "ai" | "backtest" | "bot" | "schedule" | "similarity" | "jobs" | "users" | "articles">("data");
    const [dataSourcesTab, setDataSourcesTab] = useState<"prices" | "funds">("prices");
    const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState<{ current: number, total: number, lastMsg: string } | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [maxPriceDays, setMaxPriceDays] = useState(365);
    const [updateFundamentals, setUpdateFundamentals] = useState(false);
    const [previewTicker, setPreviewTicker] = useState<string | null>(null);
    const [fundPreview, setFundPreview] = useState<any | null>(null);
    const [loadingFundPreview, setLoadingFundPreview] = useState(false);
    const [syncLogs, setSyncLogs] = useState<any[]>([]);
    const [dbInventory, setDbInventory] = useState<any[]>([]);
    const [loadingInventory, setLoadingInventory] = useState(false);
    const [dbSearch, setDbSearch] = useState("");
    const [selectedDbEx, setSelectedDbEx] = useState<string | null>(null);
    const [drillDownMode, setDrillDownMode] = useState<'prices' | 'fundamentals' | 'intraday' | null>(null);
    const [autoSelectPending, setAutoSelectPending] = useState<string | null>(null);
    const [dbSymbols, setDbSymbols] = useState<any[]>([]);
    const [selectedDrillSymbols, setSelectedDrillSymbols] = useState<Set<string>>(new Set());
    const [loadingDbSymbols, setLoadingDbSymbols] = useState(false);
    const [dbSymbolsSort, setDbSymbolsSort] = useState<{ key: string, dir: 'asc' | 'desc' }>({ key: 'symbol', dir: 'asc' });
    const [recentDbFunds, setRecentDbFunds] = useState<any[]>([]);
    const [loadingRecentFunds, setLoadingRecentFunds] = useState(false);
    const [showEmptyExchanges, setShowEmptyExchanges] = useState(false);
    const [recalculatingIndicators, setRecalculatingIndicators] = useState(false);
    const [recalcDialogOpen, setRecalcDialogOpen] = useState(false);
    const [recalcExchange, setRecalcExchange] = useState<string | null>(null);
    const [recalcSearch, setRecalcSearch] = useState("");
    const [recalcResults, setRecalcResults] = useState<any[]>([]);
    const [selectedRecalcSymbols, setSelectedRecalcSymbols] = useState<Set<string>>(new Set());
    const [loadingRecalcResults, setLoadingRecalcResults] = useState(false);
    const [trainedModels, setTrainedModels] = useState<any[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [isTraining, setIsTraining] = useState(false);
    const [trainingExchange, setTrainingExchange] = useState("");
    const [isExchangeDropdownOpen, setIsExchangeDropdownOpen] = useState(false);
    const [updatingInventory, setUpdatingInventory] = useState(false);
    const [config, setConfig] = useState<{ priceSource: string; fundSource: string; maxWorkers: number }>({
        priceSource: "eodhd",
        fundSource: "tradingview",
        maxWorkers: 8,
    });

    // ─── All useEffects (always called, before any conditional return) ────────

    // Check sessionStorage on mount
    useEffect(() => {
        if (typeof window !== "undefined") {
            if (sessionStorage.getItem(SESSION_KEY) === "1") setUnlocked(true);
        }
    }, []);

    // Redirect to login if not logged in
    useEffect(() => {
        if (!authLoading && !user) router.replace("/login");
    }, [authLoading, user, router]);

    // Load countries
    useEffect(() => {
        if (!unlocked) return;
        setCountriesLoading(true);
        getCountries("local").then(setCountries).finally(() => setCountriesLoading(false));
    }, [unlocked]);

    // Country guard
    useEffect(() => {
        if (countries.length > 0 && !countries.includes(selectedCountry)) {
            setSelectedCountry(countries.includes("Egypt") ? "Egypt" : countries[0]);
        }
    }, [countries]);

    // Initial data fetches (only when unlocked)
    useEffect(() => {
        if (!unlocked) return;
        // Sync history
        fetch("/api/admin/sync-history")
            .then(async (res) => res.ok ? res.json().catch(() => []) : [])
            .then((data) => { if (Array.isArray(data)) setSyncLogs(data); else setSyncLogs([]); })
            .catch(() => setSyncLogs([]));
        // Inventory
        setLoadingInventory(true);
        fetch("/api/admin/db-inventory")
            .then(async (res) => res.ok ? res.json().catch(() => []) : [])
            .then((data) => { if (Array.isArray(data)) setDbInventory(data); else setDbInventory([]); })
            .catch(() => setDbInventory([]))
            .finally(() => setLoadingInventory(false));
        // Recent funds
        setLoadingRecentFunds(true);
        fetch("/api/admin/recent-fundamentals")
            .then(async (res) => res.ok ? res.json().catch(() => []) : [])
            .then((data) => { if (Array.isArray(data)) setRecentDbFunds(data); else setRecentDbFunds([]); })
            .catch(() => setRecentDbFunds([]))
            .finally(() => setLoadingRecentFunds(false));
        // Models
        setLoadingModels(true);
        fetch("/api/admin/train/models")
            .then(async (res) => res.ok ? res.json().catch(() => null) : null)
            .then((data) => { setTrainedModels(data?.models && Array.isArray(data.models) ? data.models : []); })
            .catch(() => setTrainedModels([]))
            .finally(() => setLoadingModels(false));
        // Config
        fetch("/api/admin/config")
            .then(async (res) => res.ok ? res.json().catch(() => null) : null)
            .then((c) => {
                if (!c) return;
                let priceSource = c?.priceSource ?? c?.source ?? "eodhd";
                let fundSource = c?.fundSource ?? "tradingview";
                const maxWorkers = typeof c?.maxWorkers === "number" && c.maxWorkers > 0 ? c.maxWorkers : 8;
                if (priceSource === "cache") priceSource = "tradingview";
                if (fundSource === "auto" || fundSource === "eodhd") fundSource = "tradingview";
                setConfig({ priceSource, fundSource, maxWorkers });
            })
            .catch(console.error);
    }, [unlocked]);

    // Sync updateFundamentals with tab
    useEffect(() => {
        setUpdateFundamentals(dataSourcesTab === "funds");
    }, [dataSourcesTab]);

    // Load symbols when country changes (only when unlocked)
    useEffect(() => {
        if (!selectedCountry || !unlocked) return;
        setLoadingSymbols(true);
        searchSymbols("", selectedCountry, 100000, undefined, "local")
            .then(res => { setSymbols(res); setSelectedSymbols(new Set()); })
            .catch(console.error)
            .finally(() => setLoadingSymbols(false));
    }, [selectedCountry, unlocked]);

    // Reset page on search or country change
    useEffect(() => { setCurrentPage(1); }, [selectedCountry, symbolsQuery, pageSize]);

    // Auto-select missing symbols
    useEffect(() => {
        if (!autoSelectPending || loadingSymbols || loadingDbSymbols) return;
        const inDbSet = new Set(dbSymbols.map(s => s.symbol));
        const missing = symbols.filter(s => s.exchange === autoSelectPending && !inDbSet.has(s.symbol));
        if (missing.length > 0) {
            const newSelected = new Set(selectedSymbols);
            missing.forEach(s => { newSelected.add(s.exchange ? `${s.symbol}.${s.exchange}` : s.symbol); });
            setSelectedSymbols(newSelected);
            toast.info(`Auto-selected ${missing.length} missing symbols for ${autoSelectPending}`);
        } else {
            toast.success(`All symbols for ${autoSelectPending} are already in database`);
        }
        setAutoSelectPending(null);
    }, [symbols, dbSymbols, autoSelectPending, loadingSymbols, loadingDbSymbols]);

    // Fund preview
    useEffect(() => {
        if (!previewTicker) { setFundPreview(null); return; }
        const ac = new AbortController();
        setLoadingFundPreview(true);
        fetch(`/api/admin/fundamentals/${encodeURIComponent(previewTicker)}?source=${encodeURIComponent(config.fundSource)}`, { signal: ac.signal })
            .then((res) => res.json())
            .then(setFundPreview)
            .catch((err) => { if (err?.name !== "AbortError") console.error(err); })
            .finally(() => setLoadingFundPreview(false));
        return () => ac.abort();
    }, [previewTicker, config.fundSource]);

    // ─── Handlers ────────────────────────────────────────────────────────────

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!passwordInput.trim()) return;
        setChecking(true);
        setWrongPassword(false);
        try {
            const res = await fetch("/api/admin-unlock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: passwordInput }),
            });
            if (res.ok) {
                sessionStorage.setItem(SESSION_KEY, "1");
                setUnlocked(true);
            } else {
                setWrongPassword(true);
                setPasswordInput("");
                setTimeout(() => inputRef.current?.focus(), 100);
            }
        } catch {
            setWrongPassword(true);
        } finally {
            setChecking(false);
        }
    };

    const fetchInventory = () => {
        setLoadingInventory(true);
        fetch("/api/admin/db-inventory")
            .then(async (res) => res.ok ? res.json().catch(() => []) : [])
            .then((data) => { if (Array.isArray(data)) setDbInventory(data); else setDbInventory([]); })
            .catch(() => setDbInventory([]))
            .finally(() => setLoadingInventory(false));
    };

    const fetchRecentDbFunds = async () => {
        setLoadingRecentFunds(true);
        try {
            const res = await fetch("/api/admin/recent-fundamentals");
            if (!res.ok) { setRecentDbFunds([]); return; }
            const data = await res.json().catch(() => []);
            setRecentDbFunds(Array.isArray(data) ? data : []);
        } catch { setRecentDbFunds([]); } finally { setLoadingRecentFunds(false); }
    };

    const fetchTrainedModels = async () => {
        setLoadingModels(true);
        try {
            const res = await fetch("/api/admin/train/models");
            if (!res.ok) { setTrainedModels([]); return; }
            const data = await res.json().catch(() => null);
            setTrainedModels(data?.models && Array.isArray(data.models) ? data.models : []);
        } catch { setTrainedModels([]); } finally { setLoadingModels(false); }
    };

    const fetchDbSymbols = (ex: string, mode: 'prices' | 'fundamentals' | 'intraday' = 'prices') => {
        setLoadingDbSymbols(true);
        setSelectedDrillSymbols(new Set());
        fetch(`/api/admin/db-symbols/${ex}?mode=${mode}`)
            .then(async (res) => res.ok ? res.json().catch(() => []) : [])
            .then((data) => { if (Array.isArray(data)) setDbSymbols(data); else setDbSymbols([]); })
            .catch(() => setDbSymbols([]))
            .finally(() => setLoadingDbSymbols(false));
    };

    const handleDownloadCsv = (exchange: string, symbol?: string) => {
        const mode = drillDownMode === 'fundamentals' ? 'export-fundamentals' : drillDownMode === 'intraday' ? 'export-intraday' : 'export-prices';
        window.open(`/api/admin/${mode}/${exchange}${symbol ? `?symbol=${symbol}` : ""}`, "_blank");
    };

    const toggleSelect = (s: SymbolResult) => {
        const id = s.exchange ? `${s.symbol}.${s.exchange}` : s.symbol;
        setPreviewTicker(id);
        const next = new Set(selectedSymbols);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedSymbols(next);
    };

    const toggleSelectAll = () => {
        const filteredIds = filteredSymbols.map(s => s.exchange ? `${s.symbol}.${s.exchange}` : s.symbol);
        const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSymbols.has(id));
        if (allSelected) {
            const next = new Set(selectedSymbols);
            filteredIds.forEach((id) => next.delete(id));
            setSelectedSymbols(next);
            return;
        }
        const next = new Set(selectedSymbols);
        filteredIds.forEach((id) => next.add(id));
        setSelectedSymbols(next);
    };

    const setPriceSource = async (priceSource: string) => {
        try {
            const res = await fetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceSource }) });
            if (res.ok) { setConfig((prev) => ({ ...prev, priceSource })); toast.success(`Price source: ${priceSource.toUpperCase()}`); }
            else { const err = await res.json().catch(() => null); toast.error(err?.detail || "Failed to update price source"); }
        } catch { toast.error("Failed to update price source"); }
    };

    const setFundSource = async (fundSource: string) => {
        try {
            const res = await fetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fundSource }) });
            if (res.ok) { setConfig((prev) => ({ ...prev, fundSource })); toast.success(`Fund source: ${fundSource.toUpperCase()}`); }
            else { const err = await res.json().catch(() => null); toast.error(err?.detail || "Failed to update fund source"); }
        } catch { toast.error("Failed to update fund source"); }
    };

    const setMaxWorkers = async (maxWorkers: number) => {
        const safe = Number.isFinite(maxWorkers) && maxWorkers > 0 ? Math.floor(maxWorkers) : 8;
        try {
            const res = await fetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxWorkers: safe }) });
            if (res.ok) { setConfig((prev) => ({ ...prev, maxWorkers: safe })); toast.success(`Workers: ${safe}`); }
            else { const err = await res.json().catch(() => null); toast.error(err?.detail || "Failed to update workers"); }
        } catch { toast.error("Failed to update workers"); }
    };

    const runInventoryUpdate = async (country?: string) => {
        setUpdatingInventory(true);
        const tid = toast.loading(country ? `Updating ${country} symbols...` : "Updating global symbols inventory...");
        try {
            const url = country ? `/api/admin/update-symbols-inventory?country=${encodeURIComponent(country)}` : "/api/admin/update-symbols-inventory";
            const res = await fetch(url, { method: "POST" });
            if (!res.ok) throw new Error("API error");
            toast.success("Inventory update started in background", { id: tid });
            setTimeout(() => { getCountries("local").then(setCountries); }, 5000);
        } catch { toast.error("Failed to start inventory update", { id: tid }); } finally { setUpdatingInventory(false); }
    };

    const runUpdate = async () => {
        if (selectedSymbols.size === 0) return;
        setProcessing(true); setLogs([]);
        const queue = Array.from(selectedSymbols);
        const total = queue.length;
        const BATCH_SIZE = 5;
        let processed = 0;
        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = queue.slice(i, i + BATCH_SIZE);
            try {
                const res = await fetch("/api/admin/update_batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: batch, country: selectedCountry, updatePrices: dataSourcesTab === "prices", updateFundamentals, maxPriceDays }) });
                const data = await res.json();
                if (data.results) {
                    const msgs = data.results.map((r: any) => `${r.symbol}: ${r.success ? "OK" : "ERR"} - ${r.message}${r.fund?.source ? ` | FundSource: ${r.fund.source}` : ""}${r.fund?.data && (r.fund.data.marketCap ?? r.fund.data.peRatio ?? r.fund.data.eps ?? r.fund.data.dividendYield) != null ? ` | MC:${r.fund.data.marketCap ?? "-"} PE:${r.fund.data.peRatio ?? "-"} EPS:${r.fund.data.eps ?? "-"} DY:${r.fund.data.dividendYield ?? "-"}` : ""}`);
                    setLogs(prev => [...prev, ...msgs]);
                    setProgress({ current: Math.min(i + BATCH_SIZE, total), total, lastMsg: msgs[msgs.length - 1] });
                }
            } catch (e) { console.error(e); setLogs(prev => [...prev, `Batch failed: ${e}`]); }
            processed += batch.length;
        }
        setProcessing(false);
        toast.success("Update Complete!", { description: `Processed ${processed} symbols successfully.` });
    };

    const handleRecalculateIndicators = async (exchange: string, symbolsOverride?: string[]) => {
        const finalSymbols = symbolsOverride || [];
        const isExchangeWide = !symbolsOverride || symbolsOverride.length === 0;
        setRecalculatingIndicators(true);
        try {
            const res = await fetch("/api/admin/recalculate-indicators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: finalSymbols, exchange }) });
            if (res.ok) { const data = await res.json(); toast.success(isExchangeWide ? "Exchange Recalculation Started" : "Bulk Recalculation Started", { description: data.message || "Indicators are being recalculated in the background." }); }
            else { const err = await res.json().catch(() => null); toast.error(err?.detail || "Failed to start recalculation"); }
        } catch { toast.error("Connection error"); } finally { setRecalculatingIndicators(false); }
    };

    const handleDownloadModel = async (filename: string) => {
        try {
            const res = await fetch(`/api/admin/train/download/${filename}`);
            const data = await res.json();
            if (data.url) window.open(data.url, "_blank");
            else toast.error("Failed to get download URL");
        } catch { toast.error("Failed to download model"); }
    };

    const filteredSymbols = (() => {
        const q = symbolsQuery.trim().toLowerCase();
        if (!q) return symbols;
        return symbols.filter((s) => {
            const id = (s.exchange ? `${s.symbol}.${s.exchange}` : s.symbol).toLowerCase();
            return id.includes(q) || (s.name || "").toLowerCase().includes(q);
        });
    })();

    const paginatedSymbols = (() => {
        const start = (currentPage - 1) * pageSize;
        return filteredSymbols.slice(start, start + pageSize);
    })();

    const totalPages = Math.ceil(filteredSymbols.length / pageSize);

    // ─── Conditional renders AFTER all hooks ─────────────────────────────────

    if (authLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
            </div>
        );
    }

    if (!user) return null;

    // Password Gate
    if (!unlocked) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/8 rounded-full blur-[120px] pointer-events-none" />
                <form onSubmit={handleUnlock} className="relative w-full max-w-sm">
                    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-950/90 backdrop-blur-2xl p-8 shadow-2xl shadow-black/60 space-y-7">
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                                <KeyRound className="w-8 h-8 text-indigo-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-black text-white tracking-tight">
                                    {language === "ar" ? "لوحة تحكم الأدمن" : "Admin Panel"}
                                </h1>
                                <p className="text-xs text-zinc-500 font-semibold mt-1">
                                    {language === "ar" ? "أدخل كلمة المرور للمتابعة" : "Enter the admin password to continue"}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                {language === "ar" ? "كلمة المرور" : "Password"}
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                                <input
                                    ref={inputRef}
                                    type={showPassword ? "text" : "password"}
                                    value={passwordInput}
                                    onChange={(e) => { setPasswordInput(e.target.value); setWrongPassword(false); }}
                                    autoFocus
                                    placeholder="••••••••••"
                                    className={`h-12 w-full rounded-xl border bg-zinc-900/60 pl-10 pr-11 text-sm font-semibold text-white outline-none transition-all ${wrongPassword ? "border-red-500/50 ring-1 ring-red-500/30" : "border-zinc-800 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20"}`}
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors">
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {wrongPassword && (
                                <p className="text-xs text-red-400 font-semibold flex items-center gap-1.5">
                                    <ShieldOff className="w-3.5 h-3.5" />
                                    {language === "ar" ? "كلمة المرور غير صحيحة" : "Incorrect password"}
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={checking || !passwordInput.trim()}
                            className="h-12 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-sm font-black text-white uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {checking && <Loader2 className="w-4 h-4 animate-spin" />}
                            {language === "ar" ? "دخول" : "Unlock"}
                        </button>

                        <p className="text-center text-[10px] text-zinc-600 font-mono">{user.email}</p>
                    </div>
                </form>
            </div>
        );
    }

    // ─── Full Admin Panel ─────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-black text-zinc-100 flex flex-col selection:bg-indigo-500/30 pt-0">
            <AdminHeader activeMainTab={activeMainTab} setActiveMainTab={setActiveMainTab} />

            <main className="flex-1 w-full overflow-y-auto relative">
                {activeMainTab === "data" ? (
                    <DataManagerTab
                        selectedCountry={selectedCountry}
                        setCountryDialogOpen={setCountryDialogOpen}
                        processing={processing}
                        updatingInventory={updatingInventory}
                        runInventoryUpdate={runInventoryUpdate}
                        dataSourcesTab={dataSourcesTab}
                        setDataSourcesTab={setDataSourcesTab}
                        config={config}
                        setPriceSource={setPriceSource}
                        setFundSource={setFundSource}
                        maxPriceDays={maxPriceDays}
                        setMaxPriceDays={setMaxPriceDays}
                        selectedSymbols={selectedSymbols}
                        runUpdate={runUpdate}
                        progress={progress}
                        logs={logs}
                        setLogs={setLogs}
                        filteredSymbols={filteredSymbols}
                        loadingSymbols={loadingSymbols}
                        toggleSelectAll={toggleSelectAll}
                        symbolsQuery={symbolsQuery}
                        setSymbolsQuery={setSymbolsQuery}
                        paginatedSymbols={paginatedSymbols}
                        toggleSelect={toggleSelect}
                        pageSize={pageSize}
                        setPageSize={setPageSize}
                        currentPage={currentPage}
                        setCurrentPage={setCurrentPage}
                        totalPages={totalPages}
                        setRecalcDialogOpen={setRecalcDialogOpen}
                        recalculatingIndicators={recalculatingIndicators}
                        fetchRecentDbFunds={fetchRecentDbFunds}
                        fetchInventory={fetchInventory}
                        loadingRecentFunds={loadingRecentFunds}
                        dbInventory={dbInventory}
                        showEmptyExchanges={showEmptyExchanges}
                        setShowEmptyExchanges={setShowEmptyExchanges}
                        setSelectedDbEx={setSelectedDbEx}
                        setDrillDownMode={setDrillDownMode}
                        fetchDbSymbols={fetchDbSymbols}
                        setSelectedCountry={setSelectedCountry}
                        setAutoSelectPending={setAutoSelectPending}
                        setActiveMainTab={setActiveMainTab}
                        loadingInventory={loadingInventory}
                        setMaxWorkers={setMaxWorkers}
                        setConfig={setConfig}
                    />
                ) : activeMainTab === "ai" ? (
                    <AIAutomationTab
                        dbInventory={dbInventory}
                        trainingExchange={trainingExchange}
                        setTrainingExchange={setTrainingExchange}
                        isExchangeDropdownOpen={isExchangeDropdownOpen}
                        setIsExchangeDropdownOpen={setIsExchangeDropdownOpen}
                        isTraining={isTraining}
                        fetchTrainedModels={fetchTrainedModels}
                        loadingModels={loadingModels}
                        trainedModels={trainedModels}
                        handleDownloadModel={handleDownloadModel}
                        setIsTraining={setIsTraining}
                    />
                ) : activeMainTab === "backtest" ? (
                    <BacktestTab />
                ) : activeMainTab === "bot" ? (
                    <LiveBotTab />
                ) : activeMainTab === "jobs" ? (
                    <DailyJobsTab />
                ) : activeMainTab === "schedule" ? (
                    <ScheduleTab />
                ) : activeMainTab === "similarity" ? (
                    <HistoricalSimilarityTab dbInventory={dbInventory} />
                ) : activeMainTab === "users" ? (
                    <UsersTab />
                ) : activeMainTab === "articles" ? (
                    <ArticlesTab />
                ) : (
                    <div className="flex items-center justify-center h-full text-zinc-500">
                        Select a tab to view content
                    </div>
                )}
            </main>

            <CountrySelectDialog
                open={countryDialogOpen}
                onClose={() => setCountryDialogOpen(false)}
                onSelect={setSelectedCountry}
                countries={countries}
                selectedCountry={selectedCountry}
                forcedAdmin={true}
            />

            {selectedDbEx && (
                <SymbolDrillDownModal
                    selectedDbEx={selectedDbEx}
                    drillDownMode={drillDownMode}
                    dbSymbols={dbSymbols}
                    localSymbols={symbols}
                    loadingLocalSymbols={loadingSymbols}
                    loadingDbSymbols={loadingDbSymbols}
                    dbSymbolsSort={dbSymbolsSort}
                    setDbSymbolsSort={setDbSymbolsSort}
                    selectedDrillSymbols={selectedDrillSymbols}
                    setSelectedDrillSymbols={setSelectedDrillSymbols}
                    handleDownloadCsv={handleDownloadCsv}
                    setSelectedDbEx={setSelectedDbEx}
                    setDbSymbols={setDbSymbols}
                    setDrillDownMode={setDrillDownMode}
                    handleRecalculateIndicators={handleRecalculateIndicators}
                    selectedSymbols={selectedSymbols}
                    setSelectedSymbols={setSelectedSymbols}
                    setActiveMainTab={setActiveMainTab}
                />
            )}

            <RecalculateDialog
                open={recalcDialogOpen}
                onClose={() => setRecalcDialogOpen(false)}
                exchanges={dbInventory.filter(i => i.priceCount > 0).map(i => ({ exchange: i.exchange, country: i.country, count: i.priceCount }))}
                onRun={(exchange) => { handleRecalculateIndicators(exchange); setRecalcDialogOpen(false); }}
                recalculating={recalculatingIndicators}
            />

            <Toaster theme="dark" position="bottom-right" />
        </div>
    );
}
