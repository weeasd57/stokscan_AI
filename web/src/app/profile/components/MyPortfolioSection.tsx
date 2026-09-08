"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    Loader2, RefreshCw, Plus, Trash2, Pencil, Check, X, Wallet,
    TrendingUp, TrendingDown, Coins, Save, BadgeDollarSign,
} from "lucide-react";
import { toast } from "sonner";

type PortfolioRow = {
    id: string;
    symbol: string;
    name: string | null;
    quantity: number | null;
    entry_price: number | null;
    last_price: number | null;
    market_value: number | null;
    cost_basis: number | null;
    profit_pct: number | null;
    profit_value: number | null;
};

type Snapshot = {
    ok: boolean;
    positions: PortfolioRow[];
    cash_balance: number;
    totals: {
        positions_count: number;
        cost_basis: number;
        market_value: number;
        profit_value: number;
        profit_pct: number;
        equity: number;
    };
    market_symbols?: Array<{ symbol: string; name: string | null }>;
    portfolio_limit?: number | null;
    is_pro?: boolean;
};

const money = (v: number | null | undefined, digits = 2) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

/** Allow digits and one decimal point only (Arabic digits normalized). */
const numericOnly = (value: string): string => {
    const normalized = value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const cleaned = normalized.replace(/[^\d.]/g, "");
    // Keep only the first decimal point
    const firstDot = cleaned.indexOf(".");
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
};

