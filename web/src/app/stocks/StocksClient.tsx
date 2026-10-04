"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Filter, ArrowUpRight, TrendingUp, Building2 } from "lucide-react";
import StockLogo from "@/components/StockLogo";
import { useLanguage } from "@/contexts/LanguageContext";

interface StockItem {
  symbol: string;
  name: string;
  sector: string;
  marketCap?: number | null;
}

export default function StocksClient({ initialStocks }: { initialStocks: StockItem[] }) {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [query, setQuery] = useState("");
  const [selectedSector, setSelectedSector] = useState("all");

  const sectors = useMemo(() => {
    const set = new Set<string>();
    initialStocks.forEach((s) => {
      if (s.sector && s.sector.trim()) {
        set.add(s.sector.trim());
      }
    });
    return Array.from(set).sort();
  }, [initialStocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialStocks.filter((s) => {
      const matchQuery =
        !q ||
        s.symbol.toLowerCase().includes(q) ||
        (s.name && s.name.toLowerCase().includes(q));
      const matchSector =
        selectedSector === "all" || s.sector === selectedSector;
      return matchQuery && matchSector;
    });
  }, [initialStocks, query, selectedSector]);

  return (
    <div className="w-full">
      {/* Search & Sector Filters Bar */}
      <div className="mb-8 p-4 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.4)] flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isAr
                ? "ابحث باسم الشركة أو الرمز (مثال: CIB, COMI, بلتون)..."
                : "Search by company name or symbol (e.g., COMI, TMGH)..."
            }
            className="w-full h-11 pl-10 pr-4 text-xs font-black border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 text-black dark:text-white outline-none focus:bg-[#FFE600] focus:text-black transition-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-zinc-500 shrink-0" />
          <select
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
            className="h-11 px-3 text-xs font-black border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950 text-black dark:text-white outline-none cursor-pointer focus:bg-[#FFE600] focus:text-black"
          >
            <option value="all">{isAr ? "جميع القطاعات" : "All Sectors"}</option>
            {sectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stocks Count Indicator */}
      <div className="mb-4 flex justify-between items-center text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">
        <span>
          {isAr
            ? `عرض ${filtered.length} سهم من أصل ${initialStocks.length}`
            : `Showing ${filtered.length} of ${initialStocks.length} stocks`}
        </span>
        {selectedSector !== "all" && (
          <button
            onClick={() => setSelectedSector("all")}
            className="text-red-500 hover:underline"
          >
            {isAr ? "إلغاء الفلتر" : "Clear filter"}
          </button>
        )}
      </div>

      {/* Grid of Stocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((stock) => (
          <Link
            key={stock.symbol}
            href={`/stocks/${stock.symbol.toLowerCase()}`}
            className="group block p-4 bg-white dark:bg-zinc-900 border-3 border-black dark:border-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.5)] transition-all"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <StockLogo
                  symbol={stock.symbol}
                  size="sm"
                  className="border-2 border-black dark:border-white rounded-none"
                />
                <div>
                  <span className="font-mono font-black text-base text-black dark:text-white group-hover:text-yellow-600 dark:group-hover:text-yellow-400">
                    {stock.symbol}
                  </span>
                  <span className="block text-[10px] text-zinc-500 font-bold uppercase">
                    EGX
                  </span>
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-black dark:group-hover:text-white transition-colors" />
            </div>

            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 line-clamp-1 mb-2">
              {stock.name || stock.symbol}
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800 text-[10px] font-bold text-zinc-500">
              <span className="truncate max-w-[150px]">{stock.sector || "سوق عام"}</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-black">
                {isAr ? "تحليل فني و AI" : "AI & Technical"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-16 text-center border-4 border-dashed border-zinc-300 dark:border-zinc-800">
          <p className="text-sm font-black text-zinc-500">
            {isAr
              ? "لا يوجد أسهم مطابقة لخيارات البحث"
              : "No stocks found matching the criteria"}
          </p>
        </div>
      )}
    </div>
  );
}
