"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Database, Clock3 } from "lucide-react";

type ClientDataRow = {
    symbol: string;
    name?: string | null;
    row_count?: number;
    last_price_date?: string | null;
    last_sync?: string | null;
};

function ageLabel(date: string | null | undefined): string {
    if (!date) return "غير متاح";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return date;
    const ageHours = (Date.now() - parsed.getTime()) / 3_600_000;
    if (ageHours < 24) return "حديثة أقل من 24 ساعة";
    return `قديمة منذ ${Math.floor(ageHours / 24)} يوم`;
}

export default function ClientDataPreview() {
    const [rows, setRows] = useState<ClientDataRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadedAt, setLoadedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/admin/db-symbols/EGX?mode=prices", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setRows(Array.isArray(data) ? data.slice(0, 50) : []);
            setLoadedAt(new Date().toISOString());
        } catch (cause: any) {
            setError(cause?.message || "تعذر تحميل بيانات العميل");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const latestDate = rows.reduce<string | null>((latest, row) => {
        const value = row.last_price_date || null;
        return value && (!latest || value > latest) ? value : latest;
    }, null);

    return (
        <section className="space-y-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-zinc-200">
                        <Database className="h-4 w-4 text-indigo-400" />
                        Client Data Preview
                    </h3>
                    <p className="mt-1 text-[11px] text-zinc-500">
                        نفس بيانات الأسعار التي يعتمد عليها عرض العميل، مع تاريخ كل صف.
                    </p>
                </div>
                <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-300 hover:border-indigo-400 disabled:opacity-50">
                    <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> تحديث
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="text-[10px] uppercase text-zinc-500">Rows shown</div>
                    <div className="mt-1 text-lg font-black text-zinc-100">{rows.length}</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="text-[10px] uppercase text-zinc-500">Latest price date</div>
                    <div className="mt-1 text-sm font-black text-emerald-400">{latestDate || "غير متاح"}</div>
                </div>
                <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="flex items-center gap-2 text-[10px] uppercase text-zinc-500"><Clock3 className="h-3 w-3" /> Admin fetch time</div>
                    <div className="mt-1 text-sm font-black text-zinc-100">{loadedAt ? new Date(loadedAt).toLocaleString("ar-EG") : "—"}</div>
                </div>
            </div>

            {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div> : null}
            <div className="max-h-[360px] overflow-auto rounded-xl border border-zinc-800">
                <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-widest text-zinc-500">
                        <tr><th className="px-3 py-2">Ticker</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Rows</th><th className="px-3 py-2">Price date</th><th className="px-3 py-2">Freshness</th></tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => <tr key={row.symbol} className="border-t border-zinc-900 text-zinc-300">
                            <td className="px-3 py-2 font-mono font-black">{row.symbol}</td>
                            <td className="max-w-[240px] truncate px-3 py-2">{row.name || "—"}</td>
                            <td className="px-3 py-2">{row.row_count ?? 0}</td>
                            <td className="px-3 py-2 font-mono">{row.last_price_date || "—"}</td>
                            <td className="px-3 py-2">{ageLabel(row.last_price_date)}</td>
                        </tr>)}
                        {!loading && rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-600">لا توجد بيانات</td></tr> : null}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
