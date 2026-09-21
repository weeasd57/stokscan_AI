"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";

const compact = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

/**
 * Compact "My Portfolio" equity chip shown in the header navbar.
 * Renders nothing for anonymous users or when the user hasn't configured a
 * portfolio (no holdings and no cash) yet. Responsive: expands on lg+.
 */
export default function PortfolioHeaderChip() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { snapshot } = usePortfolio();

  if (!user) return null;

  const hasHoldings = Array.isArray(snapshot?.positions) && snapshot.positions.length > 0;
  const hasCash = (snapshot?.cash_balance || 0) > 0;
  const equity = snapshot?.totals?.equity ?? 0;
  const profit = snapshot?.totals?.profit_value ?? 0;
  const profitPct = snapshot?.totals?.profit_pct ?? 0;

  // Nothing configured yet → keep the navbar clean
  if (!hasHoldings && !hasCash) return null;

  const isProfit = profit >= 0;

  return (
    <Link
      href="/profile"
      title={language === "ar" ? "محفظتي" : "My Portfolio"}
      className="hidden lg:flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-xs font-black bg-emerald-500/10 dark:bg-emerald-400/10 border-2 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:scale-105 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all"
    >
      <Wallet className="w-3.5 h-3.5 shrink-0" />
      <span className="font-mono">{compact(equity)}</span>
      {isProfit ? (
        <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
      ) : (
        <TrendingDown className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
      )}
      <span className={`font-mono ${isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
        {isProfit ? "+" : ""}{profitPct.toFixed(1)}%
      </span>
    </Link>
  );
}
