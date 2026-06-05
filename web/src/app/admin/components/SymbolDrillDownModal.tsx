"use client";

import { toast } from "sonner";
import { TrendingUp, FileText, Download, X, Loader2, Database, Info, Zap, Trash2, Search, ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";

interface SymbolDrillDownModalProps {
    selectedDbEx: string | null;
    drillDownMode: "prices" | "fundamentals" | "intraday" | null;
    dbSymbols: any[];
    localSymbols: any[];
    loadingLocalSymbols?: boolean;
    selectedDrillSymbols: Set<string>;
    setSelectedDrillSymbols: (symbols: Set<string>) => void;
    dbSymbolsSort: { key: string, dir: 'asc' | 'desc' };
    setDbSymbolsSort: React.Dispatch<React.SetStateAction<{ key: string, dir: 'asc' | 'desc' }>>;
    loadingDbSymbols: boolean;
    handleDownloadCsv: (exchange: string, symbol?: string) => void;
    handleRecalculateIndicators: (exchange: string, symbolsOverride?: string[]) => void;
    setSelectedDbEx: (ex: string | null) => void;
    setDbSymbols: (symbols: any[]) => void;
    setDrillDownMode: (mode: "prices" | "fundamentals" | "intraday" | null) => void;
    selectedSymbols: Set<string>;
    setSelectedSymbols: (symbols: Set<string>) => void;
    setActiveMainTab: (tab: "data" | "ai" | "backtest" | "bot" | "schedule" | "intraday") => void;
}

export default function SymbolDrillDownModal({
    selectedDbEx,
    drillDownMode,
    dbSymbols,
    localSymbols = [],
    loadingLocalSymbols = false,
    selectedDrillSymbols,
    setSelectedDrillSymbols,
    dbSymbolsSort,
    setDbSymbolsSort,
    loadingDbSymbols,
    handleDownloadCsv,
    handleRecalculateIndicators,
    setSelectedDbEx,
    setDbSymbols,
    setDrillDownMode,
    selectedSymbols,
    setSelectedSymbols,
    setActiveMainTab
}: SymbolDrillDownModalProps) {
    const [rowCountMin, setRowCountMin] = useState<string>("");
    const [rowCountMax, setRowCountMax] = useState<string>("");
    const [lastSyncStart, setLastSyncStart] = useState<string>("");
    const [lastSyncEnd, setLastSyncEnd] = useState<string>("");
    const [lastPriceStart, setLastPriceStart] = useState<string>("");
    const [lastPriceEnd, setLastPriceEnd] = useState<string>("");
    const [isDeleting, setIsDeleting] = useState(false);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [comparisonFilters, setComparisonFilters] = useState<Set<string>>(new Set(["sync_ok", "name_changed", "new_local", "deleted_local"]));
    const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

    const toggleStatusFilter = (status: string) => {
        const next = new Set(comparisonFilters);
        if (next.has(status)) {
            next.delete(status);
        } else {
            next.add(status);
        }
        setComparisonFilters(next);
    };

    const handleDeleteSelected = async () => {
        if (!selectedDbEx || selectedDrillSymbols.size === 0) return;
        if (!confirm(`Delete price data for ${selectedDrillSymbols.size} symbol(s) from ${selectedDbEx}?\nThis cannot be undone.`)) return;
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/admin/delete-prices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    exchange: selectedDbEx,
                    symbols: Array.from(selectedDrillSymbols),
                    mode: drillDownMode
                })
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            toast.success(`Deleted ${selectedDrillSymbols.size} symbol(s) — ${data.deleted_rows ?? 0} rows removed`);
            // Remove deleted symbols from local table state
            setDbSymbols(dbSymbols.filter(s => !selectedDrillSymbols.has(s.symbol)));
            setSelectedDrillSymbols(new Set());
        } catch (e: any) {
            toast.error("Delete failed: " + (e.message || "Unknown error"));
        } finally {
            setIsDeleting(false);
        }
    };

    const exchangeLocalSymbols = useMemo(() => {
        if (!selectedDbEx) return [];
        const targetEx = selectedDbEx.toUpperCase();
        return localSymbols.filter(s => s.exchange?.toUpperCase() === targetEx);
    }, [localSymbols, selectedDbEx]);

    const localSymbolsMap = useMemo(() => {
        const map = new Map<string, any>();
        exchangeLocalSymbols.forEach(s => {
            if (s.symbol) {
                map.set(s.symbol.toUpperCase(), s);
            }
        });
        return map;
    }, [exchangeLocalSymbols]);

    const dbSymbolsMap = useMemo(() => {
        const map = new Map<string, any>();
        dbSymbols.forEach(s => {
            if (s.symbol) {
                map.set(s.symbol.toUpperCase(), s);
            }
        });
        return map;
    }, [dbSymbols]);

    const mergedSymbols = useMemo(() => {
        const allKeys = new Set<string>();
        localSymbolsMap.forEach((_, key) => allKeys.add(key));
        dbSymbolsMap.forEach((_, key) => allKeys.add(key));

        return Array.from(allKeys).map(key => {
            const local = localSymbolsMap.get(key);
            const db = dbSymbolsMap.get(key);

            let status: 'sync_ok' | 'name_changed' | 'new_local' | 'deleted_local' = 'sync_ok';
            if (local && db) {
                const localName = (local.name || "").trim().toLowerCase();
                const dbName = (db.name || "").trim().toLowerCase();
                if (localName !== dbName && dbName !== "n/a" && dbName !== "") {
                    status = 'name_changed';
                } else {
                    status = 'sync_ok';
                }
            } else if (local && !db) {
                status = 'new_local';
            } else {
                status = 'deleted_local';
            }

            return {
                symbol: key,
                name: db?.name && db.name !== 'N/A' ? db.name : (local?.name || 'N/A'),
                localName: local?.name || null,
                dbName: db?.name || null,
                sector: db?.sector || 'N/A',
                row_count: db?.row_count || 0,
                last_sync: db?.last_sync || null,
                last_price_date: db?.last_price_date || null,
                status,
                inLocal: !!local,
                inDb: !!db,
            };
        });
    }, [localSymbolsMap, dbSymbolsMap]);

    const filteredDbSymbols = useMemo(() => {
        return mergedSymbols.filter(s => {
            // Search Ticker / Name Filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const tickerMatch = s.symbol.toLowerCase().includes(q);
                const nameMatch = s.name.toLowerCase().includes(q);
                const localNameMatch = s.localName?.toLowerCase().includes(q) || false;
                if (!tickerMatch && !nameMatch && !localNameMatch) return false;
            }

            // Comparison Status Filter
            if (!comparisonFilters.has(s.status)) return false;

            // Row Count Filter
            if (rowCountMin && (s.row_count || 0) < Number(rowCountMin)) return false;
            if (rowCountMax && (s.row_count || 0) > Number(rowCountMax)) return false;

            // Last Sync Date Filter
            if (lastSyncStart || lastSyncEnd) {
                if (!s.last_sync) return false;
                const syncDate = new Date(s.last_sync).getTime();
                if (lastSyncStart && syncDate < new Date(lastSyncStart).getTime()) return false;
                if (lastSyncEnd && syncDate > new Date(lastSyncEnd).getTime()) return false;
            }

            // Last Price Date Filter
            if (lastPriceStart || lastPriceEnd) {
                if (!s.last_price_date) return false;
                const priceDate = new Date(s.last_price_date).getTime();
                if (lastPriceStart && priceDate < new Date(lastPriceStart).getTime()) return false;
                if (lastPriceEnd && priceDate > new Date(lastPriceEnd).getTime()) return false;
            }

            return true;
        }).sort((a: any, b: any) => {
            const valA = a[dbSymbolsSort.key] || '';
            const valB = b[dbSymbolsSort.key] || '';
            if (typeof valA === 'number' && typeof valB === 'number') {
                return dbSymbolsSort.dir === 'asc' ? valA - valB : valB - valA;
            }
            return dbSymbolsSort.dir === 'asc' ? valA.toString().localeCompare(valB.toString()) : valB.toString().localeCompare(valA.toString());
        });
    }, [mergedSymbols, searchQuery, comparisonFilters, rowCountMin, rowCountMax, lastSyncStart, lastSyncEnd, lastPriceStart, lastPriceEnd, dbSymbolsSort]);

    const totalRowsFiltered = useMemo(() => filteredDbSymbols.reduce((acc, s) => acc + (s.row_count || 0), 0), [filteredDbSymbols]);

    if (!selectedDbEx) return null;

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-8 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-full max-w-6xl max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center justify-between p-6 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-xl ${drillDownMode === 'prices' ? 'bg-indigo-500/10 border border-indigo-500/20' : drillDownMode === 'intraday' ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
                            {drillDownMode === 'prices' ? <TrendingUp className="w-5 h-5 text-indigo-400" /> : drillDownMode === 'intraday' ? <Zap className="w-5 h-5 text-amber-400" /> : <FileText className="w-5 h-5 text-emerald-400" />}
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white tracking-tight">
                                {selectedDbEx} {drillDownMode === 'prices' ? 'Stock Prices' : drillDownMode === 'intraday' ? 'Intraday 15m Prices' : 'Fundamentals Data'}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                                    {filteredDbSymbols.length} / {mergedSymbols.length} Symbols Displayed · {totalRowsFiltered.toLocaleString()} Rows
                                </p>
                                {loadingLocalSymbols && (
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-1.5 animate-pulse ml-2">
                                        <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
                                        Comparing with local data...
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => handleDownloadCsv(selectedDbEx)}
                            className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-700 transition-all flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            DOWNLOAD CSV
                        </button>
                        <button
                            onClick={() => { setSelectedDbEx(null); setDbSymbols([]); setDrillDownMode(null); }}
                            className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Filters Section */}
                <div className="space-y-4 px-6 py-4 bg-zinc-900/30 border-b border-zinc-800/50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] text-zinc-500 uppercase font-black px-1">Search Ticker / Name</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search by symbol or name..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 h-9"
                                />
                                <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-3 top-2.5" />
                            </div>
                        </div>
                        <div className="space-y-2 relative">
                            <label className="text-[10px] text-zinc-500 uppercase font-black px-1">Comparison Status</label>
                            <button
                                type="button"
                                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                                className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 h-9 flex items-center justify-between text-left"
                            >
                                <span className="truncate pr-2">
                                    {comparisonFilters.size === 4 ? "All Statuses" : 
                                     comparisonFilters.size === 0 ? "None Selected" : 
                                     Array.from(comparisonFilters).map(f => {
                                         if (f === "sync_ok") return "Synced";
                                         if (f === "name_changed") return "Name Changed";
                                         if (f === "new_local") return "New / Missing";
                                         return "Removed Locally";
                                     }).join(", ")}
                                </span>
                                <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                            </button>
                            {isStatusDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIsStatusDropdownOpen(false)} />
                                    <div className="absolute top-[calc(100%+4px)] left-0 w-full bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl p-3 z-20 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                                        {[
                                            { id: "sync_ok", label: "Synced (OK)", color: "text-green-400" },
                                            { id: "name_changed", label: "Name Changed", color: "text-amber-400" },
                                            { id: "new_local", label: "New / Missing", color: "text-indigo-400" },
                                            { id: "deleted_local", label: "Removed Locally", color: "text-red-400" }
                                        ].map(opt => (
                                            <label key={opt.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-900 rounded-lg cursor-pointer transition-colors text-[10px] text-zinc-300 font-bold w-full select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={comparisonFilters.has(opt.id)}
                                                    onChange={() => toggleStatusFilter(opt.id)}
                                                    className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className={opt.color}>{opt.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] text-zinc-500 uppercase font-black px-1">Row Count Range</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    placeholder="Min"
                                    value={rowCountMin}
                                    onChange={(e) => setRowCountMin(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 h-9"
                                />
                                <span className="text-zinc-600 text-xs">-</span>
                                <input
                                    type="number"
                                    placeholder="Max"
                                    value={rowCountMax}
                                    onChange={(e) => setRowCountMax(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 h-9"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] text-zinc-500 uppercase font-black px-1">Last Sync Range</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={lastSyncStart}
                                    onChange={(e) => setLastSyncStart(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 text-scheme-dark h-9"
                                />
                                <span className="text-zinc-600 text-xs">-</span>
                                <input
                                    type="date"
                                    value={lastSyncEnd}
                                    onChange={(e) => setLastSyncEnd(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 text-scheme-dark h-9"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] text-zinc-500 uppercase font-black px-1">Last Price Range</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={lastPriceStart}
                                    onChange={(e) => setLastPriceStart(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 text-scheme-dark h-9"
                                />
                                <span className="text-zinc-600 text-xs">-</span>
                                <input
                                    type="date"
                                    value={lastPriceEnd}
                                    onChange={(e) => setLastPriceEnd(e.target.value)}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500 text-scheme-dark h-9"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-auto p-6 bg-zinc-950/50">
                    {loadingDbSymbols ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                            <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Loading database records...</p>
                        </div>
                    ) : filteredDbSymbols.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 grayscale opacity-50">
                            <Database className="w-16 h-16 text-zinc-700 mb-4" />
                            <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest">No matching records found</p>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-zinc-800/50 overflow-hidden bg-zinc-900/20 backdrop-blur-md">
                            <table className="w-full text-left text-[11px]">
                                <thead className="bg-zinc-900/80 text-zinc-500 font-bold uppercase tracking-wider border-b border-zinc-800">
                                    <tr>
                                        <th className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={filteredDbSymbols.length > 0 && selectedDrillSymbols.size === filteredDbSymbols.length}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedDrillSymbols(new Set(filteredDbSymbols.map(s => s.symbol)));
                                                    else setSelectedDrillSymbols(new Set());
                                                }}
                                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
                                            />
                                        </th>
                                        <th className="px-6 py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setDbSymbolsSort(p => ({ key: 'status', dir: p.key === 'status' && p.dir === 'asc' ? 'desc' : 'asc' }))}>
                                            Status {dbSymbolsSort.key === 'status' ? (dbSymbolsSort.dir === 'asc' ? '↑' : '↓') : ''}
                                        </th>
                                        <th className="px-6 py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setDbSymbolsSort(p => ({ key: 'symbol', dir: p.key === 'symbol' && p.dir === 'asc' ? 'desc' : 'asc' }))}>
                                            Ticker {dbSymbolsSort.key === 'symbol' ? (dbSymbolsSort.dir === 'asc' ? '↑' : '↓') : ''}
                                        </th>
                                        <th className="px-6 py-4">Name</th>
                                        <th className="px-6 py-4">Sector</th>
                                        <th className="px-6 py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setDbSymbolsSort(p => ({ key: 'row_count', dir: p.key === 'row_count' && p.dir === 'asc' ? 'desc' : 'asc' }))}>
                                            Count {dbSymbolsSort.key === 'row_count' ? (dbSymbolsSort.dir === 'asc' ? '↑' : '↓') : ''}
                                        </th>
                                        <th className="px-6 py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setDbSymbolsSort(p => ({ key: 'last_sync', dir: p.key === 'last_sync' && p.dir === 'asc' ? 'desc' : 'asc' }))}>
                                            Last Sync {dbSymbolsSort.key === 'last_sync' ? (dbSymbolsSort.dir === 'asc' ? '↑' : '↓') : ''}
                                        </th>
                                        <th className="px-6 py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setDbSymbolsSort(p => ({ key: 'last_price_date', dir: p.key === 'last_price_date' && p.dir === 'asc' ? 'desc' : 'asc' }))}>
                                            Last Price {dbSymbolsSort.key === 'last_price_date' ? (dbSymbolsSort.dir === 'asc' ? '↑' : '↓') : ''}
                                        </th>
                                        <th className="px-6 py-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-800/50">
                                    {filteredDbSymbols.map((s) => (
                                        <tr key={s.symbol} className={`hover:bg-zinc-800/40 transition-colors group/row ${selectedDrillSymbols.has(s.symbol) ? 'bg-indigo-600/5' : ''}`}>
                                            <td className="px-6 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedDrillSymbols.has(s.symbol)}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedDrillSymbols);
                                                        if (e.target.checked) next.add(s.symbol);
                                                        else next.delete(s.symbol);
                                                        setSelectedDrillSymbols(next);
                                                    }}
                                                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-0.5 rounded-full font-bold uppercase tracking-tight text-[8px] whitespace-nowrap ${
                                                    s.status === 'sync_ok' ? 'bg-green-500/10 border border-green-500/20 text-green-400' :
                                                    s.status === 'name_changed' ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400' :
                                                    s.status === 'new_local' ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400' :
                                                    'bg-red-500/10 border border-red-500/20 text-red-400'
                                                }`}>
                                                    {s.status === 'sync_ok' ? 'Synced' :
                                                     s.status === 'name_changed' ? 'Name Changed' :
                                                     s.status === 'new_local' ? 'New / Missing' :
                                                     'Removed Locally'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-mono font-black text-indigo-400 group-hover/row:text-indigo-300">{s.symbol}</td>
                                            <td className="px-6 py-4">
                                                {s.status === 'name_changed' ? (
                                                    <div>
                                                        <div className="text-zinc-300 font-medium">{s.name}</div>
                                                        <div className="text-[9px] text-amber-500/80 font-semibold mt-0.5">
                                                            Local: {s.localName}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-zinc-300 font-medium">{s.name}</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-500 font-bold uppercase tracking-tighter text-[9px]">
                                                    {s.sector}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-indigo-400 font-mono font-bold">
                                                {s.row_count || 0}
                                            </td>
                                            <td className="px-6 py-4 text-zinc-400 font-mono">
                                                {s.last_sync ? new Date(s.last_sync).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-zinc-500 font-mono">
                                                {s.last_price_date ? (
                                                    drillDownMode === 'intraday' ? new Date(s.last_price_date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : s.last_price_date
                                                ) : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {s.inDb && (
                                                    <button
                                                        onClick={() => handleDownloadCsv(selectedDbEx, s.symbol)}
                                                        className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/30 transition-all shadow-sm"
                                                        title={drillDownMode === 'prices' ? "Download Prices CSV" : drillDownMode === 'intraday' ? "Download Intraday CSV" : "Download Fundamentals CSV"}
                                                    >
                                                        <Download className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                <div className="p-4 bg-zinc-900/30 border-t border-zinc-800 flex items-center gap-3 backdrop-blur-sm">
                    <div className="mr-auto flex items-center gap-4">
                        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest flex items-center gap-2">
                            <Info className="w-3.5 h-3.5" />
                            {selectedDrillSymbols.size} Selected
                        </p>
                    </div>

                    {selectedDrillSymbols.size > 0 && (
                        <>
                            <button
                                onClick={handleDeleteSelected}
                                disabled={isDeleting}
                                className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-[10px] font-bold text-red-400 hover:bg-red-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                DELETE SELECTED
                            </button>
                            <button
                                onClick={() => {
                                    if (!selectedDbEx) return;
                                    handleRecalculateIndicators(selectedDbEx, Array.from(selectedDrillSymbols));
                                }}
                                className="px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-500 hover:bg-amber-600 hover:text-white transition-all flex items-center gap-2"
                            >
                                <Zap className="w-3.5 h-3.5" />
                                RECALC TECHNICALS
                            </button>
                            <button
                                onClick={() => {
                                    if (!selectedDbEx) return;
                                    const newSelection = new Set(selectedSymbols);
                                    selectedDrillSymbols.forEach(sym => {
                                        const id = `${sym}.${selectedDbEx}`;
                                        newSelection.add(id);
                                    });
                                    setSelectedSymbols(newSelection);
                                    setActiveMainTab("data");
                                    setSelectedDbEx(null);
                                }}
                                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-500 transition-all flex items-center gap-2"
                            >
                                <Database className="w-3.5 h-3.5" />
                                USE IN DATA MANAGER
                            </button>
                        </>
                    )}

                    <button
                        onClick={() => { setSelectedDbEx(null); setDbSymbols([]); setDrillDownMode(null); }}
                        className="px-6 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                    >
                        CLOSE VIEW
                    </button>
                </div>
            </div>
        </div>
    );
}