export default function MyPortfolioSection({ onPortfolioUpdated }: { onPortfolioUpdated?: () => void }) {
    const { user, loading: authLoading } = useAuth();
    const { language } = useLanguage();
    const isAr = language === "ar";

    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    // add form
    const [showAdd, setShowAdd] = useState(false);
    const [addSymbol, setAddSymbol] = useState("");
    const [addQty, setAddQty] = useState("");
    const [addPrice, setAddPrice] = useState("");
    const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);

    // inline edit
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editQty, setEditQty] = useState("");
    const [editPrice, setEditPrice] = useState("");

    // cash edit
    const [cashDraft, setCashDraft] = useState("");
    const [editingCash, setEditingCash] = useState(false);

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const res = await fetch("/api/portfolio", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                setSnapshot(data);
                setCashDraft(data.cash_balance ? String(Math.round(data.cash_balance)) : "0");
            }
        } catch (e) {
            console.error("Failed to load portfolio:", e);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        void load();
    }, [load]);

    const api = useCallback(async (body: Record<string, unknown>) => {
        setBusy(true);
        try {
            const res = await fetch("/api/portfolio", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.ok) {
                toast.success(data.message);
                window.dispatchEvent(new Event("portfolio-updated"));
            } else {
                toast.error(data.message || "Failed");
            }
            await load();
            onPortfolioUpdated?.();
            return data.ok;
        } catch (e: any) {
            toast.error(e?.message || "Connection failed");
            return false;
        } finally {
            setBusy(false);
        }
    }, [load, onPortfolioUpdated]);

    const handleAdd = async () => {
        const qty = parseFloat(addQty);
        if (!addSymbol.trim() || !Number.isFinite(qty) || qty <= 0) {
            toast.error(isAr ? "اكتب رمز سهم صحيح من القائمة وعدد صحيح للأسهم" : "Pick a valid symbol and enter a valid quantity");
            return;
        }
        const symbolList = snapshot?.market_symbols || [];
        const exactMatch = symbolList.find((s) => s.symbol === addSymbol.trim().toUpperCase());
        if (!exactMatch) {
            toast.error(isAr ? `الرمز ${addSymbol} مش موجود في البورصة — اختاره من القائمة` : `${addSymbol} is not listed on EGX — pick from the list`);
            return;
        }
        if (snapshot?.portfolio_limit !== null && snapshot?.portfolio_limit !== undefined && !positions.some((p) => p.symbol === exactMatch.symbol) && positions.length >= snapshot.portfolio_limit) {
            toast.error(isAr ? `الخطة المجانية تسمح بحد أقصى ${snapshot.portfolio_limit} أسهم مختلفة.` : `The free plan allows up to ${snapshot.portfolio_limit} different stocks.`);
            return;
        }
        const price = addPrice.trim() ? parseFloat(addPrice) : null;
        const ok = await api({ action: "add", symbol: exactMatch.symbol, quantity: qty, price });
        if (ok) {
            setShowAdd(false);
            setAddSymbol("");
            setAddQty("");
            setAddPrice("");
        }
    };

    const handleSaveEdit = async (row: PortfolioRow) => {
        const qty = editQty.trim() ? parseFloat(editQty) : null;
        const price = editPrice.trim() ? parseFloat(editPrice) : null;
        const ok = await api({ action: "update", symbol: row.symbol, quantity: qty, price });
        if (ok) setEditingId(null);
    };

    const handleSell = async (row: PortfolioRow) => {
        if (!window.confirm(isAr ? `تسجيل بيع كل أسهم ${row.symbol} بسعر آخر إغلاق؟` : `Sell all ${row.symbol} at last close?`)) return;
        await api({ action: "sell", symbol: row.symbol, quantity: null, price: null });
    };

    const handleRemove = async (row: PortfolioRow) => {
        if (!window.confirm(isAr ? `حذف ${row.symbol} من المحفظة؟ (بدون تسجيل بيع)` : `Remove ${row.symbol} from portfolio? (no sale recorded)`)) return;
        const ok = await api({ action: "remove", symbol: row.symbol });
        if (ok) {
            setEditingId(null);
            toast.success(isAr ? `تم حذف ${row.symbol} من المحفظة وتحديث البيانات.` : `${row.symbol} was removed and the portfolio was refreshed.`);
        }
    };

    const handleSaveCash = async () => {
        const val = parseFloat(cashDraft);
        if (!Number.isFinite(val) || val < 0) {
            toast.error(isAr ? "قيمة غير صحيحة" : "Invalid amount");
            return;
        }
        const ok = await api({ action: "cash_set", quantity: val });
        if (ok) setEditingCash(false);
    };

    const handleDepositCash = async () => {
        const val = parseFloat(cashDraft);
        if (!Number.isFinite(val) || val <= 0) {
            toast.error(isAr ? "اكتب مبلغ أكبر من صفر للإيداع" : "Enter an amount greater than zero to deposit");
            return;
        }
        const ok = await api({ action: "cash_add", quantity: val });
        if (ok) {
            setEditingCash(false);
            setCashDraft(snapshot?.cash_balance ? String(Math.round(snapshot.cash_balance)) : "0");
        }
    };

    if (authLoading) return null;

    const totals = snapshot?.totals;
    const positions = snapshot?.positions || [];
    const totalProfit = totals?.profit_value ?? 0;

    return (
        <section className="relative z-10 neobrutal-card p-6 sm:p-8 space-y-6 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b-4 border-black dark:border-zinc-800 pb-5">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="h-10 w-10 border-4 border-black dark:border-white bg-emerald-500 text-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                            <Wallet className="h-5 w-5" />
                        </div>
                        <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">
                            {isAr ? "محفظتى" : "My Portfolio"}
                        </h2>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 font-black uppercase tracking-widest leading-relaxed">
                        {isAr
                            ? "أسهمك وسيولتك — حدّثها من هنا أو كلّم الشات بوت وهو يحدّثها لك"
                            : "Your holdings and cash — edit here or just tell the chatbot"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => void load()}
                        className="h-10 w-10 flex items-center justify-center border-4 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                        title={isAr ? "تحديث" : "Refresh"}
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <button
                        onClick={() => setShowAdd((v) => !v)}
                        className="h-10 px-4 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-400 text-black font-black text-xs uppercase tracking-widest shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                    >
                        <Plus className="h-4 w-4" />
                        {isAr ? "إضافة سهم" : "Add Stock"}
                    </button>
                </div>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/35 p-4 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">{isAr ? "القيمة السوقية" : "Market Value"}</span>
                    <span className="text-lg font-black text-black dark:text-white font-mono">{money(totals?.market_value)}</span>
                    <span className="text-[9px] text-zinc-500 font-bold block">{isAr ? "ج.م" : "EGP"}</span>
                </div>
                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/35 p-4 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">{isAr ? "الربح / الخسارة" : "P / L"}</span>
                    <span className={`text-lg font-black font-mono flex items-center gap-1.5 ${totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {totalProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {money(totalProfit)}
                    </span>
                    <span className={`text-[9px] font-black font-mono block ${totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {(totals?.profit_pct ?? 0) >= 0 ? "+" : ""}{money(totals?.profit_pct)}%
                    </span>
                </div>
                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/35 p-4 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">{isAr ? "السيولة" : "Cash"}</span>
                    {editingCash ? (
                        <div className="flex items-center gap-1.5">
                            <input
                                value={cashDraft}
                                onChange={(e) => setCashDraft(numericOnly(e.target.value))}
                                inputMode="decimal"
                                className="h-8 w-24 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 px-2 text-xs font-black font-mono text-black dark:text-white outline-none"
                            />
                            <button onClick={() => void handleSaveCash()} disabled={busy} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-emerald-400 text-black" title={isAr ? "حفظ القيمة" : "Save value"}>
                                <Check className="h-4 w-4" />
                            </button>
                            <button onClick={() => void handleDepositCash()} disabled={busy} className="h-8 flex items-center gap-1 px-2 border-2 border-black dark:border-white bg-amber-400 text-black" title={isAr ? "إيداع المبلغ على السيولة الحالية" : "Deposit amount on top of current cash"}>
                                <Plus className="h-4 w-4" />
                                <span className="text-[10px] font-black">{isAr ? "إيداع" : "Deposit"}</span>
                            </button>
                            <button onClick={() => { setEditingCash(false); setCashDraft(snapshot?.cash_balance ? String(Math.round(snapshot.cash_balance)) : "0"); }} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white" title="Cancel">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => setEditingCash(true)} className="text-left group" title={isAr ? "اضغط للتعديل" : "Click to edit"}>
                            <span className="text-lg font-black text-black dark:text-white font-mono flex items-center gap-1.5 group-hover:text-amber-500 transition-colors">
                                <Coins className="w-4 h-4 text-amber-500" />
                                {money(snapshot?.cash_balance)}
                            </span>
                            <span className="text-[9px] text-zinc-500 font-bold block">{isAr ? "اضغط للتعديل" : "Click to edit"}</span>
                        </button>
                    )}
                </div>
                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/35 p-4 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">{isAr ? "إجمالي المحفظة" : "Total Equity"}</span>
                    <span className="text-lg font-black text-black dark:text-white font-mono flex items-center gap-1.5">
                        <BadgeDollarSign className="w-4 h-4 text-indigo-500" />
                        {money(totals?.equity)}
                    </span>
                    <span className="text-[9px] text-zinc-500 font-bold block">{positions.length} {isAr ? "سهم" : "stocks"}</span>
                </div>
            </div>

            {/* Add form */}
            {showAdd && (
                <div className="border-4 border-dashed border-black/50 dark:border-white/40 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                        {/* Symbol autocomplete — only real EGX symbols */}
                        <div className="relative flex-1 min-w-[160px]">
                            <input
                                value={addSymbol}
                                onChange={(e) => { setAddSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setSymbolMenuOpen(true); }}
                                onFocus={() => setSymbolMenuOpen(true)}
                                onBlur={() => setTimeout(() => setSymbolMenuOpen(false), 150)}
                                placeholder={isAr ? "ابحث عن رمز (COMI)" : "Search symbol (COMI)"}
                                autoComplete="off"
                                className="h-11 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-3 text-sm font-black font-mono text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                            />
                            {symbolMenuOpen && (() => {
                                const list = (snapshot?.market_symbols || []);
                                const query = addSymbol.trim().toUpperCase();
                                const filtered = query
                                    ? list.filter((s) => s.symbol.includes(query) || (s.name || "").toUpperCase().includes(query))
                                    : list;
                                const shown = filtered.slice(0, 8);
                                if (shown.length === 0) return null;
                                return (
                                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                                        {shown.map((s) => (
                                            <button
                                                key={s.symbol}
                                                type="button"
                                                onMouseDown={(e) => { e.preventDefault(); setAddSymbol(s.symbol); setSymbolMenuOpen(false); }}
                                                className="w-full text-right px-3 py-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
                                            >
                                                <span className="font-black font-mono text-black dark:text-white">{s.symbol}</span>
                                                <span className="text-[10px] text-zinc-500 font-bold truncate max-w-[180px]">{s.name}</span>
                                            </button>
                                        ))}
                                        {filtered.length > 8 && (
                                            <div className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold text-center">{isAr ? `و ${filtered.length - 8} رمز آخر...` : `+${filtered.length - 8} more...`}</div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                        <input
                            value={addQty}
                            onChange={(e) => setAddQty(numericOnly(e.target.value))}
                            inputMode="decimal"
                            placeholder={isAr ? "العدد (200)" : "Quantity (200)"}
                            className="h-11 flex-1 min-w-[100px] border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-3 text-sm font-black font-mono text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        />
                        <input
                            value={addPrice}
                            onChange={(e) => setAddPrice(numericOnly(e.target.value))}
                            inputMode="decimal"
                            placeholder={isAr ? "سعر الشراء (اختياري)" : "Entry price (optional)"}
                            className="h-11 flex-1 min-w-[130px] border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-3 text-sm font-black font-mono text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        />
                        <button
                            onClick={() => void handleAdd()}
                            disabled={busy}
                            className="h-11 px-6 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-400 text-black font-black text-xs uppercase tracking-widest shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {isAr ? "حفظ" : "Save"}
                        </button>
                    </div>
                    <p className="text-[10px] text-zinc-500 font-bold">
                        {isAr ? "اختر الرمز من القائمة — الأسهم المضافة لازم تكون موجودة فعلاً في البورصة المصرية" : "Pick the symbol from the list — only real EGX-listed stocks can be added"}
                    </p>
                </div>
            )}

            {/* Positions */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                </div>
            ) : positions.length === 0 ? (
                <div className="min-h-[160px] border-4 border-dashed border-black/40 dark:border-white/30 bg-zinc-50 dark:bg-zinc-950/30 flex flex-col items-center justify-center gap-4 text-center p-8">
                    <Wallet className="h-8 w-8 text-zinc-400" />
                    <p className="max-w-md text-sm font-bold text-zinc-600 dark:text-zinc-400">
                        {isAr
                            ? "محفظتك فاضية. ضيف أسهمك من الزر فوق، أو ابعت صورة محفظتك للشات بوت وهو يسجلها لك بعد تأكيدك."
                            : "Your portfolio is empty. Add holdings above, or send a portfolio screenshot to the chatbot."}
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b-4 border-black dark:border-zinc-800 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                                <th className="py-3 pr-3 text-right">{isAr ? "السهم" : "Stock"}</th>
                                <th className="py-3 px-2 text-right">{isAr ? "العدد" : "Qty"}</th>
                                <th className="py-3 px-2 text-right">{isAr ? "متوسط الشراء" : "Avg Cost"}</th>
                                <th className="py-3 px-2 text-right">{isAr ? "آخر سعر" : "Last"}</th>
                                <th className="py-3 px-2 text-right">{isAr ? "القيمة" : "Value"}</th>
                                <th className="py-3 px-2 text-right">{isAr ? "الربح/الخسارة" : "P/L"}</th>
                                <th className="py-3 pl-3 text-left">{isAr ? "إجراءات" : "Actions"}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {positions.map((row) => {
                                const isEditing = editingId === row.id;
                                const profitPositive = (row.profit_value ?? 0) >= 0;
                                return (
                                    <tr key={row.id} className="border-b-2 border-zinc-200 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-950/40 transition-colors">
                                        <td className="py-3 pr-3">
                                            <div className="flex items-center gap-2">
                                                <span className="font-black text-black dark:text-white uppercase">{row.symbol}</span>
                                                {row.name && <span className="text-[10px] text-zinc-500 font-bold truncate max-w-[140px] hidden sm:block">{row.name}</span>}
                                            </div>
                                        </td>
                                        <td className="py-3 px-2 font-mono font-bold text-black dark:text-white">
                                            {isEditing ? (
                                                <input value={editQty} onChange={(e) => setEditQty(numericOnly(e.target.value))} inputMode="decimal" placeholder={String(row.quantity ?? "")} className="h-8 w-20 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 px-2 text-xs font-mono outline-none" />
                                            ) : (
                                                money(row.quantity, 0)
                                            )}
                                        </td>
                                        <td className="py-3 px-2 font-mono text-zinc-600 dark:text-zinc-300">
                                            {isEditing ? (
                                                <input value={editPrice} onChange={(e) => setEditPrice(numericOnly(e.target.value))} inputMode="decimal" placeholder={String(row.entry_price ?? "")} className="h-8 w-20 border-2 border-black dark:border-white bg-white dark:bg-zinc-900 px-2 text-xs font-mono outline-none" />
                                            ) : (
                                                money(row.entry_price)
                                            )}
                                        </td>
                                        <td className="py-3 px-2 font-mono text-zinc-600 dark:text-zinc-300">{money(row.last_price)}</td>
                                        <td className="py-3 px-2 font-mono font-black text-black dark:text-white">{money(row.market_value)}</td>
                                        <td className="py-3 px-2">
                                            <div className={`font-mono font-black ${profitPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                {profitPositive ? "+" : ""}{money(row.profit_value)}
                                            </div>
                                            <div className={`text-[10px] font-bold font-mono ${profitPositive ? "text-emerald-600/80 dark:text-emerald-400/80" : "text-rose-600/80 dark:text-rose-400/80"}`}>
                                                {(row.profit_pct ?? 0) >= 0 ? "+" : ""}{money(row.profit_pct)}%
                                            </div>
                                        </td>
                                        <td className="py-3 pl-3">
                                            <div className="flex items-center justify-end gap-1.5">
                                                {isEditing ? (
                                                    <>
                                                        <button onClick={() => void handleSaveEdit(row)} disabled={busy} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-emerald-400 text-black" title={isAr ? "حفظ" : "Save"}>
                                                            <Check className="h-4 w-4" />
                                                        </button>
                                                        <button onClick={() => setEditingId(null)} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white" title={isAr ? "إلغاء" : "Cancel"}>
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => { setEditingId(row.id); setEditQty(row.quantity !== null ? String(row.quantity) : ""); setEditPrice(row.entry_price !== null ? String(row.entry_price) : ""); }} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-amber-300 text-black" title={isAr ? "تعديل" : "Edit"}>
                                                            <Pencil className="h-4 w-4" />
                                                        </button>
                                                        <button onClick={() => void handleSell(row)} disabled={busy} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-cyan-400 text-black" title={isAr ? "تسجيل بيع" : "Record sell"}>
                                                            <BadgeDollarSign className="h-4 w-4" />
                                                        </button>
                                                        <button onClick={() => void handleRemove(row)} disabled={busy} className="h-8 w-8 flex items-center justify-center border-2 border-black dark:border-white bg-red-400 text-black" title={isAr ? "حذف" : "Remove"}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-[10px] text-zinc-500 font-bold text-center uppercase tracking-wider">
                {isAr
                    ? "الأسعار آخر إغلاق من قاعدة البيانات — تحدّث تلقائياً مع كل جلسة"
                    : "Prices from latest DB close — refreshed with every session"}
            </p>
        </section>
    );
}
