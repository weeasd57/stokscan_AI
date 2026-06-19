"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import TradingViewChart from "@/components/TradingViewChartDynamic";
import { getAdaptiveRecommendation, getStockFundamentals, searchSymbols } from "@/lib/api";
import { 
  Loader2, MousePointer, TrendingUp, Minus, Type,
  Trash2, Compass, Landmark, Activity, Sparkles,
  ChevronRight, ChevronLeft, Search, Star,
  ExternalLink, ArrowRightLeft, Plus
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWatchlist } from "@/contexts/WatchlistContext";

function ChartContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLanguage();

  const symbol = searchParams.get("symbol") || "COMI";
  const exchange = searchParams.get("exchange") || "EGX";

  const { user } = useAuth();
  const { watchlist, saveSymbol, removeSymbol, removeSymbolBySymbol, isSaved } = useWatchlist();

  const handleWatchlistToggle = () => {
    if (!user) {
      router.push(`/login?redirect=/chart?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`);
      return;
    }

    if (isSaved(symbol)) {
      removeSymbolBySymbol(symbol);
    } else {
      saveSymbol({
        symbol: symbol.toUpperCase(),
        name: fundamentals?.name || symbol,
        source: "tech_scanner",
        metadata: {
          price: fundamentals?.last_close ?? fundamentals?.close,
          name: fundamentals?.name,
          exchange,
        },
        entryPrice: fundamentals?.last_close ?? fundamentals?.close ?? null,
      });
    }
  };

  // States
  const [activeTool, setActiveTool] = useState<string>("cursor");
  const [fundamentals, setFundamentals] = useState<any>(null);
  const [loadingFunds, setLoadingFunds] = useState<boolean>(false);
  const [adaptiveInfo, setAdaptiveInfo] = useState<any>(null);
  const [loadingAdaptive, setLoadingAdaptive] = useState<boolean>(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState<boolean>(true);
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(320);
  const [isResizingRightSidebar, setIsResizingRightSidebar] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"watchlist" | "details">("details");

  useEffect(() => {
    // Disable body scroll when workspace is active
    document.body.classList.add("overflow-hidden");
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, []);

  useEffect(() => {
    if (!isResizingRightSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(240, Math.min(480, window.innerWidth - e.clientX));
      setRightSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingRightSidebar(false);
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
  }, [isResizingRightSidebar]);

  // Autocomplete / Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Load stock metadata & fundamentals
  useEffect(() => {
    if (!symbol) return;
    setLoadingFunds(true);
    const fullTicker = symbol.includes('.') ? symbol : (exchange ? `${symbol}.${exchange}` : symbol);
    getStockFundamentals(fullTicker)
      .then((data) => {
        setFundamentals(data);
      })
      .catch((err) => {
        console.error("Failed to load stock details:", err);
      })
      .finally(() => {
        setLoadingFunds(false);
      });
  }, [symbol, exchange]);

  useEffect(() => {
    setLoadingAdaptive(true);
    getAdaptiveRecommendation({ exchange })
      .then((data) => setAdaptiveInfo(data))
      .catch((err) => {
        console.error("Failed to load adaptive recommendation:", err);
        setAdaptiveInfo(null);
      })
      .finally(() => setLoadingAdaptive(false));
  }, [exchange]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchSymbols(searchQuery, undefined, 50, undefined, undefined, "EGX");
        setSearchResults(results);
      } catch (err) {
        console.error("Error searching symbols:", err);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const selectSymbol = (sym: string, ex: string) => {
    router.push(`/chart?symbol=${encodeURIComponent(sym)}&exchange=${encodeURIComponent(ex)}`);
  };

  const handleToolClick = (tool: string) => {
    setActiveTool(tool);
  };

  // Helper to format large currencies/market cap
  const formatCompact = (val: any) => {
    if (val === null || val === undefined) return "N/A";
    const num = Number(val);
    if (isNaN(num)) return "N/A";
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      compactDisplay: "short",
    }).format(num);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 page-below-header z-40 bg-[#131722] text-[#d1d4dc] flex overflow-hidden select-none font-sans">
      {/* 1. LEFT TOOLBAR (Drawing tools) */}
      <aside className="w-12 border-r border-[#2a2e39] bg-[#1c2030]/20 flex flex-col items-center py-4 gap-4 shrink-0 z-10 select-none">
        <button
          onClick={() => handleToolClick("cursor")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "cursor" ? "bg-indigo-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Crosshair / Pointer"
        >
          <MousePointer className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Pointer
          </span>
        </button>

        <button
          onClick={() => handleToolClick("trend")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "trend" ? "bg-emerald-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Trend Line"
        >
          <TrendingUp className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Trend Line
          </span>
        </button>

        <button
          onClick={() => handleToolClick("horizontal")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "horizontal" ? "bg-indigo-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Horizontal Support/Resistance Line"
        >
          <Minus className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Horizontal Line (Click Chart)
          </span>
        </button>

        <button
          onClick={() => handleToolClick("text")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "text" ? "bg-indigo-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Text Label"
        >
          <Type className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Text Label (Mock)
          </span>
        </button>

        <button
          onClick={() => handleToolClick("rectangle")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "rectangle" ? "bg-sky-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Rectangle Zone"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="6" width="16" height="12" strokeWidth="2"/>
          </svg>
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Rectangle Zone
          </span>
        </button>

        <button
          onClick={() => handleToolClick("fib")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "fib" ? "bg-amber-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Fibonacci Retracement"
        >
          <Compass className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Fibonacci
          </span>
        </button>

        <button
          onClick={() => handleToolClick("ray")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "ray" ? "bg-orange-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Ray"
        >
          <TrendingUp className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Ray
          </span>
        </button>

        <button
          onClick={() => handleToolClick("extendedLine")}
          className={`p-2 rounded-xl transition-all duration-200 group relative ${
            activeTool === "extendedLine" ? "bg-fuchsia-600 text-white" : "text-[#787b86] hover:text-white hover:bg-zinc-800"
          }`}
          title="Extended Line"
        >
          <ArrowRightLeft className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Extended Line
          </span>
        </button>

        <div className="flex-1" />

        {/* Strategy Tester Button - REMOVED AS PER USER REQUEST */}

        <button
          onClick={() => handleToolClick("trash")}
          className="p-2 rounded-xl text-[#ef5350] hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 group relative"
          title="Clear all drawings"
        >
          <Trash2 className="w-4 h-4" />
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-950 text-[10px] font-bold text-white px-2 py-1 rounded border border-white/5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none uppercase tracking-wider">
            Clear Drawings
          </span>
        </button>
      </aside>

      {/* 2. MAIN CENTER WORKSPACE */}
      <main className="flex-1 min-w-0 h-full bg-[#131722] flex flex-col relative">
        <div className="flex-1 min-h-0 w-full relative">
          <TradingViewChart 
            symbol={symbol} 
            exchange={exchange} 
            theme="dark" 
            activeTool={activeTool}
            onToolDrawComplete={() => setActiveTool("cursor")}
          />
        </div>
      </main>

      {/* 3. RIGHT SIDEBAR (Watchlist & Active Stock Profile) */}
      <button
        onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
        style={{ right: rightSidebarOpen ? rightSidebarWidth - 1 : 0 }}
        className="absolute top-1/2 z-30 -translate-y-1/2 w-5 h-12 rounded-l-xl bg-[#0c0d12] border-l border-y border-[#2a2e39] hover:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white transition-all shadow-xl"
      >
        {rightSidebarOpen ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      {rightSidebarOpen && (
        <aside 
          style={{ width: rightSidebarWidth }} 
          className="border-l border-[#2a2e39] bg-[#0c0d12]/60 backdrop-blur-2xl flex flex-col shrink-0 z-20 h-full relative"
        >
          {/* Resize Handle */}
          <div
            onMouseDown={() => setIsResizingRightSidebar(true)}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-indigo-500/50 hover:w-1.5 transition-all z-30"
          />
          {/* Tab Selector */}
          <div className="flex border-b border-[#2a2e39] h-11">
            <button
              onClick={() => setActiveTab("details")}
              className={`flex-1 text-[10px] font-black uppercase tracking-wider transition-all border-b-2 flex items-center justify-center gap-1.5 ${
                activeTab === "details" ? "border-indigo-500 text-white bg-zinc-900/40" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Symbol Profile
            </button>
            <button
              onClick={() => setActiveTab("watchlist")}
              className={`flex-1 text-[10px] font-black uppercase tracking-wider transition-all border-b-2 flex items-center justify-center gap-1.5 ${
                activeTab === "watchlist" ? "border-indigo-500 text-white bg-zinc-900/40" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Landmark className="w-3.5 h-3.5" />
              Watchlist
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">
            {/* TAB CONTENT: DETAILS */}
            {activeTab === "details" && (
              <div className="space-y-6 animate-fade-in">
                {/* Active stock quick header */}
                <div className="p-4 rounded-2xl border border-white/5 bg-zinc-950/40 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/5 blur-2xl rounded-full" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                        {exchange}
                      </span>
                      <h3 className="text-xl font-black text-white uppercase tracking-tight mt-2">{symbol}</h3>
                      <p className="text-xs text-zinc-400 font-semibold leading-relaxed mt-1">
                        {loadingFunds ? "Loading Profile..." : (fundamentals?.name || symbol)}
                      </p>
                    </div>

                    <button
                      onClick={handleWatchlistToggle}
                      className={`p-2.5 rounded-xl border transition-all duration-200 active:scale-95 flex items-center justify-center shrink-0 mt-1 ${
                        isSaved(symbol)
                          ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/25"
                          : "bg-zinc-900/40 border-white/5 text-zinc-500 hover:text-white hover:bg-zinc-800"
                      }`}
                      title={isSaved(symbol) ? "Remove from Watchlist" : "Add to Watchlist"}
                    >
                      <Star className={`w-4 h-4 ${isSaved(symbol) ? "fill-indigo-400 text-indigo-400" : ""}`} />
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-indigo-500/15 bg-indigo-500/[0.03] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[9px] font-black text-indigo-300 uppercase tracking-widest">Adaptive System</span>
                      <h4 className="text-sm font-black text-white mt-1">Current Model Recommendation</h4>
                    </div>
                    <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                  </div>

                  {loadingAdaptive ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      Loading adaptive state...
                    </div>
                  ) : adaptiveInfo ? (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/5 bg-zinc-900/30 p-3">
                          <div className="text-[8px] font-black uppercase tracking-wider text-zinc-500">Model</div>
                          <div className="mt-1 text-xs font-black text-white break-all">{adaptiveInfo.recommended_model?.replace(".pkl", "")}</div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-zinc-900/30 p-3">
                          <div className="text-[8px] font-black uppercase tracking-wider text-zinc-500">Regime</div>
                          <div className="mt-1 text-xs font-black text-white">{adaptiveInfo.regime}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-semibold text-zinc-400">
                        <span>Confidence</span>
                        <span className="text-white">{(Number(adaptiveInfo.confidence || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="text-[10px] leading-relaxed text-zinc-500">{adaptiveInfo.reason}</div>
                      <button
                        onClick={() => router.push(`/backtest?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`)}
                        className="w-full rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-indigo-300 transition-all hover:bg-indigo-500/15"
                      >
                        Open Strategy Tester
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">Adaptive recommendation is unavailable right now.</div>
                  )}
                </div>

                {/* Company Profile Details */}
                <div className="space-y-4">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider block border-b border-[#2a2e39] pb-1.5">Fundamentals Data</span>
                  
                  {loadingFunds ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {/* Market Cap */}
                      <div className="p-3 rounded-xl border border-white/5 bg-zinc-900/20 flex flex-col gap-1">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">Mkt Cap</span>
                        <span className="font-mono font-bold text-white text-xs mt-0.5">
                          {formatCompact(fundamentals?.marketCap || fundamentals?.MarketCap)}
                        </span>
                      </div>

                      {/* PE Ratio */}
                      <div className="p-3 rounded-xl border border-white/5 bg-zinc-900/20 flex flex-col gap-1">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">P/E Ratio</span>
                        <span className="font-mono font-bold text-white text-xs mt-0.5">
                          {fundamentals?.peRatio || fundamentals?.PERatio || "N/A"}
                        </span>
                      </div>

                      {/* EPS */}
                      <div className="p-3 rounded-xl border border-white/5 bg-zinc-900/20 flex flex-col gap-1">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">EPS</span>
                        <span className="font-mono font-bold text-white text-xs mt-0.5">
                          {fundamentals?.eps || fundamentals?.EPS || "N/A"}
                        </span>
                      </div>

                      {/* Beta */}
                      <div className="p-3 rounded-xl border border-white/5 bg-zinc-900/20 flex flex-col gap-1">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">Beta</span>
                        <span className="font-mono font-bold text-white text-xs mt-0.5">
                          {fundamentals?.beta || fundamentals?.Beta || "N/A"}
                        </span>
                      </div>

                      {/* Dividend Yield */}
                      <div className="p-3 rounded-xl border border-white/5 bg-zinc-900/20 flex flex-col gap-1 col-span-2">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">Dividend Yield</span>
                        <span className="font-mono font-bold text-white text-xs mt-0.5">
                          {fundamentals?.dividendYield !== undefined 
                            ? `${(Number(fundamentals?.dividendYield) * 100).toFixed(2)}%`
                            : (fundamentals?.DividendYield !== undefined ? `${(Number(fundamentals?.DividendYield) * 100).toFixed(2)}%` : "N/A")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Classification info */}
                {!loadingFunds && fundamentals && (
                  <div className="space-y-3">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider block border-b border-[#2a2e39] pb-1.5">Categorization</span>
                    <div className="space-y-2 text-xs font-semibold">
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-zinc-500">Sector:</span>
                        <span className="text-zinc-300 text-right">{fundamentals?.sector || "N/A"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-zinc-500">Industry:</span>
                        <span className="text-zinc-300 text-right">{fundamentals?.industry || "N/A"}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-zinc-500">Currency:</span>
                        <span className="text-zinc-300 text-right uppercase">{fundamentals?.currency || "EGP"}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: WATCHLIST */}
            {activeTab === "watchlist" && (
              <div className="space-y-4 animate-fade-in h-full flex flex-col min-h-0">
                <div className="flex items-center justify-between gap-3 border-b border-[#2a2e39] pb-3">
                  <div className="text-right">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider block">قائمة المراقبة</span>
                    <span className="text-[10px] text-zinc-600 font-semibold">{user ? `${watchlist.length} سهم محفوظ` : "سجل الدخول للمزامنة"}</span>
                  </div>
                  <button
                    onClick={handleWatchlistToggle}
                    className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                      isSaved(symbol)
                        ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                        : "bg-zinc-900/40 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800"
                    }`}
                    title={isSaved(symbol) ? "إزالة السهم الحالي" : "إضافة السهم الحالي"}
                  >
                    {isSaved(symbol) ? <Star className="w-4 h-4 fill-indigo-300" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex-1 flex flex-col gap-2 overflow-y-auto no-scrollbar pb-6 min-h-0">
                  {!user ? (
                    <div className="text-center py-8 px-4 rounded-xl bg-zinc-950/25 border border-dashed border-white/10 space-y-3">
                      <Landmark className="w-6 h-6 text-zinc-600 mx-auto" />
                      <p className="text-xs text-zinc-500 leading-relaxed">قم بتسجيل الدخول لمشاهدة وتعديل قائمة المراقبة الحقيقية الخاصة بك.</p>
                      <button
                        onClick={() => router.push(`/login?redirect=/chart?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`)}
                        className="w-full py-2 text-[10px] font-black bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors uppercase tracking-wider"
                      >
                        تسجيل الدخول
                      </button>
                    </div>
                  ) : watchlist.length === 0 ? (
                    <div className="text-center py-8 px-4 rounded-xl bg-zinc-950/25 border border-dashed border-white/10 space-y-3">
                      <Star className="w-6 h-6 text-zinc-600 mx-auto" />
                      <p className="text-xs text-zinc-500 leading-relaxed">القائمة فارغة. اضغط زر النجمة لإضافة السهم الحالي.</p>
                    </div>
                  ) : (
                    watchlist.map((item) => (
                      <div
                        key={item.id}
                        className={`group relative p-3 rounded-xl border transition-all active:scale-[0.99] ${
                          symbol.toLowerCase() === item.symbol.toLowerCase()
                            ? "bg-indigo-600/10 border-indigo-500/30 text-white"
                            : "bg-zinc-900/20 border-white/5 hover:bg-zinc-900/50 text-zinc-400"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => selectSymbol(item.symbol, item.metadata?.exchange || exchange || "EGX")}
                            className="flex-1 text-right flex flex-col min-w-0"
                          >
                            <span className="text-sm font-black text-white uppercase">{item.symbol}</span>
                            <span className="text-[10px] text-zinc-500 font-semibold truncate w-full mt-0.5">
                              {item.name || item.symbol}
                            </span>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => router.push("/profile")}
                              className="text-zinc-500 hover:text-indigo-300 p-1.5 rounded-lg hover:bg-white/5 transition-all"
                              title="تعديل من البروفايل"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeSymbol(item.id);
                              }}
                              className="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-all"
                              title="إزالة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#131722] text-[#787b86]">
        <Loader2 className="w-8 h-8 animate-spin text-[#2962ff] mb-2" />
        <span className="text-xs font-bold uppercase tracking-wider">Loading Trading Workspace...</span>
      </div>
    }>
      <ChartContent />
    </Suspense>
  );
}
