"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWatchlist } from "@/contexts/WatchlistContext";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Info,
  Calendar,
  AlertCircle,
  ArrowLeft,
  Sparkles,
  Gauge,
  Star,
  ExternalLink
} from "lucide-react";
import Link from "next/link";

interface HistoricalPrice {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

interface StockDetailClientProps {
  symbol: string;
  exchange: string;
  fundamentals: any;
  latestPrice: any;
  latestTech: any;
  historicalPrices: HistoricalPrice[];
  latestScan: any;
}

const localDict = {
  en: {
    backToScanner: "Back to Scanner",
    addWatchlist: "Add to Watchlist",
    removeWatchlist: "Remove from Watchlist",
    loginToWatch: "Login to add to Watchlist",
    watchlistAdded: "Added to Watchlist!",
    watchlistRemoved: "Removed from Watchlist",
    viewChart: "Full Chart",
    latestClose: "Last Close",
    open: "Open",
    high: "High",
    low: "Low",
    volume: "Volume",
    change: "Change",
    indicators: "Technical Indicators",
    rsi: "RSI (14)",
    macd: "MACD Momentum",
    trend: "Trend Strength (ADX)",
    movingAverages: "Moving Averages",
    supportResistance: "Support & Resistance",
    aiScore: "AI Analytics & Score",
    aiSignal: "AI Recommendation",
    aiSummary: "Automated AI Technical Analyst",
    notAvailable: "N/A",
    oversold: "Oversold",
    overbought: "Overbought",
    neutral: "Neutral",
    bullish: "Bullish",
    bearish: "Bearish",
    strong: "Strong",
    weak: "Weak",
    veryStrong: "Very Strong",
    pivotPoint: "Pivot Point (P)",
    noHistory: "No price history available",
    lastUpdated: "Last updated on",
    sector: "Sector",
    exchange: "Exchange",
    country: "Country",
    currency: "Currency",
    marketCap: "Market Cap",
    peRatio: "P/E Ratio",
    eps: "EPS",
    beta: "Beta",
    dividendYield: "Div Yield",
    high52: "52-Week High",
    low52: "52-Week Low",
    buy: "BUY",
    sell: "SELL",
    hold: "HOLD",
    chartTitle: "30-Day Price Trend",
    date: "Date",
    price: "Price",
    resistance: "Resistance",
    support: "Support",
    aboutCompany: "About Company",
    techAnalysis: "Technical Analysis Insights",
    noDataText: "No technical indicators are currently calculated for this symbol. Below is the price history."
  },
  ar: {
    backToScanner: "العودة للمسح الفني",
    addWatchlist: "أضف للقائمة المراقبة",
    removeWatchlist: "إزالة من القائمة المراقبة",
    loginToWatch: "سجل دخولك لإضافة السهم للمراقبة",
    watchlistAdded: "تمت الإضافة للقائمة!",
    watchlistRemoved: "تمت الإزالة من القائمة",
    viewChart: "الشارت الكامل",
    latestClose: "آخر سعر إغلاق",
    open: "سعر الفتح",
    high: "أعلى سعر",
    low: "أدنى سعر",
    volume: "حجم التداول",
    change: "التغير",
    indicators: "المؤشرات الفنية",
    rsi: "مؤشر القوة النسبية (RSI)",
    macd: "زخم الماكد (MACD)",
    trend: "قوة الاتجاه (ADX)",
    movingAverages: "المتوسطات المتحركة",
    supportResistance: "نقاط الدعم والمقاومة",
    aiScore: "تقييم وتحليل الذكاء الاصطناعي",
    aiSignal: "توصية الذكاء الاصطناعي",
    aiSummary: "تحليل المستشار الآلي الذكي",
    notAvailable: "غير متوفر",
    oversold: "ذروة البيع (شراء مفرط)",
    overbought: "ذروة الشراء (بيع مفرط)",
    neutral: "محايد",
    bullish: "صعودي (شراء)",
    bearish: "هبوطي (بيع)",
    strong: "اتجاه قوي",
    weak: "اتجاه ضعيف",
    veryStrong: "اتجاه قوي جداً",
    pivotPoint: "نقطة الارتكاز (P)",
    noHistory: "لا توجد بيانات أسعار سابقة متوفرة",
    lastUpdated: "آخر تحديث في",
    sector: "القطاع",
    exchange: "البورصة",
    country: "الدولة",
    currency: "العملة",
    marketCap: "القيمة السوقية",
    peRatio: "مكرر الربحية P/E",
    eps: "ربحية السهم EPS",
    beta: "معامل بيتا",
    dividendYield: "عائد التوزيعات",
    high52: "أعلى سعر 52 أسبوع",
    low52: "أدنى سعر 52 أسبوع",
    buy: "شراء",
    sell: "بيع",
    hold: "احتفاظ",
    chartTitle: "مخطط الأسعار لآخر 30 يوماً",
    date: "التاريخ",
    price: "السعر",
    resistance: "مقاومة",
    support: "دعم",
    aboutCompany: "نبذة عن الشركة",
    techAnalysis: "رؤى التحليل الفني",
    noDataText: "لم يتم حساب المؤشرات الفنية لهذا الرمز حالياً. يتم عرض تاريخ الأسعار فقط."
  }
};

export default function StockDetailClient({
  symbol,
  exchange,
  fundamentals,
  latestPrice,
  latestTech,
  historicalPrices,
  latestScan
}: StockDetailClientProps) {
  const { language } = useLanguage();
  const t = localDict[language] || localDict.en;
  const { user } = useAuth();
  const { isSaved, saveSymbol, removeSymbolBySymbol } = useWatchlist();
  const router = useRouter();

  // Watchlist toast state
  const [watchToast, setWatchToast] = useState<{ msg: string; type: "success" | "info" } | null>(null);

  // Active chart hover point state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Extract fundamentals
  const fundData = fundamentals?.data || {};
  const companyName = fundData.name || fundData.Name || symbol;
  const sector = fundData.sector || fundData.Sector || null;
  const country = fundData.country || fundData.CountryName || (exchange === "EGX" ? "Egypt" : "US");
  const currency = fundData.currency || fundData.CurrencyCode || (exchange === "EGX" ? "EGP" : "USD");

  const formattedMarketCap = useMemo(() => {
    const val = fundData.marketCap || fundData.MarketCapitalization;
    if (!val) return t.notAvailable;
    const num = Number(val);
    if (num >= 1e9) {
      return language === "ar"
        ? `${(num / 1e9).toFixed(2)} مليار`
        : `${(num / 1e9).toFixed(2)}B`;
    }
    if (num >= 1e6) {
      return language === "ar"
        ? `${(num / 1e6).toFixed(2)} مليون`
        : `${(num / 1e6).toFixed(2)}M`;
    }
    return num.toLocaleString();
  }, [fundData, language, t.notAvailable]);

  // Support / Resistance (Classic Pivot Points)
  const pivotPoints = useMemo(() => {
    const H = Number(latestPrice?.high ?? latestTech?.close ?? 0);
    const L = Number(latestPrice?.low ?? latestTech?.close ?? 0);
    const C = Number(latestPrice?.close ?? latestTech?.close ?? 0);

    if (H === 0 && L === 0 && C === 0) return null;

    const P = (H + L + C) / 3;
    const R1 = 2 * P - L;
    const S1 = 2 * P - H;
    const R2 = P + (H - L);
    const S2 = P - (H - L);
    const R3 = H + 2 * (P - L);
    const S3 = L - 2 * (H - P);

    return { P, R1, R2, R3, S1, S2, S3 };
  }, [latestPrice, latestTech]);

  // Compute composite AI Score dynamically if DB has no AI Scanner result
  const computedAIScore = useMemo(() => {
    if (latestScan && latestScan.precision) {
      return Math.round(Number(latestScan.precision) * 100);
    }

    // Dynamic technical rule engine
    let score = 50; // base

    if (latestTech) {
      // 1. RSI Rules
      const rsi = Number(latestTech.rsi_14);
      if (!isNaN(rsi)) {
        if (rsi < 30) score += 15; // Oversold -> positive reversal chance
        else if (rsi > 70) score -= 15; // Overbought -> pullback risk
        else if (rsi > 50) score += 5; // Moderate bullish
      }

      // 2. MACD Rules
      const macd = Number(latestTech.macd);
      const signal = Number(latestTech.macd_signal);
      if (!isNaN(macd) && !isNaN(signal)) {
        if (macd > signal) score += 15;
        else score -= 15;
      }

      // 3. Moving Averages Rules (Close vs EMA 50 / 200)
      const close = Number(latestTech.close);
      const ema50 = Number(latestTech.ema_50);
      const ema200 = Number(latestTech.ema_200);
      if (!isNaN(close)) {
        if (!isNaN(ema50)) {
          if (close > ema50) score += 10;
          else score -= 10;
        }
        if (!isNaN(ema200)) {
          if (close > ema200) score += 10;
          else score -= 10;
        }
      }

      // 4. Change Pct
      const chg = Number(latestTech.change_pct);
      if (!isNaN(chg)) {
        if (chg > 0) score += 5;
        else score -= 5;
      }
    }

    // Clamp score between 10 and 95
    return Math.max(10, Math.min(95, score));
  }, [latestTech, latestScan]);

  const aiSignal = useMemo(() => {
    if (latestScan && latestScan.signal) {
      return latestScan.signal.toUpperCase();
    }
    if (computedAIScore >= 65) return "BUY";
    if (computedAIScore <= 40) return "SELL";
    return "HOLD";
  }, [computedAIScore, latestScan]);

  // AI Recommendation summary text generator
  const aiSummaryText = useMemo(() => {
    if (latestScan && latestScan.top_reasons && latestScan.top_reasons.length > 0) {
      return Array.isArray(latestScan.top_reasons)
        ? latestScan.top_reasons.join(". ")
        : String(latestScan.top_reasons);
    }

    const rsi = Number(latestTech?.rsi_14);
    const macd = Number(latestTech?.macd);
    const signal = Number(latestTech?.macd_signal);
    const close = Number(latestPrice?.close ?? latestTech?.close);
    const ema50 = Number(latestTech?.ema_50);

    const reasons: string[] = [];

    if (language === "ar") {
      if (rsi < 30) reasons.push("مؤشر القوة النسبية RSI يقع في منطقة ذروة البيع مما يشير لارتداد صعودي محتمل");
      else if (rsi > 70) reasons.push("مؤشر القوة النسبية RSI يقع في منطقة ذروة الشراء مما قد يسبب ضغطاً بيعياً مؤقتاً");
      else reasons.push("مؤشر RSI مستقر في مستويات حيادية متوسطة عند " + Math.round(rsi || 50));

      if (macd > signal) reasons.push("تقاطع صعودي إيجابي في زخم الماكد MACD يدعم استمرار الاتجاه الصاعد");
      else reasons.push("تقاطع هبوطي سلبي في مؤشر الماكد MACD يرجح الحذر والانتظار");

      if (close > ema50) reasons.push("السعر يتداول أعلى المتوسط المتحرك EMA 50 مما يعزز الاستقرار الصعودي قصير الأجل");
      else reasons.push("السعر يواجه مقاومة تحت المتوسط المتحرك EMA 50 مما يضغط سلباً على حركة السهم");
    } else {
      if (rsi < 30) reasons.push("RSI is oversold, indicating an attractive buying/reversal candidate");
      else if (rsi > 70) reasons.push("RSI is overbought, flagging potential profit-taking and correction risk");
      else reasons.push(`RSI is neutral at ${Math.round(rsi || 50)}, showing balanced supply and demand`);

      if (macd > signal) reasons.push("MACD histogram crossed above signal line, validating bullish momentum");
      else reasons.push("MACD remains below the signal line, suggesting downward consolidation");

      if (close > ema50) reasons.push("Stock price resides above EMA 50, supporting a short-term upward trend");
      else reasons.push("Price trades below EMA 50, which serves as immediate overhead resistance");
    }

    return reasons.join(". ");
  }, [latestTech, latestPrice, latestScan, language]);

  // Mini Chart coordinates calculations
  const chartPoints = useMemo(() => {
    if (historicalPrices.length < 2) return [];

    const closes = historicalPrices.map((p) => p.close);
    const minVal = Math.min(...closes);
    const maxVal = Math.max(...closes);
    const range = maxVal - minVal;
    const pad = range * 0.08 || 0.1;

    const yMin = minVal - pad;
    const yMax = maxVal + pad;
    const yRange = yMax - yMin;

    const width = 600;
    const height = 240;

    return historicalPrices.map((p, idx) => {
      const x = (idx / (historicalPrices.length - 1)) * width;
      const y = height - ((p.close - yMin) / yRange) * height;
      return { x, y, price: p.close, date: p.date };
    });
  }, [historicalPrices]);

  const chartPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    return chartPoints.map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(" ");
  }, [chartPoints]);

  const chartAreaPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    const lastX = chartPoints[chartPoints.length - 1].x;
    return `${chartPath} L ${lastX.toFixed(1)} 240 L 0 240 Z`;
  }, [chartPoints, chartPath]);

  // Active hover data details
  const activeHoverPoint = hoverIndex !== null && chartPoints[hoverIndex] ? chartPoints[hoverIndex] : null;

  // Day price change
  const priceChange = Number(latestPrice?.close ?? latestTech?.close ?? 0) - Number(latestPrice?.open ?? latestTech?.close ?? 0);
  const priceChangePct = latestTech?.change_pct
    ? Number(latestTech.change_pct)
    : latestPrice?.open
    ? (priceChange / Number(latestPrice.open)) * 100
    : 0;

  const isPriceUp = priceChangePct >= 0;

  // Watchlist toggle handler
  const handleWatchlistToggle = useCallback(() => {
    if (!user) {
      router.push(`/login?redirect=/stocks/${symbol.toLowerCase()}`);
      return;
    }
    const alreadySaved = isSaved(symbol);
    if (alreadySaved) {
      removeSymbolBySymbol(symbol);
      setWatchToast({ msg: t.watchlistRemoved, type: "info" });
    } else {
      saveSymbol({
        symbol: symbol.toUpperCase(),
        name: companyName,
        source: "tech_scanner",
        metadata: {
          price: Number(latestPrice?.close ?? latestTech?.close ?? 0),
          name: companyName,
          exchange,
        },
        entryPrice: Number(latestPrice?.close ?? latestTech?.close ?? null),
      });
      setWatchToast({ msg: t.watchlistAdded, type: "success" });
    }
    setTimeout(() => setWatchToast(null), 2800);
  }, [user, isSaved, symbol, removeSymbolBySymbol, saveSymbol, router, t, companyName, latestPrice, latestTech, exchange]);

  const isInWatchlist = isSaved(symbol);

  return (
    <div className="space-y-8 select-text">
      {/* Toast notification */}
      {watchToast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 font-bold text-sm border-2 border-black shadow-[4px_4px_0px_0px_#000] transition-all animate-in slide-in-from-bottom-4 ${
            watchToast.type === "success"
              ? "bg-green-400 text-black"
              : "bg-amber-400 text-black"
          }`}
        >
          <Star className={`w-4 h-4 ${watchToast.type === "success" ? "fill-black" : ""}`} />
          {watchToast.msg}
        </div>
      )}

      {/* Back button + Action buttons */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <Link
          href="/scanner/technical"
          className="neobrutal-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.backToScanner}
        </Link>

        <div className="flex items-center gap-2">
          {/* Full Chart Link */}
          <Link
            href={`/chart?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`}
            className="neobrutal-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all neobrutal-bg-blue"
          >
            <ExternalLink className="w-4 h-4" />
            {t.viewChart}
          </Link>

          {/* Watchlist Button */}
          <button
            onClick={handleWatchlistToggle}
            title={!user ? t.loginToWatch : isInWatchlist ? t.removeWatchlist : t.addWatchlist}
            className={`neobrutal-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-black transition-all border-2 border-black shadow-[3px_3px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_0px_#000] ${
              isInWatchlist
                ? "bg-yellow-400 text-black hover:bg-yellow-300"
                : "bg-white text-black hover:bg-gray-100 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 dark:border-white"
            }`}
          >
            <Star
              className={`w-4 h-4 transition-all ${
                isInWatchlist ? "fill-black text-black" : ""
              }`}
            />
            {isInWatchlist ? t.removeWatchlist : t.addWatchlist}
          </button>
        </div>
      </div>

      {/* Stock Hero Section */}
      <div className="app-panel p-6 sm:p-8 bg-[var(--app-surface)] relative overflow-hidden rounded-none">
        <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="neobrutal-btn neobrutal-bg-yellow px-2 py-0.5 text-xs font-black uppercase tracking-wider rounded-none select-none">
                {exchange}
              </span>
              <span className="neobrutal-btn neobrutal-bg-blue px-2 py-0.5 text-xs font-black uppercase rounded-none select-none">
                {country}
              </span>
              {sector && (
                <span className="neobrutal-btn neobrutal-bg-pink px-2 py-0.5 text-xs font-black rounded-none select-none">
                  {sector}
                </span>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--app-text)] font-mono">
              {symbol}
            </h1>
            <p className="text-lg text-[var(--app-text-muted)] font-medium">
              {companyName}
            </p>
          </div>

          <div className="flex flex-col md:items-end justify-center">
            <span className="text-[var(--app-text-faint)] text-xs font-semibold uppercase tracking-wider">
              {t.latestClose}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-[var(--app-text)]">
                {Number(latestPrice?.close ?? latestTech?.close ?? 0).toFixed(2)}
              </span>
              <span className="text-lg sm:text-xl font-bold font-mono text-[var(--app-text-muted)]">
                {currency}
              </span>
            </div>

            <div
              className={`inline-flex items-center gap-1 mt-2 px-3 py-1 font-bold text-xs font-mono neobrutal-btn rounded-none ${
                isPriceUp ? "neobrutal-bg-green text-black" : "neobrutal-bg-orange text-black"
              }`}
            >
              {isPriceUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              <span>
                {isPriceUp ? "+" : ""}
                {priceChangePct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Sync dates */}
        <div className="mt-6 pt-6 border-t border-[var(--app-border)] flex flex-wrap items-center justify-between text-xs text-[var(--app-text-faint)] gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {t.lastUpdated}:{" "}
              {latestPrice?.date
                ? new Date(latestPrice.date).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                  })
                : t.notAvailable}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            <span className="font-semibold uppercase tracking-wider">{t.exchange}: {exchange}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Chart & AI Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* SVG Price Chart Card */}
        <div className="app-panel p-6 bg-[var(--app-surface)] lg:col-span-2 flex flex-col justify-between rounded-none">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-extrabold flex items-center gap-2 tracking-tight">
              <Activity className="w-5 h-5 text-blue-500" />
              {t.chartTitle}
            </h2>
            {activeHoverPoint ? (
              <div className="text-right font-mono">
                <span className="text-xs text-[var(--app-text-faint)] block">{activeHoverPoint.date}</span>
                <span className="text-sm font-extrabold text-[var(--app-text)]">
                  {activeHoverPoint.price.toFixed(2)} {currency}
                </span>
              </div>
            ) : latestPrice ? (
              <div className="text-right font-mono">
                <span className="text-xs text-[var(--app-text-faint)] block">{latestPrice.date}</span>
                <span className="text-sm font-extrabold text-[var(--app-text)]">
                  {Number(latestPrice.close).toFixed(2)} {currency}
                </span>
              </div>
            ) : null}
          </div>

          {/* SVG Canvas */}
          {chartPoints.length > 0 ? (
            <div className="relative w-full h-[240px] bg-slate-950/20 border border-[var(--app-border)] select-none">
              <svg
                viewBox="0 0 600 240"
                className="w-full h-full overflow-visible"
                onMouseLeave={() => setHoverIndex(null)}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const pct = Math.max(0, Math.min(1, x / rect.width));
                  const index = Math.round(pct * (chartPoints.length - 1));
                  setHoverIndex(index);
                }}
              >
                {/* Grids */}
                <line x1="0" y1="60" x2="600" y2="60" stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
                <line x1="0" y1="120" x2="600" y2="120" stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
                <line x1="0" y1="180" x2="600" y2="180" stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />

                {/* Area under line */}
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={isPriceUp ? "#4ade80" : "#fb923c"} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={isPriceUp ? "#4ade80" : "#fb923c"} stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path d={chartAreaPath} fill="url(#chartGradient)" />

                {/* Main Trend Line */}
                <path
                  d={chartPath}
                  fill="none"
                  stroke={isPriceUp ? "#4ade80" : "#fb923c"}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Hover indicator line */}
                {hoverIndex !== null && chartPoints[hoverIndex] && (
                  <>
                    <line
                      x1={chartPoints[hoverIndex].x}
                      y1="0"
                      x2={chartPoints[hoverIndex].x}
                      y2="240"
                      stroke="rgba(255,255,255,0.3)"
                      strokeWidth="1.5"
                      strokeDasharray="2,2"
                    />
                    <circle
                      cx={chartPoints[hoverIndex].x}
                      cy={chartPoints[hoverIndex].y}
                      r="6"
                      fill={isPriceUp ? "#4ade80" : "#fb923c"}
                      stroke="black"
                      strokeWidth="2.5"
                    />
                  </>
                )}
              </svg>
            </div>
          ) : (
            <div className="h-[240px] flex items-center justify-center border border-dashed border-[var(--app-border)]">
              <span className="text-[var(--app-text-faint)] text-sm">{t.noHistory}</span>
            </div>
          )}

          {/* Simple price stats table */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[var(--app-border)] font-mono text-center">
            <div>
              <span className="text-xs text-[var(--app-text-faint)] block uppercase tracking-wider">{t.open}</span>
              <span className="text-base font-extrabold text-[var(--app-text)]">
                {latestPrice?.open ? Number(latestPrice.open).toFixed(2) : t.notAvailable}
              </span>
            </div>
            <div>
              <span className="text-xs text-[var(--app-text-faint)] block uppercase tracking-wider">{t.high}</span>
              <span className="text-base font-extrabold text-green-500">
                {latestPrice?.high ? Number(latestPrice.high).toFixed(2) : t.notAvailable}
              </span>
            </div>
            <div>
              <span className="text-xs text-[var(--app-text-faint)] block uppercase tracking-wider">{t.low}</span>
              <span className="text-base font-extrabold text-orange-500">
                {latestPrice?.low ? Number(latestPrice.low).toFixed(2) : t.notAvailable}
              </span>
            </div>
            <div>
              <span className="text-xs text-[var(--app-text-faint)] block uppercase tracking-wider">{t.volume}</span>
              <span className="text-base font-extrabold text-[var(--app-text)]">
                {latestPrice?.volume ? Number(latestPrice.volume).toLocaleString() : t.notAvailable}
              </span>
            </div>
          </div>
        </div>

        {/* AI Score Card */}
        <div className="app-panel p-6 bg-[var(--app-surface-strong)] flex flex-col justify-between relative rounded-none">
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-xl pointer-events-none" />
          
          <div className="space-y-6">
            <h2 className="text-xl font-extrabold flex items-center gap-2 tracking-tight">
              <Sparkles className="w-5 h-5 text-purple-400 animate-pulse" />
              {t.aiScore}
            </h2>

            {/* Big circular dial */}
            <div className="flex flex-col items-center justify-center py-4">
              <div className="relative w-36 h-36 flex items-center justify-center">
                {/* SVG Progress Ring */}
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="72"
                    cy="72"
                    r="62"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  <circle
                    cx="72"
                    cy="72"
                    r="62"
                    stroke="url(#purpleGrad)"
                    strokeWidth="10"
                    strokeDasharray={390}
                    strokeDashoffset={390 - (390 * computedAIScore) / 100}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-1000 ease-out"
                  />
                  <defs>
                    <linearGradient id="purpleGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#a855f7" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute text-center font-mono">
                  <span className="text-4xl font-black text-[var(--app-text)]">{computedAIScore}</span>
                  <span className="text-xs text-[var(--app-text-faint)] block">/ 100</span>
                </div>
              </div>

              {/* Action Signal */}
              <div className="mt-6 text-center">
                <span className="text-xs text-[var(--app-text-faint)] block uppercase tracking-wider mb-2 font-semibold">
                  {t.aiSignal}
                </span>
                <span
                  className={`neobrutal-btn text-base font-black px-6 py-2 tracking-widest rounded-none select-none ${
                    aiSignal === "BUY"
                      ? "neobrutal-bg-green text-black"
                      : aiSignal === "SELL"
                      ? "neobrutal-bg-orange text-black"
                      : "neobrutal-bg-yellow text-black"
                  }`}
                >
                  {aiSignal === "BUY" ? t.buy : aiSignal === "SELL" ? t.sell : t.hold}
                </span>
              </div>
            </div>
          </div>

          {/* AI written insights summary */}
          <div className="mt-6 pt-6 border-t border-[var(--app-border)] space-y-2">
            <span className="text-xs font-bold text-purple-400 flex items-center gap-1 uppercase tracking-wider">
              <Info className="w-3.5 h-3.5" />
              {t.aiSummary}
            </span>
            <p className="text-xs leading-relaxed text-[var(--app-text-muted)] italic">
              &ldquo;{aiSummaryText}&rdquo;
            </p>
          </div>
        </div>
      </div>

      {/* Grid: Indicators and Support & Resistance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Technical Indicators values */}
        <div className="app-panel p-6 bg-[var(--app-surface)] rounded-none">
          <h2 className="text-xl font-extrabold flex items-center gap-2 mb-6 tracking-tight">
            <Gauge className="w-5 h-5 text-teal-400" />
            {t.indicators}
          </h2>

          {latestTech ? (
            <div className="space-y-6">
              {/* RSI (14) Card */}
              <div className="p-4 bg-slate-900/40 border border-[var(--app-border)] rounded-none flex items-center justify-between">
                <div>
                  <span className="text-sm font-extrabold block text-[var(--app-text)]">{t.rsi}</span>
                  <span className="text-xs text-[var(--app-text-faint)]">
                    {Number(latestTech.rsi_14) > 70
                      ? t.overbought
                      : Number(latestTech.rsi_14) < 30
                      ? t.oversold
                      : t.neutral}
                  </span>
                </div>
                <div className="text-right font-mono">
                  <span className="text-2xl font-extrabold block text-[var(--app-text)]">
                    {Number(latestTech.rsi_14).toFixed(1)}
                  </span>
                  {/* Miniature visual bar */}
                  <div className="w-24 h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        Number(latestTech.rsi_14) > 70
                          ? "bg-red-500"
                          : Number(latestTech.rsi_14) < 30
                          ? "bg-green-500"
                          : "bg-yellow-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, Number(latestTech.rsi_14)))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* MACD Card */}
              <div className="p-4 bg-slate-900/40 border border-[var(--app-border)] rounded-none flex items-center justify-between">
                <div>
                  <span className="text-sm font-extrabold block text-[var(--app-text)]">{t.macd}</span>
                  <span className="text-xs text-[var(--app-text-faint)]">
                    {Number(latestTech.macd) > Number(latestTech.macd_signal) ? t.bullish : t.bearish}
                  </span>
                </div>
                <div className="text-right font-mono">
                  <span className="text-lg font-black block text-[var(--app-text)]">
                    {Number(latestTech.macd).toFixed(4)}
                  </span>
                  <span className="text-xs text-[var(--app-text-faint)]">
                    Sig: {Number(latestTech.macd_signal).toFixed(4)}
                  </span>
                </div>
              </div>

              {/* ADX Trend strength */}
              <div className="p-4 bg-slate-900/40 border border-[var(--app-border)] rounded-none flex items-center justify-between">
                <div>
                  <span className="text-sm font-extrabold block text-[var(--app-text)]">{t.trend}</span>
                  <span className="text-xs text-[var(--app-text-faint)]">
                    {Number(latestTech.adx_14) > 40
                      ? t.veryStrong
                      : Number(latestTech.adx_14) > 25
                      ? t.strong
                      : t.weak}
                  </span>
                </div>
                <div className="text-right font-mono">
                  <span className="text-xl font-bold text-[var(--app-text)]">
                    {Number(latestTech.adx_14).toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Moving Averages Comparison */}
              <div className="p-4 bg-slate-900/40 border border-[var(--app-border)] rounded-none">
                <span className="text-sm font-extrabold block text-[var(--app-text)] mb-3">
                  {t.movingAverages}
                </span>
                <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                  <div className="flex justify-between p-2 border-b border-[var(--app-border)]">
                    <span className="text-[var(--app-text-faint)]">EMA 50</span>
                    <span className="font-bold">
                      {latestTech.ema_50 ? Number(latestTech.ema_50).toFixed(2) : t.notAvailable}
                    </span>
                  </div>
                  <div className="flex justify-between p-2 border-b border-[var(--app-border)]">
                    <span className="text-[var(--app-text-faint)]">EMA 200</span>
                    <span className="font-bold">
                      {latestTech.ema_200 ? Number(latestTech.ema_200).toFixed(2) : t.notAvailable}
                    </span>
                  </div>
                  <div className="flex justify-between p-2 border-b border-[var(--app-border)]">
                    <span className="text-[var(--app-text-faint)]">SMA 50</span>
                    <span className="font-bold">
                      {latestTech.sma_50 ? Number(latestTech.sma_50).toFixed(2) : t.notAvailable}
                    </span>
                  </div>
                  <div className="flex justify-between p-2 border-b border-[var(--app-border)]">
                    <span className="text-[var(--app-text-faint)]">SMA 200</span>
                    <span className="font-bold">
                      {latestTech.sma_200 ? Number(latestTech.sma_200).toFixed(2) : t.notAvailable}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-orange-500/10 border border-orange-500/30 text-orange-400 flex gap-2 rounded-none text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{t.noDataText}</p>
              </div>
            </div>
          )}
        </div>

        {/* Pivot Points Support & Resistance visual scale */}
        <div className="app-panel p-6 bg-[var(--app-surface)] rounded-none">
          <h2 className="text-xl font-extrabold flex items-center gap-2 mb-6 tracking-tight">
            <Layers className="w-5 h-5 text-pink-400" />
            {t.supportResistance}
          </h2>

          {pivotPoints ? (
            <div className="space-y-4">
              <div className="space-y-2 font-mono text-sm">
                {/* R3 */}
                <div className="flex items-center justify-between p-2.5 bg-red-500/10 border-l-4 border-red-500 text-red-400">
                  <span className="font-extrabold">{t.resistance} 3 (R3)</span>
                  <span className="font-black">{pivotPoints.R3.toFixed(2)}</span>
                </div>
                {/* R2 */}
                <div className="flex items-center justify-between p-2.5 bg-red-500/5 border-l-4 border-red-400 text-red-300">
                  <span className="font-extrabold">{t.resistance} 2 (R2)</span>
                  <span className="font-black">{pivotPoints.R2.toFixed(2)}</span>
                </div>
                {/* R1 */}
                <div className="flex items-center justify-between p-2.5 bg-red-500/5 border-l-4 border-red-300 text-red-200">
                  <span className="font-extrabold">{t.resistance} 1 (R1)</span>
                  <span className="font-black">{pivotPoints.R1.toFixed(2)}</span>
                </div>

                {/* Pivot (P) */}
                <div className="flex items-center justify-between p-3.5 bg-slate-900 border-l-4 border-blue-500 text-blue-400 my-4 text-base font-black">
                  <span>{t.pivotPoint}</span>
                  <span>{pivotPoints.P.toFixed(2)}</span>
                </div>

                {/* S1 */}
                <div className="flex items-center justify-between p-2.5 bg-green-500/5 border-l-4 border-green-300 text-green-200">
                  <span className="font-extrabold">{t.support} 1 (S1)</span>
                  <span className="font-black">{pivotPoints.S1.toFixed(2)}</span>
                </div>
                {/* S2 */}
                <div className="flex items-center justify-between p-2.5 bg-green-500/5 border-l-4 border-green-400 text-green-300">
                  <span className="font-extrabold">{t.support} 2 (S2)</span>
                  <span className="font-black">{pivotPoints.S2.toFixed(2)}</span>
                </div>
                {/* S3 */}
                <div className="flex items-center justify-between p-2.5 bg-green-500/10 border-l-4 border-green-500 text-green-400">
                  <span className="font-extrabold">{t.support} 3 (S3)</span>
                  <span className="font-black">{pivotPoints.S3.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center border border-dashed border-[var(--app-border)] text-sm text-[var(--app-text-faint)]">
              {t.notAvailable}
            </div>
          )}
        </div>
      </div>

      {/* About Company Card */}
      {fundData.description || fundData.Description ? (
        <div className="app-panel p-6 bg-[var(--app-surface)] rounded-none">
          <h2 className="text-xl font-extrabold mb-4 tracking-tight flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-400" />
            {t.aboutCompany}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--app-text-muted)] max-w-4xl">
            {fundData.description || fundData.Description}
          </p>
        </div>
      ) : null}
    </div>
  );
}
