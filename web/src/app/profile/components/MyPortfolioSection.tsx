"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    Loader2, RefreshCw, Plus, Trash2, Pencil, Check, X, Wallet,
    TrendingUp, TrendingDown, Coins, Save, BadgeDollarSign, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { usePortfolio, type PortfolioRow, type PortfolioSnapshot } from "@/contexts/PortfolioContext";


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

    const { snapshot, loading, refresh: load } = usePortfolio();
    const [busy, setBusy] = useState(false);

    // add form (multi-row bulk add)
    interface AddRow {
        id: string;
        symbol: string;
        quantity: string;
        price: string;
        menuOpen?: boolean;
    }
    const [showAdd, setShowAdd] = useState(false);
    const [addRows, setAddRows] = useState<AddRow[]>([{ id: "row-1", symbol: "", quantity: "", price: "" }]);

    const updateRow = (id: string, field: keyof AddRow, val: any) => {
        setAddRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
    };

    const addRow = () => {
        setAddRows(prev => [...prev, { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, symbol: "", quantity: "", price: "" }]);
    };

    const removeRow = (id: string) => {
        setAddRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev);
    };

    // inline edit
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editQty, setEditQty] = useState("");
    const [editPrice, setEditPrice] = useState("");

    // cash edit
    const [cashDraft, setCashDraft] = useState("");
    const [editingCash, setEditingCash] = useState(false);

    useEffect(() => { if (snapshot) setCashDraft(snapshot.cash_balance ? String(Math.round(snapshot.cash_balance)) : "0"); }, [snapshot]);

    useEffect(() => {
        if (typeof window !== "undefined" && (window.location.hash === "#portfolio" || window.location.hash === "#my-portfolio")) {
            setShowAdd(true);
        }
    }, []);

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
            await load(true);
            onPortfolioUpdated?.();
            return data.ok;
        } catch (e: any) {
            toast.error(e?.message || "Connection failed");
            return false;
        } finally {
            setBusy(false);
        }
    }, [load, onPortfolioUpdated]);

    const handleBulkSave = async () => {
        const validItems: Array<{ symbol: string; quantity: number; price: number | null }> = [];
        const symbolList = snapshot?.market_symbols || [];
        for (const row of addRows) {
            const sym = row.symbol.trim().toUpperCase();
            if (!sym && !row.quantity) continue;
            const qty = parseFloat(row.quantity);
            if (!sym || !Number.isFinite(qty) || qty <= 0) {
                toast.error(isAr ? `تأكد من اختيار الرمز والكمية بشكل صحيح لجميع الأسهم` : "Please ensure valid symbol and quantity for all stocks");
                return;
            }
            const exactMatch = symbolList.find((s) => s.symbol === sym);
            const cleanSym = exactMatch ? exactMatch.symbol : sym;
            if (!/^[A-Z0-9]{2,10}$/.test(cleanSym)) {
                toast.error(isAr ? `الرمز ${sym} غير صالح — اختر من القائمة أو اكتب رمزاً صحيحاً` : `Invalid symbol ${sym} — pick from the list`);
                return;
            }
            const price = row.price.trim() ? parseFloat(row.price) : null;
            validItems.push({ symbol: cleanSym, quantity: qty, price });
        }

        if (validItems.length === 0) {
            toast.error(isAr ? "يرجى كتابة بيانات سهم واحد على الأقل" : "Please fill in at least one stock");
            return;
        }

        const ok = await api({ action: "bulk_add", items: validItems });
        if (ok) {
            setShowAdd(false);
            setAddRows([{ id: `row-${Date.now()}`, symbol: "", quantity: "", price: "" }]);
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
                    <button
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent("open-chat-with-message", { detail: "حلل محفظتي" }));
                        }}
                        disabled={positions.length === 0}
                        className="h-10 px-4 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-sky-300 text-black font-black text-xs uppercase tracking-widest shadow-[2px_2px_0px_rgba(0,0,0,1)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <MessageSquare className="h-4 w-4" />
                        {isAr ? "حلل محفظتي" : "Analyze Portfolio"}
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

            {/* Add form — Multi-stock bulk add */}
            {showAdd && (
                <div className="border-4 border-dashed border-black/50 dark:border-white/40 bg-emerald-50 dark:bg-emerald-950/20 p-4 sm:p-5 space-y-4">
                    <div className="flex items-center justify-between border-b-2 border-emerald-200 dark:border-emerald-800 pb-2">
                        <span className="font-black text-xs uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
                            {isAr ? "إضافة أسهمك دفعة واحدة" : "Bulk Add Portfolio Stocks"}
                        </span>
                        <span className="text-[11px] font-bold text-zinc-500">
                            {isAr ? "أضف كل أسهمك واضغط حفظ مرة واحدة" : "Add all your stocks and save once"}
                        </span>
                    </div>

                    <div className="space-y-3">
                        {addRows.map((row, index) => (
                            <div key={row.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <span className="font-mono font-black text-xs w-6 text-zinc-400 hidden sm:inline-block">
                                    #{index + 1}
                                </span>
                                {/* Symbol autocomplete */}
                                <div className="relative flex-1 min-w-[160px]">
                                    <input
                                        value={row.symbol}
                                        onChange={(e) => {
                                            updateRow(row.id, "symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                                            updateRow(row.id, "menuOpen", true);
                                        }}
                                        onFocus={() => updateRow(row.id, "menuOpen", true)}
                                        onBlur={() => setTimeout(() => updateRow(row.id, "menuOpen", false), 150)}
                                        placeholder={isAr ? "رمز السهم (مثلاً COMI)" : "Symbol (e.g. COMI)"}
                                        autoComplete="off"
                                        className="h-11 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-3 text-sm font-black font-mono text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                                    />
                                    {row.menuOpen && (() => {
                                        const list = (snapshot?.market_symbols || []);
                                        const query = row.symbol.trim().toUpperCase();
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
                                                        onMouseDown={(e) => { e.preventDefault(); updateRow(row.id, "symbol", s.symbol); updateRow(row.id, "menuOpen", false); }}
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
                                    value={row.quantity}
                                    onChange={(e) => updateRow(row.id, "quantity", numericOnly(e.target.value))}
                                    inputMode="decimal"
                                    placeholder={isAr ? "الكمية / عدد الأسهم" : "Quantity"}
                                    className="h-11 flex-1 min-w-[110px] border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-3 text-sm font-black font-mono text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                                />
                                <input
                                    value={row.price}
                                    onChange={(e) => updateRow(row.id, "price", numericOnly(e.target.value))}
                                    inputMode="decimal"
                                    placeholder={isAr ? "سعر الشراء (اختياري)" : "Entry price (optional)"}
                                    className="h-11 flex-1 min-w-[130px] border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-3 text-sm font-black font-mono text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                                />
                                {addRows.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeRow(row.id)}
                                        className="h-11 w-11 flex items-center justify-center border-4 border-black dark:border-white bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/40 text-rose-600 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                                        title={isAr ? "حذف هذا السطر" : "Remove row"}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <button
                            type="button"
                            onClick={addRow}
                            className="h-10 px-3 flex items-center gap-1.5 border-2 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px]"
                        >
                            <Plus className="h-4 w-4" />
                            {isAr ? "إضافة سهم آخر للقائمة" : "Add Another Stock"}
                        </button>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowAdd(false)}
                                className="h-10 px-4 border-2 border-black dark:border-white bg-zinc-200 dark:bg-zinc-700 text-black dark:text-white font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                            >
                                {isAr ? "إلغاء" : "Cancel"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleBulkSave()}
                                disabled={busy}
                                className="h-10 px-5 flex items-center gap-2 border-4 border-black dark:border-white bg-emerald-400 text-black font-black text-xs uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {isAr ? "حفظ وإضافة كل الأسهم دفعة واحدة" : "Save All Stocks"}
                            </button>
                        </div>
                    </div>
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
