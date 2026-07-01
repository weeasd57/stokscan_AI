"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    Loader2, RefreshCw, Landmark,
    ArrowUpRight, ArrowDownRight, AlertTriangle, AlertCircle,
    DollarSign, Activity, Layers, Search, ChevronDown, Check, X
} from "lucide-react";
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";

interface MarketDataPoint {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

interface MarketStatusResponse {
    egx30: MarketDataPoint[];
    egx100: MarketDataPoint[];
    usdegp: MarketDataPoint[];
    regime: string;
    egx30_return: number;
    reject_buys: boolean;
    updated_at: string;
}

interface TreemapBox {
    item: any;
    x: number;
    y: number;
    w: number;
    h: number;
}

const getBoxColor = (val: number): { bg: string; fg: string } => {
    if (val >= 2.0) return { bg: "#047857", fg: "#ffffff" };
    if (val >= 0.5) return { bg: "#10B981", fg: "#ffffff" };
    if (val > 0.1) return { bg: "#6ee7b7", fg: "#06281b" };
    if (val < -2.0) return { bg: "#b91c1c", fg: "#ffffff" };
    if (val < -0.5) return { bg: "#EF4444", fg: "#ffffff" };
    if (val < -0.1) return { bg: "#fca5a5", fg: "#3b0808" };
    return { bg: "#a1a1aa", fg: "#18181b" };
};

const squarify = (items: any[], x: number, y: number, w: number, h: number): TreemapBox[] => {
    const total = items.reduce((s, i) => s + (i.value || 0), 0);
    if (total <= 0 || w <= 0 || h <= 0) return [];
    const area = w * h;
    const scaled = items
        .map((i) => ({ ...i, area: ((i.value || 0) / total) * area }))
        .sort((a, b) => b.area - a.area);

    const worst = (row: any[], side: number) => {
        const s = row.reduce((sum, r) => sum + r.area, 0);
        if (s <= 0 || side <= 0) return Infinity;
        const rmax = Math.max(...row.map((r) => r.area));
        const rmin = Math.min(...row.map((r) => r.area));
        return Math.max((side * side * rmax) / (s * s), (s * s) / (side * side * rmin));
    };

    const layoutRow = (row: any[], rect: { x: number; y: number; w: number; h: number }) => {
        const s = row.reduce((sum, r) => sum + r.area, 0);
        const rects: TreemapBox[] = [];
        if (rect.w >= rect.h) {
            const stripW = s / rect.h;
            let yy = rect.y;
            for (const r of row) {
                const hh = r.area / stripW;
                rects.push({ item: r, x: rect.x, y: yy, w: stripW, h: hh });
                yy += hh;
            }
            return { rects, remaining: { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h } };
        }
        const stripH = s / rect.w;
        let xx = rect.x;
        for (const r of row) {
            const ww = r.area / stripH;
            rects.push({ item: r, x: xx, y: rect.y, w: ww, h: stripH });
            xx += ww;
        }
        return { rects, remaining: { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH } };
    };

    const result: TreemapBox[] = [];
    let remaining = [...scaled];
    let cur = { x, y, w, h };
    let row: any[] = [];

    while (remaining.length > 0) {
        const side = Math.min(cur.w, cur.h);
        if (row.length === 0) {
            row.push(remaining[0]);
            remaining = remaining.slice(1);
            continue;
        }
        const withNew = [...row, remaining[0]];
        if (worst(withNew, side) <= worst(row, side)) {
            row = withNew;
            remaining = remaining.slice(1);
        } else {
            const { rects, remaining: rem } = layoutRow(row, cur);
            result.push(...rects);
            cur = rem;
            row = [];
        }
    }
    if (row.length > 0) {
        const { rects } = layoutRow(row, cur);
        result.push(...rects);
    }
    return result;
};

const SmartMoneyTreemap = ({ sectors, isAr, selectedSector, onSelect }: {
    sectors: any[];
    isAr: boolean;
    selectedSector: any;
    onSelect: (sec: any) => void;
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 1000, h: 400 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0].contentRect;
            setSize({ w: Math.max(1, cr.width), h: Math.max(1, cr.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const boxes = useMemo(() => {
        const items = sectors
            .map((s: any) => ({
                name: s.sector,
                sector_ar: s.sector_ar,
                value: s.money_flow,
                change_pct: s.change_pct,
                market_share: s.market_share,
                sentiment: s.sentiment,
                stocks: s.stocks,
                stocks_count: s.stocks_count,
            }))
            .filter((s) => (s.value || 0) > 0);
        return squarify(items, 0, 0, size.w, size.h);
    }, [sectors, size.w, size.h]);

    if (boxes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full gap-3">
                <AlertTriangle className="w-8 h-8 text-zinc-600" />
                <p className="text-xs font-mono text-zinc-600 dark:text-zinc-500">{isAr ? "لا توجد سيولة لعرضها حالياً" : "No liquidity data to display"}</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative w-full h-full overflow-hidden" dir="ltr">
            {boxes.map((b, i) => {
                const pct = b.item.change_pct ?? 0;
                const color = getBoxColor(pct);
                const label = isAr ? b.item.sector_ar : b.item.name;
                const isSelected = selectedSector && selectedSector.name === b.item.name;
                const showLabel = b.w > 64 && b.h > 30;
                const showDetail = b.w > 110 && b.h > 58;
                const showShare = b.w > 130 && b.h > 80;
                const moneyFlow = (b.item.value ?? 0) / 1_000_000;
                const up = pct >= 0;
                return (
                    <div
                        key={`${b.item.name}-${i}`}
                        onClick={() => onSelect({
                            name: b.item.name,
                            sector_ar: b.item.sector_ar,
                            value: b.item.value,
                            change_pct: b.item.change_pct,
                            market_share: b.item.market_share,
                            sentiment: b.item.sentiment,
                            stocks: b.item.stocks,
                        })}
                        className="absolute flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 hover:z-20 group"
                        style={{
                            left: b.x,
                            top: b.y,
                            width: b.w,
                            height: b.h,
                            backgroundColor: color.bg,
                            border: `${isSelected ? 4 : 2}px solid ${isSelected ? "#FFDC58" : "#18181b"}`,
                            padding: 4,
                        }}
                    >
                        {showLabel && (
                            <span
                                className="font-sans font-black uppercase select-none leading-tight truncate w-full px-1"
                                style={{ color: color.fg, fontSize: Math.min(13, b.w / 12) }}
                            >
                                {label}
                            </span>
                        )}
                        {showDetail && (
                            <span
                                className="font-mono font-black select-none leading-none mt-1"
                                style={{ color: color.fg, fontSize: Math.min(14, b.w / 11), opacity: 0.95 }}
                            >
                                {up ? "+" : ""}{Number(pct).toFixed(2)}%
                            </span>
                        )}
                        {showShare && (
                            <span
                                className="font-mono font-bold select-none leading-none mt-1.5 px-1.5 py-0.5"
                                style={{
                                    color: color.fg,
                                    fontSize: 9,
                                    backgroundColor: "rgba(0,0,0,0.15)",
                                    border: `1px solid ${color.fg}40`,
                                }}
                            >
                                {b.item.market_share ?? 0}% · {moneyFlow.toFixed(0)}M
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

const SearchableSymbolSelect = ({ symbols, value, onChange, isAr, t }: {
    symbols: string[];
    value: string;
    onChange: (sym: string) => void;
    isAr: boolean;
    t: (k: string) => string;
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? symbols.filter((s) => s.toLowerCase().includes(q)) : symbols;
        return list.slice(0, 250);
    }, [symbols, query]);

    return (
        <div ref={ref} className="relative w-full sm:w-72">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white font-mono font-bold text-xs uppercase focus:outline-none transition-all cursor-pointer ${open ? "shadow-none" : "shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.15)]"} ${isAr ? "flex-row-reverse" : "flex-row"}`}
            >
                <span className="flex items-center gap-2 truncate">
                    <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="truncate">{value || t("market.select_stock")}</span>
                </span>
                <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full border-2 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,0.15)]">
                    <div className={`relative border-b-2 border-black dark:border-zinc-800 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <Search className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-2.5" : "left-2.5"} w-3.5 h-3.5 text-zinc-400 pointer-events-none`} />
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("market.search_symbol")}
                            className={`w-full bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-white font-mono text-xs py-2.5 pr-9 pl-3 border-0 focus:outline-none placeholder:text-zinc-400 ${isAr ? "text-right" : "text-left"}`}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery("")}
                                className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "left-2" : "right-2"} text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200`}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="max-h-64 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <p className="px-3 py-4 text-xs font-mono text-zinc-500 text-center">{t("market.no_results")}</p>
                        ) : (
                            filtered.map((sym) => (
                                <button
                                    key={sym}
                                    type="button"
                                    onClick={() => {
                                        onChange(sym);
                                        setOpen(false);
                                        setQuery("");
                                    }}
                                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 font-mono text-xs font-bold uppercase border-b border-black/5 dark:border-white/5 transition-colors ${isAr ? "flex-row-reverse text-right" : "flex-row text-left"} ${sym === value ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
                                >
                                    <span className="truncate">{sym}</span>
                                    {sym === value && <Check className="w-3.5 h-3.5 shrink-0" />}
                                </button>
                            ))
                        )}
                    </div>

                    <div className={`flex items-center justify-between px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border-t-2 border-black dark:border-zinc-800 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase">
                            {filtered.length} / {symbols.length} {t("market.symbols_count")}
                        </span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-[9px] font-mono font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 uppercase"
                        >
                            {isAr ? "إغلاق" : "Close"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const SectorDrillModal = ({ sector, isAr, t, onClose }: {
    sector: any;
    isAr: boolean;
    t: (k: string) => string;
    onClose: () => void;
}) => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    const pct = sector.change_pct ?? 0;
    const flow = sector.value ?? sector.money_flow ?? 0;
    const stocks = sector.stocks ?? [];
    const totalWeight = stocks.reduce((s: number, st: any) => s + (st.money_flow ?? 0), 0) || flow || 1;

    const modal = (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
            dir={isAr ? "rtl" : "ltr"}
            role="dialog"
            aria-modal="true"
        >
            <div
                className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative z-10 w-full max-w-5xl max-h-[90vh] flex flex-col border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.2)]">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 border-b-4 border-black dark:border-zinc-800 bg-[#FFE600] dark:bg-[#FFE600]">
                    <div className={isAr ? "text-right" : "text-left"}>
                        <h3 className="text-lg sm:text-xl font-black text-black dark:text-black uppercase tracking-tight flex items-center gap-2">
                            <Layers className="w-5 h-5" />
                            {t("market.heatmap.drilldown_title")}{" "}
                            <span className="underline decoration-2 underline-offset-2">
                                {isAr ? sector.sector_ar : sector.name}
                            </span>
                        </h3>
                        <p className="text-[11px] font-mono font-bold text-black/70 mt-1">
                            {t("market.heatmap.drilldown_subtitle")}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="self-start sm:self-auto shrink-0 w-10 h-10 border-2 border-black bg-black text-[#FFE600] flex items-center justify-center cursor-pointer active:translate-x-[1px] active:translate-y-[1px] transition-all shadow-[2px_2px_0px_rgba(0,0,0,0.4)] hover:bg-zinc-800"
                        title={t("market.heatmap.modal_close")}
                        aria-label={t("market.heatmap.modal_close")}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Stats strip */}
                <div className={`flex flex-wrap items-center gap-2 sm:gap-3 px-5 sm:px-6 py-3 border-b-2 border-black dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                    <span className="text-[10px] font-black font-mono uppercase tracking-wider text-zinc-500 bg-white dark:bg-zinc-950 border-2 border-black dark:border-zinc-800 px-2.5 py-1">
                        {t("market.heatmap.share")}: <span className="text-zinc-950 dark:text-white">{sector.market_share}%</span>
                    </span>
                    <span className="text-[10px] font-black font-mono uppercase tracking-wider text-zinc-500 bg-white dark:bg-zinc-950 border-2 border-black dark:border-zinc-800 px-2.5 py-1">
                        {t("market.heatmap.flow")}: <span className="text-zinc-950 dark:text-white">{flow.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP</span>
                    </span>
                    <span className={`text-[10px] font-black font-mono uppercase tracking-wider border-2 border-black dark:border-zinc-800 px-2.5 py-1 ${pct >= 0 ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10" : "text-rose-700 dark:text-rose-400 bg-rose-500/10"}`}>
                        {pct >= 0 ? "+" : ""}{Number(pct).toFixed(2)}%
                    </span>
                    <span className="text-[10px] font-black font-mono uppercase tracking-wider text-zinc-500 bg-white dark:bg-zinc-950 border-2 border-black dark:border-zinc-800 px-2.5 py-1">
                        {stocks.length} {t("market.heatmap.active_stocks_count")}
                    </span>
                </div>

                {/* Table */}
                <div className="overflow-auto flex-1">
                    <table className="w-full text-xs whitespace-nowrap table-auto border-collapse bg-white dark:bg-zinc-950">
                        <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-b-2 border-black dark:border-zinc-800">
                            <tr>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "السهم" : "Symbol"}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "الشركة" : "Company Name"}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "السعر" : "Close Price"}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "التغير" : "Change %"}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "السيولة المتداولة" : "Money Flow"}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "الوزن بالقطاع" : "Sector Weight"}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-medium text-zinc-900 dark:text-zinc-100">
                            {stocks.map((st: any) => {
                                const wPct = totalWeight > 0 ? ((st.money_flow ?? 0) / totalWeight * 100) : (st.weight_in_sector ?? 0);
                                return (
                                    <tr
                                        key={st.symbol}
                                        className={`hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${isAr ? "text-right" : "text-left"}`}
                                    >
                                        <td className={`px-4 py-3 font-black text-indigo-500 hover:underline ${isAr ? "text-right" : "text-left"}`}>
                                            <a href={`/stocks/${st.symbol}`}>{st.symbol}</a>
                                        </td>
                                        <td className={`px-4 py-3 text-zinc-500 dark:text-zinc-400 font-semibold truncate max-w-xs ${isAr ? "text-right" : "text-left"}`}>{st.name}</td>
                                        <td className="px-4 py-3 font-mono font-bold">{(st.close ?? 0).toFixed(2)} <span className="text-[9px] text-zinc-500">EGP</span></td>
                                        <td className={`px-4 py-3 font-mono font-bold ${(st.change_pct ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                            {(st.change_pct ?? 0) >= 0 ? "+" : ""}{(st.change_pct ?? 0).toFixed(2)}%
                                        </td>
                                        <td className="px-4 py-3 font-mono text-zinc-600 dark:text-zinc-400">
                                            {(st.money_flow ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-[9px]">EGP</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-zinc-500">
                                            <div className="flex items-center gap-2">
                                                <div className="w-16 h-1.5 bg-zinc-200 dark:bg-zinc-800">
                                                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, Math.max(0, wPct))}%` }} />
                                                </div>
                                                <span>{wPct.toFixed(1)}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {stocks.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 gap-2">
                            <AlertTriangle className="w-7 h-7 text-zinc-500" />
                            <p className="text-xs font-mono text-zinc-500">{isAr ? "لا توجد أسهم متاحة في هذا القطاع" : "No stocks available in this sector"}</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={`flex items-center justify-between gap-3 px-5 sm:px-6 py-3 border-t-2 border-black dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                    <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase">
                        {t("market.heatmap.active_stocks_count")}: {stocks.length}
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-black dark:bg-white text-[#FFE600] dark:text-black font-black text-[10px] uppercase tracking-widest border-2 border-black dark:border-white shadow-[2px_2px_0px_rgba(0,0,0,0.4)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
                    >
                        {t("market.heatmap.modal_close")}
                    </button>
                </div>
            </div>
        </div>
    );

    if (!mounted || typeof document === "undefined") return null;
    return createPortal(modal, document.body);
};

const HEDGE_RATING_META: Record<string, { key: string; cls: string; dot: string }> = {
    "High Protection": { key: "market.hedge_filter_high", cls: "bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    "Moderate Protection": { key: "market.hedge_filter_moderate", cls: "bg-amber-500/10 border-amber-500 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
    "Low Protection": { key: "market.hedge_filter_low", cls: "bg-zinc-500/10 border-zinc-500 text-zinc-600 dark:text-zinc-400", dot: "bg-zinc-500" },
};

const HedgeFiltersSection = ({ scan, loading, error, filter, query, isAr, t, onFilter, onQuery, onScan, onRescan, onPickSymbol }: {
    scan: any;
    loading: boolean;
    error: string | null;
    filter: "all" | "high" | "moderate" | "low";
    query: string;
    isAr: boolean;
    t: (k: string) => string;
    onFilter: (f: "all" | "high" | "moderate" | "low") => void;
    onQuery: (q: string) => void;
    onScan: () => void;
    onRescan: () => void;
    onPickSymbol: (sym: string) => void;
}) => {
    const all: any[] = scan?.symbols ?? [];

    const filtered = useMemo(() => {
        let list = all;
        if (filter === "high") list = list.filter((s) => s.rating === "High Protection");
        else if (filter === "moderate") list = list.filter((s) => s.rating === "Moderate Protection");
        else if (filter === "low") list = list.filter((s) => s.rating === "Low Protection");
        const q = query.trim().toLowerCase();
        if (q) list = list.filter((s) => String(s.symbol).toLowerCase().includes(q));
        return list;
    }, [all, filter, query]);

    const counts = useMemo(() => ({
        all: all.length,
        high: all.filter((s) => s.rating === "High Protection").length,
        moderate: all.filter((s) => s.rating === "Moderate Protection").length,
        low: all.filter((s) => s.rating === "Low Protection").length,
    }), [all]);

    const chips: { id: typeof filter; label: string; count: number }[] = [
        { id: "all", label: t("market.hedge_filter_all"), count: counts.all },
        { id: "high", label: t("market.hedge_filter_high"), count: counts.high },
        { id: "moderate", label: t("market.hedge_filter_moderate"), count: counts.moderate },
        { id: "low", label: t("market.hedge_filter_low"), count: counts.low },
    ];

    return (
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.15)] mb-10 rounded-none font-sans">
            <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 border-b-4 border-black dark:border-zinc-800 pb-4 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                <div className={isAr ? "text-right" : "text-left"}>
                    <h3 className="text-xl sm:text-2xl font-black text-zinc-950 dark:text-white uppercase tracking-tight flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-indigo-500" />
                        {t("market.hedge_filters_title")}
                    </h3>
                    <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">
                        {t("market.hedge_filters_desc")}
                    </p>
                </div>
                <button
                    onClick={() => (all.length > 0 ? onRescan() : onScan())}
                    disabled={loading}
                    className={`self-start md:self-auto shrink-0 px-4 py-2.5 bg-black dark:bg-white text-[#FFE600] dark:text-black font-black text-[10px] uppercase tracking-widest border-2 border-black dark:border-white shadow-[3px_3px_0px_rgba(0,0,0,0.4)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer flex items-center gap-2 ${loading ? "opacity-60 cursor-wait" : "hover:bg-zinc-800 dark:hover:bg-zinc-200"}`}
                >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {all.length > 0 ? t("market.hedge_rescan") : t("market.hedge_scan")}
                </button>
            </div>

            {/* Filter chips + search */}
            <div className={`flex flex-col lg:flex-row gap-3 mb-5 ${isAr ? "lg:flex-row-reverse" : "lg:flex-row"}`}>
                <div className={`flex flex-wrap gap-2 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                    {chips.map((c) => (
                        <button
                            key={c.id}
                            onClick={() => onFilter(c.id)}
                            disabled={all.length === 0 && c.id !== "all"}
                            className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider border-2 transition-all cursor-pointer flex items-center gap-2 ${
                                filter === c.id
                                    ? "bg-indigo-600 border-indigo-600 text-white shadow-[2px_2px_0px_rgba(99,102,241,0.4)]"
                                    : "bg-white dark:bg-zinc-900 border-black dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            } ${all.length === 0 && c.id !== "all" ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                            {c.label}
                            <span className={`px-1.5 py-0.5 text-[9px] font-mono ${filter === c.id ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-800"}`}>{c.count}</span>
                        </button>
                    ))}
                </div>
                <div className={`relative lg:w-64 ${isAr ? "lg:mr-auto" : "lg:ml-auto"}`}>
                    <Search className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-2.5" : "left-2.5"} w-3.5 h-3.5 text-zinc-400 pointer-events-none`} />
                    <input
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        placeholder={t("market.search_symbol")}
                        disabled={all.length === 0}
                        className={`w-full bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-white font-mono text-xs py-2.5 ${isAr ? "pr-9 pl-3 text-right" : "pl-9 pr-3 text-left"} border-2 border-black dark:border-zinc-700 focus:outline-none focus:border-indigo-500 placeholder:text-zinc-400 disabled:opacity-40`}
                    />
                </div>
            </div>

            {/* Body */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 border-2 border-dashed border-zinc-300 dark:border-zinc-800">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <p className="text-xs font-mono text-zinc-500">{t("market.hedge_scan_loading")}</p>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border-2 border-dashed border-rose-300 dark:border-rose-900">
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                    <p className="text-xs font-mono text-zinc-500">{error}</p>
                    <button onClick={onScan} className="px-4 py-2 bg-indigo-600 text-white font-bold text-xs uppercase hover:bg-indigo-700 transition-colors">
                        {t("market.hedge_scan")}
                    </button>
                </div>
            ) : all.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-4 text-center border-2 border-dashed border-zinc-300 dark:border-zinc-800">
                    <Layers className="w-10 h-10 text-zinc-400" />
                    <p className="text-xs font-mono text-zinc-500 max-w-md">{isAr ? "اضغط \"افحص السوق\" لحساب تصنيفات التحوط لكل أسهم البورصة المصرية دفعة واحدة." : "Click \"Scan Market\" to compute hedge ratings for every EGX stock at once."}</p>
                    <button onClick={onScan} className="px-5 py-2.5 bg-indigo-600 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-colors flex items-center gap-2">
                        <DollarSign className="w-4 h-4" />
                        {t("market.hedge_scan")}
                    </button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 border-2 border-dashed border-zinc-300 dark:border-zinc-800">
                    <AlertTriangle className="w-7 h-7 text-zinc-500" />
                    <p className="text-xs font-mono text-zinc-500">{t("market.hedge_empty")}</p>
                </div>
            ) : (
                <div className="overflow-x-auto border-2 border-black dark:border-zinc-800 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,0.15)] max-h-[420px] overflow-y-auto">
                    <table className="w-full text-xs whitespace-nowrap table-auto border-collapse bg-white dark:bg-zinc-950">
                        <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-b-2 border-black dark:border-zinc-800">
                            <tr>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{t("market.hedge_col_symbol")}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{t("market.hedge_col_usd")}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{t("market.hedge_col_gold")}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{t("market.hedge_col_rating")}</th>
                                <th className={`px-4 py-3 font-black text-[10px] uppercase tracking-wider ${isAr ? "text-right" : "text-left"}`}>{isAr ? "إجراء" : "Action"}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-medium text-zinc-900 dark:text-zinc-100">
                            {filtered.map((s) => {
                                const meta = HEDGE_RATING_META[s.rating] ?? HEDGE_RATING_META["Low Protection"];
                                return (
                                    <tr key={s.symbol} className={`hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${isAr ? "text-right" : "text-left"}`}>
                                        <td className={`px-4 py-3 font-black text-indigo-500 ${isAr ? "text-right" : "text-left"}`}>{s.symbol}</td>
                                        <td className="px-4 py-3 font-mono font-bold">
                                            <span className={(s.corr_usd_parallel ?? 0) >= 0.3 ? "text-emerald-500" : (s.corr_usd_parallel ?? 0) >= 0 ? "text-amber-500" : "text-rose-500"}>
                                                {(s.corr_usd_parallel ?? 0) >= 0 ? "+" : ""}{Number(s.corr_usd_parallel ?? 0).toFixed(2)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono font-bold">
                                            <span className={(s.corr_gold ?? 0) >= 0.3 ? "text-emerald-500" : (s.corr_gold ?? 0) >= 0 ? "text-amber-500" : "text-rose-500"}>
                                                {(s.corr_gold ?? 0) >= 0 ? "+" : ""}{Number(s.corr_gold ?? 0).toFixed(2)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider border-2 ${meta.cls}`}>
                                                <span className={`w-2 h-2 ${meta.dot}`} />
                                                {t(meta.key)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => onPickSymbol(s.symbol)}
                                                className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors cursor-pointer"
                                            >
                                                {isAr ? "حلّل" : "Analyze"}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {scan?.updated_at && all.length > 0 && !loading && (
                <p className={`mt-3 text-[10px] font-mono text-zinc-400 ${isAr ? "text-right" : "text-left"}`}>
                    {t("market.last_updated")} {new Date(scan.updated_at).toLocaleString(isAr ? "ar-EG" : "en-US")}
                </p>
            )}
        </div>
    );
};

const formatMonth = (m: string, isAr: boolean) => {
    try {
        const [y, mo] = m.split("-");
        const date = new Date(Number(y), Number(mo) - 1, 1);
        return date.toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", year: "2-digit" });
    } catch {
        return m;
    }
};

const flowM = (v: number) => (Math.abs(v) / 1_000_000).toFixed(0);

const MoneyFlowTimeline = ({ data, loading, error, isAr, t, onRefresh }: {
    data: any;
    loading: boolean;
    error: string | null;
    isAr: boolean;
    t: (k: string) => string;
    onRefresh: () => void;
}) => {
    const [selMonth, setSelMonth] = useState<string | null>(null);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-3 border-2 border-dashed border-zinc-300 dark:border-zinc-800">
                <Loader2 className="w-7 h-7 animate-spin text-[#FFDC58]" />
                <p className="text-xs font-mono text-zinc-500">{isAr ? "جاري تحميل خط سير السيولة..." : "Loading liquidity timeline..."}</p>
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-10 gap-2 border-2 border-dashed border-rose-300 dark:border-rose-900 text-center">
                <AlertTriangle className="w-7 h-7 text-rose-500" />
                <p className="text-xs font-mono text-zinc-500">{error}</p>
            </div>
        );
    }
    if (!data || !data.monthly || data.monthly.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-10 gap-2 border-2 border-dashed border-zinc-300 dark:border-zinc-800 text-center">
                <AlertTriangle className="w-7 h-7 text-zinc-500" />
                <p className="text-xs font-mono text-zinc-500">{isAr ? "لا توجد بيانات متاحة" : "No timeline data available"}</p>
            </div>
        );
    }

    const monthly: any[] = data.monthly;
    const sectors: any[] = data.sectors ?? [];
    const maxFlow = Math.max(...monthly.map((m) => m.total_flow || 0), 1);
    const activeMonth = selMonth ?? monthly[monthly.length - 1].month;
    const activeData = monthly.find((m) => m.month === activeMonth) ?? monthly[monthly.length - 1];

    // Build per-sector net for the active month (sorted)
    const sectorNets = sectors
        .map((sec) => {
            const s = (sec.series ?? []).find((x: any) => x.month === activeMonth);
            return {
                sector: sec.sector,
                sector_ar: sec.sector_ar,
                total_flow: sec.total_flow,
                flow: s?.flow ?? 0,
                net: s?.net ?? 0,
            };
        })
        .sort((a, b) => b.net - a.net);
    const inflowSectors = sectorNets.filter((s) => s.net > 0);
    const outflowSectors = sectorNets.filter((s) => s.net < 0).reverse();

    return (
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,0.15)]">
            {/* Header */}
            <div className={`flex items-center justify-between gap-3 px-4 py-3 bg-[#FFDC58] ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                <h4 className="text-xs font-black text-black uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    {t("market.heatmap.timeline_title")}
                </h4>
                <button
                    onClick={onRefresh}
                    disabled={loading}
                    className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase border-2 border-black bg-black text-[#FFDC58] active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer ${loading ? "opacity-60 cursor-wait" : "hover:bg-zinc-800"}`}
                >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {isAr ? "تحديث" : "Refresh"}
                </button>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
                {/* 1. Simple Bar Chart — total market liquidity per month */}
                <div>
                    <div className={`flex items-baseline justify-between mb-3 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="text-xs font-black text-zinc-950 dark:text-white uppercase tracking-wider">{t("market.heatmap.timeline_total_market")}</span>
                        <span className="text-[10px] font-mono text-zinc-400">{monthly.length} {isAr ? "شهر" : "months"}</span>
                    </div>
                    <div className={`flex items-end justify-between gap-1.5 sm:gap-3 h-32 border-b-2 border-black dark:border-zinc-800 pb-1 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        {monthly.map((m) => {
                            const pct = m.total_flow > 0 ? (m.total_flow / maxFlow) * 100 : 0;
                            const isActive = m.month === activeMonth;
                            return (
                                <button
                                    key={m.month}
                                    onClick={() => setSelMonth(m.month)}
                                    className="flex-1 h-full flex flex-col items-center justify-end gap-1.5 cursor-pointer group min-w-0"
                                >
                                    {/* value label */}
                                    <span className={`text-[8px] sm:text-[9px] font-mono font-black transition-opacity ${isActive ? "text-zinc-950 dark:text-white opacity-100" : "text-zinc-400 opacity-0 group-hover:opacity-100"}`}>
                                        {flowM(m.total_flow)}M
                                    </span>
                                    {/* bar */}
                                    <div
                                        className={`w-full rounded-t-none border-2 border-b-0 transition-all duration-200 ${isActive ? "border-black dark:border-white" : "border-black/30 dark:border-white/20 group-hover:border-black dark:group-hover:border-white"}`}
                                        style={{
                                            height: `${Math.max(2, pct)}%`,
                                            backgroundColor: isActive ? "#FFDC58" : "#d4d4d8",
                                        }}
                                    />
                                </button>
                            );
                        })}
                    </div>
                    {/* month labels */}
                    <div className={`flex justify-between gap-1.5 sm:gap-3 mt-1.5 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        {monthly.map((m) => {
                            const isActive = m.month === activeMonth;
                            return (
                                <button
                                    key={m.month}
                                    onClick={() => setSelMonth(m.month)}
                                    className={`flex-1 text-center text-[8px] sm:text-[9px] font-mono font-black uppercase transition-colors cursor-pointer ${isActive ? "text-[#FFDC58]" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
                                >
                                    {formatMonth(m.month, isAr)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 2. Money movement for selected month */}
                <div>
                    <p className={`text-xs font-bold text-zinc-500 mb-3 ${isAr ? "text-right" : "text-left"}`}>
                        {t("market.heatmap.timeline_month_select")}
                        {" — "}
                        <span className="font-black text-zinc-950 dark:text-white">{formatMonth(activeMonth, isAr)}</span>
                    </p>

                    {inflowSectors.length === 0 && outflowSectors.length === 0 ? (
                        <div className="flex items-center justify-center py-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                            <p className="text-xs font-mono text-zinc-400">{t("market.heatmap.timeline_no_movement")}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Money entered */}
                            <div className="border-2 border-emerald-600 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30">
                                <div className={`flex items-center gap-2 px-3 py-2 border-b-2 border-emerald-600 bg-emerald-600 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                                    <ArrowUpRight className="w-4 h-4 text-white shrink-0" />
                                    <span className="text-[10px] font-black uppercase text-white tracking-wider">{t("market.heatmap.timeline_inflow")}</span>
                                </div>
                                <div className="divide-y divide-emerald-200 dark:divide-emerald-900/50">
                                    {inflowSectors.length === 0 ? (
                                        <p className="px-3 py-4 text-[10px] font-mono text-zinc-400 text-center">{t("market.heatmap.timeline_neutral")}</p>
                                    ) : inflowSectors.slice(0, 4).map((s) => (
                                        <div key={s.sector} className={`flex items-center justify-between gap-2 px-3 py-2 ${isAr ? "flex-row-reverse text-right" : "flex-row text-left"}`}>
                                            <span className="text-xs font-black text-zinc-950 dark:text-white truncate">{isAr ? s.sector_ar : s.sector}</span>
                                            <span className="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400 shrink-0">+{flowM(s.net)}M</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Money exited */}
                            <div className="border-2 border-rose-600 dark:border-rose-600 bg-rose-50 dark:bg-rose-950/30">
                                <div className={`flex items-center gap-2 px-3 py-2 border-b-2 border-rose-600 bg-rose-600 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                                    <ArrowDownRight className="w-4 h-4 text-white shrink-0" />
                                    <span className="text-[10px] font-black uppercase text-white tracking-wider">{t("market.heatmap.timeline_outflow")}</span>
                                </div>
                                <div className="divide-y divide-rose-200 dark:divide-rose-900/50">
                                    {outflowSectors.length === 0 ? (
                                        <p className="px-3 py-4 text-[10px] font-mono text-zinc-400 text-center">{t("market.heatmap.timeline_neutral")}</p>
                                    ) : outflowSectors.slice(0, 4).map((s) => (
                                        <div key={s.sector} className={`flex items-center justify-between gap-2 px-3 py-2 ${isAr ? "flex-row-reverse text-right" : "flex-row text-left"}`}>
                                            <span className="text-xs font-black text-zinc-950 dark:text-white truncate">{isAr ? s.sector_ar : s.sector}</span>
                                            <span className="text-xs font-mono font-black text-rose-600 dark:text-rose-400 shrink-0">{flowM(s.net)}M</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 3. Simple sector list with trend indicators */}
                <div>
                    <div className={`flex items-baseline justify-between mb-2 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="text-xs font-black text-zinc-950 dark:text-white uppercase tracking-wider">{isAr ? "حركة القطاعات" : "Sector Movement"}</span>
                        <span className="text-[10px] font-mono text-zinc-400">{t("market.heatmap.timeline_trend")}</span>
                    </div>
                    <div className="space-y-1">
                        {sectors.slice(0, 8).map((sec) => {
                            const series: any[] = sec.series ?? [];
                            const lastNet = series.length > 1 ? series[series.length - 1].net : 0;
                            const prevNet = series.length > 2 ? series[series.length - 2].net : 0;
                            const growing = lastNet > prevNet;
                            const declining = lastNet < prevNet;
                            const trendIcon = growing ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                                : declining ? <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
                                : <Activity className="w-3.5 h-3.5 text-zinc-400" />;
                            const trendLabel = growing ? t("market.heatmap.timeline_growing")
                                : declining ? t("market.heatmap.timeline_declining")
                                : t("market.heatmap.timeline_neutral");
                            const trendColor = growing ? "text-emerald-500" : declining ? "text-rose-500" : "text-zinc-400";
                            const flowPct = sec.total_flow > 0 ? (sec.total_flow / Math.max(...sectors.map((x) => x.total_flow), 1)) * 100 : 0;
                            return (
                                <div key={sec.sector} className={`flex items-center gap-3 px-3 py-2 border border-black/10 dark:border-white/10 ${isAr ? "flex-row-reverse text-right" : "flex-row text-left"}`}>
                                    <span className="text-xs font-black text-zinc-950 dark:text-white truncate min-w-0 flex-1">{isAr ? sec.sector_ar : sec.sector}</span>
                                    {/* mini flow bar */}
                                    <div className="hidden sm:block w-20 h-2.5 bg-zinc-100 dark:bg-zinc-900 shrink-0">
                                        <div className="h-full bg-[#FFDC58]" style={{ width: `${Math.max(3, flowPct)}%` }} />
                                    </div>
                                    <span className="text-[10px] font-mono font-black text-zinc-700 dark:text-zinc-300 shrink-0 w-16 text-center">{flowM(sec.total_flow)}M</span>
                                    <span className={`flex items-center gap-1 shrink-0 w-20 justify-end ${trendColor}`}>
                                        {trendIcon}
                                        <span className="text-[9px] font-black uppercase">{trendLabel}</span>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function MarketClient() {
    const { t, language } = useLanguage();
    const isAr = language === "ar";

    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<MarketStatusResponse | null>(null);
    const [activeTab, setActiveTab] = useState<"egx30" | "egx100" | "usdegp">("egx30");

    const [heatmapData, setHeatmapData] = useState<any>(null);
    const [heatmapLoading, setHeatmapLoading] = useState<boolean>(true);
    const [heatmapError, setHeatmapError] = useState<string | null>(null);
    const [selectedSector, setSelectedSector] = useState<any>(null);
    const [drillOpen, setDrillOpen] = useState<boolean>(false);
    const [timelineData, setTimelineData] = useState<any>(null);
    const [timelineLoading, setTimelineLoading] = useState<boolean>(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);
    const [timelineOpen, setTimelineOpen] = useState<boolean>(false);

    const openDrill = (sec: any) => {
        setSelectedSector(sec);
        setDrillOpen(true);
    };

    // Macro correlation states
    const [corrSymbols, setCorrSymbols] = useState<string[]>([]);
    const [selectedCorrSymbol, setSelectedCorrSymbol] = useState<string>("FWRY");
    const [corrData, setCorrData] = useState<any>(null);
    const [corrLoading, setCorrLoading] = useState<boolean>(false);
    const [corrError, setCorrError] = useState<string | null>(null);

    // Hedge scan states
    const [hedgeScan, setHedgeScan] = useState<any>(null);
    const [hedgeLoading, setHedgeLoading] = useState<boolean>(false);
    const [hedgeError, setHedgeError] = useState<string | null>(null);
    const [hedgeFilter, setHedgeFilter] = useState<"all" | "high" | "moderate" | "low">("all");
    const [hedgeQuery, setHedgeQuery] = useState<string>("");

    const fetchMarketStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/market/status");
            if (!res.ok) {
                throw new Error(`Failed to load market data (Status ${res.status})`);
            }
            const payload: MarketStatusResponse = await res.json();
            setData(payload);
        } catch (err: any) {
            console.error("Error fetching market status:", err);
            setError(err.message || "Failed to load market data");
        } finally {
            setLoading(false);
        }
    };

    const fetchHeatmapData = async () => {
        setHeatmapLoading(true);
        setHeatmapError(null);
        try {
            const res = await fetch("/api/scan/sectors/heatmap?country=Egypt");
            if (!res.ok) {
                throw new Error(`Failed to load heatmap data (Status ${res.status})`);
            }
            const payload = await res.json();
            setHeatmapData(payload);
            if (payload?.sectors && payload.sectors.length > 0) {
                const first = payload.sectors[0];
                // Normalize to the same shape onSelect() uses
                setSelectedSector({
                    name: first.sector,
                    sector_ar: first.sector_ar,
                    value: first.money_flow,
                    change_pct: first.change_pct,
                    market_share: first.market_share,
                    sentiment: first.sentiment,
                    stocks: first.stocks,
                });
            }
        } catch (err: any) {
            console.error("Error fetching sector heatmap:", err);
            setHeatmapError(err.message || "Failed to load heatmap data");
        } finally {
            setHeatmapLoading(false);
        }
    };

    const fetchTimelineData = async (forceRefresh = false) => {
        setTimelineLoading(true);
        setTimelineError(null);
        try {
            const res = await fetch(`/api/scan/sectors/timeline?country=Egypt&months=6${forceRefresh ? "&force_refresh=true" : ""}`);
            if (!res.ok) {
                throw new Error(`Failed to load timeline data (Status ${res.status})`);
            }
            const payload = await res.json();
            setTimelineData(payload);
        } catch (err: any) {
            console.error("Error fetching sector timeline:", err);
            setTimelineError(err.message || "Failed to load timeline data");
        } finally {
            setTimelineLoading(false);
        }
    };

    const toggleTimeline = () => {
        const next = !timelineOpen;
        setTimelineOpen(next);
        if (next && !timelineData && !timelineLoading) {
            void fetchTimelineData();
        }
    };

    const fetchCorrSymbols = async () => {
        try {
            const res = await fetch("/api/market/macro-correlation/symbols");
            if (res.ok) {
                const payload = await res.json();
                if (payload.symbols && payload.symbols.length > 0) {
                    setCorrSymbols(payload.symbols);
                    const defaultSym = payload.symbols.includes("FWRY") ? "FWRY" : payload.symbols[0];
                    setSelectedCorrSymbol(defaultSym);
                }
            }
        } catch (err) {
            console.error("Error fetching correlation symbols:", err);
        }
    };

    const fetchCorrData = async (sym: string) => {
        if (!sym) return;
        setCorrLoading(true);
        setCorrError(null);
        try {
            const res = await fetch(`/api/market/macro-correlation/data?symbol=${sym}`);
            if (!res.ok) {
                throw new Error(`Failed to fetch correlation data (Status ${res.status})`);
            }
            const payload = await res.json();
            setCorrData(payload);
        } catch (err: any) {
            console.error("Error fetching correlation data:", err);
            setCorrError(err.message || "Failed to load correlation data");
        } finally {
            setCorrLoading(false);
        }
    };

    const fetchHedgeScan = async (forceRefresh = false) => {
        setHedgeLoading(true);
        setHedgeError(null);
        try {
            const res = await fetch(`/api/market/macro-correlation/scan${forceRefresh ? "?force_refresh=true" : ""}`);
            if (!res.ok) {
                throw new Error(`Failed to run hedge scan (Status ${res.status})`);
            }
            const payload = await res.json();
            setHedgeScan(payload);
        } catch (err: any) {
            console.error("Error fetching hedge scan:", err);
            setHedgeError(err.message || "Failed to run hedge scan");
        } finally {
            setHedgeLoading(false);
        }
    };

    useEffect(() => {
        void fetchMarketStatus();
        void fetchHeatmapData();
        void fetchCorrSymbols();
    }, []);

    useEffect(() => {
        if (selectedCorrSymbol) {
            void fetchCorrData(selectedCorrSymbol);
        }
    }, [selectedCorrSymbol]);

    const formatDate = (dateStr: string) => {
        if (!dateStr) return "";
        try {
            const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
            return new Date(dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", options);
        } catch {
            return dateStr;
        }
    };

    const getStats = (points: MarketDataPoint[]) => {
        if (!points || points.length < 2) return { last: 0, change: 0, changePct: 0 };
        const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1].close;
        const prev = sorted[sorted.length - 2].close;
        const change = last - prev;
        const changePct = (change / prev) * 100;
        return { last, change, changePct };
    };

    const egx30Stats = data?.egx30 ? getStats(data.egx30) : { last: 0, change: 0, changePct: 0 };
    const egx100Stats = data?.egx100 ? getStats(data.egx100) : { last: 0, change: 0, changePct: 0 };
    const usdegpStats = data?.usdegp ? getStats(data.usdegp) : { last: 0, change: 0, changePct: 0 };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const val = typeof payload[0].value === "number" ? payload[0].value : null;
            if (val === null) return null;
            const prevVal = activeChartData.length > 1 ? activeChartData[activeChartData.length - 2].close : val;
            const dayChange = val - prevVal;
            const up = dayChange >= 0;
            return (
                <div className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-3.5 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,0.2)] font-sans text-xs space-y-1.5 min-w-[160px]" dir={isAr ? "rtl" : "ltr"}>
                    <p className="text-zinc-500 font-black font-mono border-b border-black/10 dark:border-white/10 pb-1.5">{label}</p>
                    <p className="flex items-baseline justify-between gap-3">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase">{isAr ? "السعر" : "Price"}</span>
                        <span className="text-zinc-950 dark:text-white font-mono font-black text-sm">
                            {val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span className="text-[9px] text-zinc-500 dark:text-zinc-400 ml-1">EGP</span>
                        </span>
                    </p>
                    <p className="flex items-center justify-between gap-3">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase">{isAr ? "التغير" : "Change"}</span>
                        <span className={`font-mono font-black flex items-center gap-1 ${up ? "text-emerald-500" : "text-rose-500"}`}>
                            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {up ? "+" : ""}{dayChange.toFixed(2)}
                        </span>
                    </p>
                </div>
            );
        }
        return null;
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                <p className="text-sm font-mono text-zinc-600 dark:text-zinc-500">
                    {isAr ? "جاري تحميل بيانات وتحليلات السوق البورصة المصرية..." : "Loading EGX market data and analysis..."}
                </p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="market-error mx-auto max-w-[1600px] w-full px-4 py-8 md:px-6 mt-2">
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col items-center justify-center gap-6 text-center">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                    <div className="space-y-2">
                        <h3 className="text-base font-black text-zinc-950 dark:text-zinc-300 uppercase tracking-widest">
                            {isAr ? "فشل تحميل البيانات" : "Data Load Failed"}
                        </h3>
                        <p className="text-xs text-zinc-600 dark:text-zinc-500 font-semibold max-w-md">{error}</p>
                    </div>
                    <button
                        onClick={() => void fetchMarketStatus()}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 border-2 border-indigo-500 shadow-[3px_3px_0px_rgba(99,102,241,0.3)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {isAr ? "إعادة المحاولة" : "Retry"}
                    </button>
                </div>
            </div>
        );
    }

    const activeChartData =
        activeTab === "egx30" ? data.egx30 :
        activeTab === "egx100" ? data.egx100 :
        data.usdegp;

    const chartColor =
        activeTab === "usdegp" ? "#8B5CF6" :
        activeTab === "egx30" ? "#FFDC58" :
        "#10B981";
    const chartLabel =
        activeTab === "usdegp" ? "USD/EGP" :
        activeTab === "egx30" ? "EGX 30" :
        "EGX 100";

    const regime = data.regime || "sideways";

    const getRegimeDetails = (reg: string) => {
        switch (reg) {
            case "panic":
                return {
                    title: t("market.regime.panic.title"),
                    desc: t("market.regime.panic.desc"),
                    border: "border-red-500/30",
                    bg: "bg-red-500/5",
                    text: "text-red-400",
                    icon: "text-red-400"
                };
            case "trending_up":
                return {
                    title: t("market.regime.trending_up.title"),
                    desc: t("market.regime.trending_up.desc"),
                    border: "border-emerald-500/30",
                    bg: "bg-emerald-500/5",
                    text: "text-emerald-400",
                    icon: "text-emerald-400"
                };
            case "trending_down":
                return {
                    title: t("market.regime.trending_down.title"),
                    desc: t("market.regime.trending_down.desc"),
                    border: "border-amber-500/30",
                    bg: "bg-amber-500/5",
                    text: "text-amber-400",
                    icon: "text-amber-400"
                };
            case "sideways":
            default:
                return {
                    title: t("market.regime.sideways.title"),
                    desc: t("market.regime.sideways.desc"),
                    border: "border-blue-500/30",
                    bg: "bg-blue-500/5",
                    text: "text-blue-400",
                    icon: "text-blue-400"
                };
        }
    };

    const activeRegime = getRegimeDetails(regime);

    return (
        <div
            className="market-shell app-page-shell mx-auto max-w-[1600px] w-full px-4 py-8 md:px-6 md:py-12 mt-2 min-h-[calc(100vh-200px)]"
            dir={isAr ? "rtl" : "ltr"}
        >
            {/* Hero Banner */}
            <div className="relative overflow-hidden rounded-none border-4 border-black dark:border-white bg-[#FFE600] dark:bg-[#FFE600] text-black dark:text-white p-6 sm:p-8 md:p-12 mb-8 shadow-[6px_6px_0px_0px_#000000] dark:shadow-[6px_6px_0px_0px_#ffffff]">
                <div className="relative z-10 max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 border-2 border-black dark:border-black bg-black dark:bg-black text-[#FFE600] dark:text-[#FFE600] text-xs font-black uppercase tracking-wider">
                        <Activity className="w-3.5 h-3.5" />
                        {isAr ? "تحليل السوق" : "MARKET ANALYSIS"}
                    </div>
                    <h1 className="text-2xl sm:text-3xl md:text-5xl font-black text-black dark:text-white tracking-tight leading-tight uppercase">
                        {t("market.title")}
                    </h1>
                    <p className="text-black/80 dark:text-white/80 font-mono text-xs md:text-sm leading-relaxed font-semibold">
                        {t("market.subtitle")}
                    </p>
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-black/60 dark:text-white/60 font-bold">
                            {t("market.last_updated")} {new Date(data.updated_at).toLocaleTimeString(isAr ? "ar-EG" : "en-US")}
                        </span>
                        <button
                            onClick={() => void fetchMarketStatus()}
                            className="w-9 h-9 border-2 border-black dark:border-black bg-black dark:bg-black hover:bg-zinc-800 text-[#FFE600] flex items-center justify-center cursor-pointer active:translate-x-[1px] active:translate-y-[1px] transition-all shadow-[2px_2px_0px_rgba(0,0,0,0.3)]"
                            title={isAr ? "تحديث" : "Refresh"}
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 font-sans font-medium">
                {/* EGX 30 Card */}
                <div
                    onClick={() => setActiveTab("egx30")}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                        activeTab === "egx30" ? "!border-indigo-500 !shadow-[6px_6px_0px_0px_rgba(99,102,241,0.4)]" : "hover:border-zinc-400 dark:hover:border-zinc-500"
                    }`}
                >
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : "flex-row"} mb-3`}>
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t("market.egx30_card")}</span>
                        <Landmark className={`w-5 h-5 ${activeTab === "egx30" ? "text-indigo-400" : "text-zinc-500"}`} />
                    </div>
                    <div className={`flex items-baseline gap-2 ${isAr ? "justify-start flex-row-reverse" : "justify-start"}`}>
                        <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                            {egx30Stats.last.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{t("market.points")}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-4 font-mono ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className={`text-sm font-black flex items-center ${egx30Stats.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {egx30Stats.changePct >= 0 ? "+" : ""}{egx30Stats.changePct.toFixed(2)}%
                        </span>
                        {egx30Stats.changePct >= 0
                            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        }
                    </div>
                </div>

                {/* EGX 100 Card */}
                <div
                    onClick={() => setActiveTab("egx100")}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                        activeTab === "egx100" ? "!border-blue-500 !shadow-[6px_6px_0px_0px_rgba(59,130,246,0.4)]" : "hover:border-zinc-400 dark:hover:border-zinc-500"
                    }`}
                >
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : "flex-row"} mb-3`}>
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t("market.egx100_card")}</span>
                        <Layers className={`w-5 h-5 ${activeTab === "egx100" ? "text-blue-400" : "text-zinc-500"}`} />
                    </div>
                    <div className={`flex items-baseline gap-2 ${isAr ? "justify-start flex-row-reverse" : "justify-start"}`}>
                        <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                            {egx100Stats.last.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{t("market.points")}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-4 font-mono ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className={`text-sm font-black flex items-center ${egx100Stats.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {egx100Stats.changePct >= 0 ? "+" : ""}{egx100Stats.changePct.toFixed(2)}%
                        </span>
                        {egx100Stats.changePct >= 0
                            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        }
                    </div>
                </div>

                {/* USD/EGP Forex Card */}
                <div
                    onClick={() => void setActiveTab("usdegp")}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                        activeTab === "usdegp" ? "!border-purple-500 !shadow-[6px_6px_0px_0px_rgba(168,85,247,0.4)]" : "hover:border-zinc-400 dark:hover:border-zinc-500"
                    }`}
                >
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : "flex-row"} mb-3`}>
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t("market.usdegp_card")}</span>
                        <DollarSign className={`w-5 h-5 ${activeTab === "usdegp" ? "text-purple-400" : "text-zinc-500"}`} />
                    </div>
                    <div className={`flex items-baseline gap-2 ${isAr ? "justify-start flex-row-reverse" : "justify-start"}`}>
                        <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                            {usdegpStats.last.toFixed(2)}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{t("market.egp")}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-4 font-mono ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className={`text-sm font-black flex items-center ${usdegpStats.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {usdegpStats.changePct >= 0 ? "+" : ""}{usdegpStats.changePct.toFixed(2)}%
                        </span>
                        {usdegpStats.changePct >= 0
                            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        }
                    </div>
                </div>
            </div>

            {/* Current Market Regime Status */}
            <div className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] mb-10 font-sans ${activeRegime.border}`}>
                <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4`}>
                    <div className={`flex items-start gap-3.5 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${activeRegime.icon}`} />
                        <div className={isAr ? "text-right" : "text-left"}>
                            <h4 className={`text-sm font-black uppercase tracking-wider ${activeRegime.text}`}>
                                {t("market.regime_label")} {activeRegime.title}
                            </h4>
                            <p className="text-xs font-semibold text-zinc-700 dark:text-white/70 mt-1 max-w-2xl leading-relaxed">
                                {activeRegime.desc}
                            </p>
                        </div>
                    </div>
                    {data.reject_buys && (
                        <span className={`border-2 ${activeRegime.border} ${activeRegime.bg} ${activeRegime.text} px-3 py-1.5 text-[10px] font-black uppercase tracking-wider self-start md:self-auto shrink-0`}>
                            {t("market.buy_paused")}
                        </span>
                    )}
                </div>
            </div>

            {/* Main Chart Card */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] mb-10 rounded-none">
                <div className={`flex items-center justify-between mb-6 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="space-y-1">
                        <span className="text-xs font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-wider">
                            {activeTab === "egx30" ? t("market.tab_egx30_desc") :
                             activeTab === "egx100" ? t("market.tab_egx100_desc") :
                             t("market.tab_usdegp_desc")}
                        </span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: chartColor }} />
                        <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono uppercase font-bold">{activeTab}</span>
                    </div>
                </div>

                <div className="h-[380px] w-full" dir="ltr">
                    {activeChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={activeChartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.25}/>
                                        <stop offset="95%" stopColor={chartColor} stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-black/[0.06] dark:text-white/[0.03]" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    stroke="currentColor"
                                    className="text-zinc-500/70 dark:text-white/15"
                                    tick={{ fontSize: 9, fontFamily: 'monospace' }}
                                />
                                <YAxis
                                    domain={['auto', 'auto']}
                                    stroke="currentColor"
                                    className="text-zinc-500/70 dark:text-white/15"
                                    tick={{ fontSize: 9, fontFamily: 'monospace' }}
                                    orientation={isAr ? "left" : "right"}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="close"
                                    stroke={chartColor}
                                    strokeWidth={2.5}
                                    fillOpacity={1}
                                    fill="url(#chartGradient)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full w-full gap-3">
                            <AlertTriangle className="w-8 h-8 text-zinc-600" />
                            <p className="text-xs font-mono text-zinc-600 dark:text-zinc-500">{t("market.no_data")}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Smart Money Heatmap Section */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] mb-10 rounded-none">
                <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 border-b-4 border-black dark:border-zinc-800 pb-4 ${isAr ? "md:flex-row-reverse" : "md:flex-row"}`}>
                    <div className={isAr ? "text-right" : "text-left"}>
                        <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2 text-zinc-950 dark:text-white">
                            <span className="flex items-center justify-center w-8 h-8 bg-[#FFDC58] text-black border-2 border-black">
                                <Layers className="w-4.5 h-4.5" />
                            </span>
                            {t("market.heatmap.title")}
                        </h3>
                        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mt-1.5 max-w-2xl">
                            {t("market.heatmap.subtitle")}
                        </p>
                    </div>
                    {heatmapData?.updated_at && (
                        <span className={`font-mono text-[10px] text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border-2 border-black dark:border-zinc-700 px-3 py-1.5 self-start md:self-auto ${isAr ? "text-left" : "text-right"}`}>
                            <span className="text-zinc-400">{t("market.last_updated")}</span>
                            <br className="hidden sm:block" />
                            {new Date(heatmapData.updated_at).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                    )}
                </div>

                {heatmapLoading ? (
                    <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
                        <Loader2 className="w-8 h-8 animate-spin text-[#FFDC58]" />
                        <p className="text-xs font-mono text-zinc-500">
                            {isAr ? "جاري تحميل خريطة سيولة القطاعات..." : "Loading sector money heatmap..."}
                        </p>
                    </div>
                ) : heatmapError || !heatmapData ? (
                    <div className="flex flex-col items-center justify-center min-h-[250px] text-center border-2 border-dashed border-zinc-300 dark:border-zinc-800 gap-3">
                        <AlertTriangle className="w-8 h-8 text-rose-500" />
                        <p className="text-xs text-zinc-500 font-semibold">{heatmapError || "No heatmap data found."}</p>
                        <button
                            onClick={() => void fetchHeatmapData()}
                            className="px-4 py-2 bg-black dark:bg-white text-[#FFDC58] dark:text-black font-black text-xs uppercase border-2 border-black dark:border-white shadow-[2px_2px_0px_rgba(0,0,0,0.4)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all hover:bg-zinc-800 dark:hover:bg-zinc-200"
                        >
                            {isAr ? "إعادة تحميل الخريطة" : "Retry Loading Heatmap"}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* Sentiment Legend */}
                        <div className={`flex flex-wrap gap-2 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                                <span className="w-3 h-3 bg-emerald-700 border border-black/20 inline-block" />
                                <span className="text-[10px] font-black text-zinc-700 dark:text-zinc-300 uppercase font-mono">{t("market.heatmap.strong_accumulation")}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                                <span className="w-3 h-3 bg-emerald-500 border border-black/20 inline-block" />
                                <span className="text-[10px] font-black text-zinc-700 dark:text-zinc-300 uppercase font-mono">{t("market.heatmap.accumulation")}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                                <span className="w-3 h-3 bg-zinc-400 border border-black/20 inline-block" />
                                <span className="text-[10px] font-black text-zinc-700 dark:text-zinc-300 uppercase font-mono">{t("market.heatmap.neutral")}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                                <span className="w-3 h-3 bg-rose-500 border border-black/20 inline-block" />
                                <span className="text-[10px] font-black text-zinc-700 dark:text-zinc-300 uppercase font-mono">{t("market.heatmap.distribution")}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                                <span className="w-3 h-3 bg-rose-700 border border-black/20 inline-block" />
                                <span className="text-[10px] font-black text-zinc-700 dark:text-zinc-300 uppercase font-mono">{t("market.heatmap.strong_distribution")}</span>
                            </div>
                        </div>

                        {/* Treemap Render Container */}
                        <div className="h-[400px] w-full border-2 border-black dark:border-zinc-800 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,0.15)]" dir="ltr">
                            <SmartMoneyTreemap
                                sectors={heatmapData.sectors}
                                isAr={isAr}
                                selectedSector={selectedSector}
                                onSelect={(sec: any) => openDrill(sec)}
                            />
                        </div>

                        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 ${isAr ? "sm:flex-row-reverse" : "sm:flex-row"}`}>
                            <p className={`text-xs font-mono text-zinc-500 ${isAr ? "text-right" : "text-left"}`}>
                                {isAr ? "اضغط على أي قطاع لعرض تفاصيل أسهمه في نافذة منبثقة." : "Click any sector to view its stock breakdown in a popup."}
                            </p>
                            {heatmapData?.total_market_flow > 0 && (
                                <span className={`text-[10px] font-mono font-black text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border-2 border-black/10 dark:border-zinc-800 px-2.5 py-1 ${isAr ? "text-left" : "text-right"}`}>
                                    {isAr ? "إجمالي سيولة السوق" : "Total Market Flow"}: <span className="text-zinc-950 dark:text-white">{(heatmapData.total_market_flow / 1_000_000).toFixed(0)}M EGP</span>
                                </span>
                            )}
                        </div>

                        {/* Timeline toggle button */}
                        <div className={isAr ? "text-left" : "text-right"}>
                            <button
                                onClick={toggleTimeline}
                                className={`inline-flex items-center gap-2 px-4 py-2 text-[11px] font-black uppercase tracking-wider border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 shadow-[2px_2px_0px_rgba(0,0,0,0.4)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.15)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer hover:bg-[#FFDC58] hover:text-black ${isAr ? "flex-row-reverse" : "flex-row"}`}
                            >
                                <Activity className="w-3.5 h-3.5" />
                                {t("market.heatmap.timeline_title")}
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${timelineOpen ? "rotate-180" : ""}`} />
                            </button>
                        </div>

                        {/* Monthly Money-Flow Timeline */}
                        {timelineOpen && (
                            <MoneyFlowTimeline
                                data={timelineData}
                                loading={timelineLoading}
                                error={timelineError}
                                isAr={isAr}
                                t={t}
                                onRefresh={() => void fetchTimelineData(true)}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Sector Drill-down Modal */}
            {drillOpen && selectedSector && (
                <SectorDrillModal
                    sector={selectedSector}
                    isAr={isAr}
                    t={t}
                    onClose={() => setDrillOpen(false)}
                />
            )}

            {/* Ready Hedge Filters Section */}
            <HedgeFiltersSection
                scan={hedgeScan}
                loading={hedgeLoading}
                error={hedgeError}
                filter={hedgeFilter}
                query={hedgeQuery}
                isAr={isAr}
                t={t}
                onFilter={setHedgeFilter}
                onQuery={setHedgeQuery}
                onScan={() => void fetchHedgeScan(false)}
                onRescan={() => void fetchHedgeScan(true)}
                onPickSymbol={(sym) => {
                    setSelectedCorrSymbol(sym);
                    document.getElementById("macro-correlation-engine")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
            />

            {/* Macro-Correlation Engine Section */}
            <div id="macro-correlation-engine" className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.15)] mb-10 rounded-none font-sans scroll-mt-24">
                    <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b-4 border-black dark:border-zinc-800 pb-4 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <div className={isAr ? "text-right" : "text-left"}>
                            <h3 className="text-xl sm:text-2xl font-black text-zinc-950 dark:text-white uppercase tracking-tight flex items-center gap-2">
                                <Activity className="w-5 h-5 text-indigo-500" />
                                {t("market.correlation_engine_title")}
                            </h3>
                            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">
                                {t("market.correlation_engine_desc")}
                            </p>
                        </div>
                        
                        {/* Stock Selector Dropdown */}
                        <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-2 self-start md:self-auto ${isAr ? "sm:flex-row-reverse" : "sm:flex-row"}`}>
                            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 font-sans shrink-0">{t("market.select_stock")}:</span>
                            <SearchableSymbolSelect
                                symbols={corrSymbols}
                                value={selectedCorrSymbol}
                                onChange={(sym) => setSelectedCorrSymbol(sym)}
                                isAr={isAr}
                                t={t}
                            />
                        </div>
                    </div>

                    {corrLoading ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                            <p className="text-xs font-mono text-zinc-500">{isAr ? "جاري احتساب نسب الارتباط وعوامل التحوط..." : "Calculating correlation metrics and hedge factors..."}</p>
                        </div>
                    ) : corrError || !corrData ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                            <AlertTriangle className="w-8 h-8 text-amber-500" />
                            <p className="text-xs font-mono text-zinc-500">{corrError || (isAr ? "لا توجد بيانات متاحة حالياً" : "No correlation data available.")}</p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {/* Correlation Indicator Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                {/* Official USD Card */}
                                <div className="border-2 border-black dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col justify-between">
                                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("market.usd_official_corr")}</span>
                                    <div className="my-3 flex items-baseline gap-2">
                                        <span className={`text-3xl font-black font-mono ${corrData.corr_usd_official >= 0.5 ? "text-emerald-500" : corrData.corr_usd_official >= 0.2 ? "text-amber-500" : "text-zinc-500"}`}>
                                            {corrData.corr_usd_official >= 0 ? "+" : ""}{corrData.corr_usd_official.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5">
                                        <div 
                                            className={`h-full ${corrData.corr_usd_official >= 0.5 ? "bg-emerald-500" : corrData.corr_usd_official >= 0.2 ? "bg-amber-500" : "bg-zinc-500"}`} 
                                            style={{ width: `${Math.max(0, Math.min(1, (corrData.corr_usd_official + 1) / 2)) * 100}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Parallel USD Card */}
                                <div className="border-2 border-black dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col justify-between">
                                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("market.usd_parallel_corr")}</span>
                                    <div className="my-3 flex items-baseline gap-2">
                                        <span className={`text-3xl font-black font-mono ${corrData.corr_usd_parallel >= 0.5 ? "text-emerald-500" : corrData.corr_usd_parallel >= 0.2 ? "text-amber-500" : "text-zinc-500"}`}>
                                            {corrData.corr_usd_parallel >= 0 ? "+" : ""}{corrData.corr_usd_parallel.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5">
                                        <div 
                                            className={`h-full ${corrData.corr_usd_parallel >= 0.5 ? "bg-emerald-500" : corrData.corr_usd_parallel >= 0.2 ? "bg-amber-500" : "bg-zinc-500"}`} 
                                            style={{ width: `${Math.max(0, Math.min(1, (corrData.corr_usd_parallel + 1) / 2)) * 100}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Gold Card */}
                                <div className="border-2 border-black dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col justify-between">
                                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("market.gold_corr")}</span>
                                    <div className="my-3 flex items-baseline gap-2">
                                        <span className={`text-3xl font-black font-mono ${corrData.corr_gold >= 0.5 ? "text-emerald-500" : corrData.corr_gold >= 0.2 ? "text-amber-500" : "text-zinc-500"}`}>
                                            {corrData.corr_gold >= 0 ? "+" : ""}{corrData.corr_gold.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5">
                                        <div 
                                            className={`h-full ${corrData.corr_gold >= 0.5 ? "bg-emerald-500" : corrData.corr_gold >= 0.2 ? "bg-amber-500" : "bg-zinc-500"}`} 
                                            style={{ width: `${Math.max(0, Math.min(1, (corrData.corr_gold + 1) / 2)) * 100}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Hedge Rating Card */}
                                <div className="border-2 border-black dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col justify-between">
                                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("market.inflation_hedge_rating")}</span>
                                    <div className="my-2.5">
                                        <span className={`inline-block px-3 py-1.5 text-xs font-black uppercase tracking-wider border-2 ${
                                            corrData.rating === "High Protection" ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" :
                                            corrData.rating === "Moderate Protection" ? "bg-amber-500/10 border-amber-500 text-amber-500" :
                                            "bg-zinc-500/10 border-zinc-500 text-zinc-500"
                                        }`}>
                                            {corrData.rating === "High Protection" ? t("market.rating.high") :
                                             corrData.rating === "Moderate Protection" ? t("market.rating.moderate") :
                                             t("market.rating.low")}
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-bold text-zinc-400 font-mono">30-DAY ROLLING WINDOW</span>
                                </div>
                            </div>

                            {/* Interactive Chart */}
                            <div className="border-2 border-black dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900">
                                <h3 className={`text-sm font-black uppercase tracking-wider mb-4 ${isAr ? "text-right" : "text-left"}`}>
                                    {t("market.chart_comparison")}
                                </h3>
                                <div className="h-[280px] w-full" dir="ltr">
                                    {corrData.chart_data && corrData.chart_data.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={corrData.chart_data} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                                            <defs>
                                                <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                                </linearGradient>
                                                <linearGradient id="usdGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.25}/>
                                                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                                                </linearGradient>
                                                <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.25}/>
                                                    <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-black/[0.06] dark:text-white/[0.03]" />
                                            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 9, fontFamily: 'monospace' }} stroke="currentColor" className="text-zinc-500/70 dark:text-white/15" />
                                            <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} stroke="currentColor" className="text-zinc-500/70 dark:text-white/15" orientation="right" domain={[0, 100]} />
                                            <Tooltip
                                                content={({ active, payload, label }) => {
                                                    if (active && payload && payload.length && payload[0]?.payload) {
                                                        const d = payload[0].payload;
                                                        const stock = typeof d.stock === "number" ? d.stock : null;
                                                        const usd = typeof d.usd_parallel === "number" ? d.usd_parallel : null;
                                                        const gold = typeof d.gold_24k === "number" ? d.gold_24k : null;
                                                        return (
                                                            <div className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-3.5 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,0.2)] font-sans text-xs text-right space-y-1.5">
                                                                <p className="text-zinc-500 font-black font-mono border-b border-black/10 dark:border-white/10 pb-1.5 mb-1.5">{label}</p>
                                                                {stock !== null && (
                                                                    <p className="text-indigo-500 font-semibold font-mono flex items-center justify-between gap-4">
                                                                        <span className="inline-block w-2 h-2 bg-indigo-500" />
                                                                        <span>{selectedCorrSymbol}: <span className="font-black text-zinc-950 dark:text-white">{stock.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP</span></span>
                                                                    </p>
                                                                )}
                                                                {usd !== null && (
                                                                    <p className="text-purple-500 font-semibold font-mono flex items-center justify-between gap-4">
                                                                        <span className="inline-block w-2 h-2 bg-purple-500" />
                                                                        <span>{t("market.chart.usd_parallel")}: <span className="font-black text-zinc-950 dark:text-white">{usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP</span></span>
                                                                    </p>
                                                                )}
                                                                {gold !== null && (
                                                                    <p className="text-yellow-600 dark:text-yellow-500 font-semibold font-mono flex items-center justify-between gap-4">
                                                                        <span className="inline-block w-2 h-2 bg-yellow-500" />
                                                                        <span>{t("market.chart.gold_24k")}: <span className="font-black text-zinc-950 dark:text-white">{gold.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP</span></span>
                                                                    </p>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            <Area type="monotone" dataKey="stock_norm" stroke="#6366f1" strokeWidth={2} fill="url(#stockGrad)" name={selectedCorrSymbol} />
                                            <Area type="monotone" dataKey="usd_parallel_norm" stroke="#a855f7" strokeWidth={2} fill="url(#usdGrad)" name={t("market.chart.usd_parallel")} />
                                            <Area type="monotone" dataKey="gold_norm" stroke="#eab308" strokeWidth={2} fill="url(#goldGrad)" name={t("market.chart.gold_24k")} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full w-full gap-3">
                                            <AlertTriangle className="w-8 h-8 text-zinc-600" />
                                            <p className="text-xs font-mono text-zinc-600 dark:text-zinc-500">{isAr ? "لا توجد بيانات كافية لرسم المقارنة" : "Not enough data to render comparison"}</p>
                                        </div>
                                    )}
                                </div>

                                <div className={`flex flex-wrap items-center justify-center gap-4 mt-4 text-xs font-mono font-bold ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 bg-indigo-500 inline-block" />
                                        <span>{selectedCorrSymbol} ({t("market.chart.normalized")})</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 bg-purple-500 inline-block" />
                                        <span>{t("market.chart.usd_parallel")} ({t("market.chart.normalized")})</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 bg-yellow-500 inline-block" />
                                        <span>{t("market.chart.gold_24k")} ({t("market.chart.normalized")})</span>
                                    </div>
                                </div>
                            </div>

                            {/* Qualitative insights */}
                            <div className={`border-2 border-black dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/40 flex items-start gap-3 ${isAr ? "flex-row-reverse text-right" : "flex-row text-left"}`}>
                                <AlertCircle className="w-5 h-5 text-[#FFDC58] mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                    <h4 className="text-xs font-black text-zinc-950 dark:text-white uppercase tracking-wider">{t("market.insights_title")}</h4>
                                    <p className="text-xs font-semibold leading-relaxed text-zinc-700 dark:text-zinc-300">
                                        {(corrData.rating === "High Protection" ? t("market.insight.high") :
                                          corrData.rating === "Moderate Protection" ? t("market.insight.moderate") :
                                          t("market.insight.low")).replace("{symbol}", selectedCorrSymbol)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

        </div>
    );
}
