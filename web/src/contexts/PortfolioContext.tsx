"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";

export type PortfolioRow = {
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

export type PortfolioSnapshot = {
  ok: boolean;
  positions: PortfolioRow[];
  cash_balance: number;
  totals: { positions_count: number; cost_basis: number; market_value: number; profit_value: number; profit_pct: number; equity: number };
  market_symbols?: Array<{ symbol: string; name: string | null }>;
  portfolio_limit?: number | null;
  is_pro?: boolean;
};

type PortfolioContextValue = {
  snapshot: PortfolioSnapshot | null;
  loading: boolean;
  refresh: (force?: boolean) => Promise<void>;
};

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (!user) { setSnapshot(null); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/portfolio", { cache: force ? "no-store" : "default" });
      if (response.ok) setSnapshot(await response.json());
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const handleUpdated = () => { void refresh(true); };
    window.addEventListener("portfolio-updated", handleUpdated);
    return () => window.removeEventListener("portfolio-updated", handleUpdated);
  }, [refresh]);

  return <PortfolioContext.Provider value={{ snapshot, loading, refresh }}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) throw new Error("usePortfolio must be used inside PortfolioProvider");
  return context;
}
