"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { scanTech, type TechFilter, type TechResult } from "@/lib/api";

type Updater<T> = Partial<T> | ((prev: T) => T);

export type TechScannerState = {
  country: string;
  results: TechResult[];
  hasScanned: boolean;
  scannedCount: number;
  scanHistory: Array<{
    key: string;
    createdAt: number;
    filter: TechFilter;
    results: TechResult[];
    scannedCount: number;
  }>;
  selectedStock: TechResult | null;
  searchTerm: string;
  rsiMin: string;
  rsiMax: string;
  aboveEma50: boolean;
  aboveEma200: boolean;
  adxMin: string;
  adxMax: string;
  atrMin: string;
  atrMax: string;
  stochKMin: string;
  stochKMax: string;
  rocMin: string;
  rocMax: string;
  aboveVwap20: boolean;
  volumeAboveSma20: boolean;
  goldenCross: boolean;
  currentTab: "ai" | "overview" | "performance" | "valuation" | "dividends" | "financials";
  marketCapMin: string;
  marketCapMax: string;
  sector: string;
  industry: string;
  minPrice: string;
  useAiFilter: boolean;
  minAiPrecision: string;
  activeSymbol: string | null;
  chartHeight: number;
};

type TechnicalScannerContextType = {
  state: TechScannerState;
  setTechScanner: (u: Updater<TechScannerState>) => void;
  loading: boolean;
  error: string | null;
  runTechScan: (opts?: { force?: boolean }) => Promise<void>;
  stopTechScan: () => void;
  clearTechScannerView: () => void;
  restoreLastTechScan: () => boolean;
  resetTechScanner: () => void;
};

const SESSION_KEY = "egxbots_tech_scanner_v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

const DEFAULT_STATE: TechScannerState = {
  country: "Egypt",
  results: [],
  hasScanned: false,
  scannedCount: 0,
  scanHistory: [],
  selectedStock: null,
  searchTerm: "",
  rsiMin: "",
  rsiMax: "",
  aboveEma50: false,
  aboveEma200: false,
  adxMin: "",
  adxMax: "",
  atrMin: "",
  atrMax: "",
  stochKMin: "",
  stochKMax: "",
  rocMin: "",
  rocMax: "",
  aboveVwap20: false,
  volumeAboveSma20: false,
  goldenCross: false,
  currentTab: "ai",
  marketCapMin: "",
  marketCapMax: "",
  sector: "",
  industry: "",
  minPrice: "",
  useAiFilter: false,
  minAiPrecision: "0.6",
  activeSymbol: null,
  chartHeight: 450,
};

const TechnicalScannerContext = createContext<TechnicalScannerContextType | undefined>(undefined);

function loadSessionState(): TechScannerState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<TechScannerState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      selectedStock: null,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function buildFilterKey(filter: TechFilter): string {
  return JSON.stringify({
    country: filter.country,
    limit: filter.limit,
    rsi_min: filter.rsi_min,
    rsi_max: filter.rsi_max,
    min_price: filter.min_price,
    market_cap_min: filter.market_cap_min,
    market_cap_max: filter.market_cap_max,
    sector: filter.sector,
    industry: filter.industry,
    golden_cross: filter.golden_cross,
    above_ema50: filter.above_ema50,
    above_ema200: filter.above_ema200,
    adx_min: filter.adx_min,
    adx_max: filter.adx_max,
    atr_min: filter.atr_min,
    atr_max: filter.atr_max,
    stoch_k_min: filter.stoch_k_min,
    stoch_k_max: filter.stoch_k_max,
    roc_min: filter.roc_min,
    roc_max: filter.roc_max,
    above_vwap20: filter.above_vwap20,
    volume_above_sma20: filter.volume_above_sma20,
    use_ai_filter: filter.use_ai_filter,
    min_ai_precision: filter.min_ai_precision,
  });
}

function buildFilterFromState(s: TechScannerState): TechFilter {
  return {
    country: s.country,
    limit: 100,
    rsi_min: s.rsiMin ? parseFloat(s.rsiMin) : undefined,
    rsi_max: s.rsiMax ? parseFloat(s.rsiMax) : undefined,
    min_price: s.minPrice ? parseFloat(s.minPrice) : undefined,
    above_ema50: s.aboveEma50,
    above_ema200: s.aboveEma200,
    adx_min: s.adxMin ? parseFloat(s.adxMin) : undefined,
    adx_max: s.adxMax ? parseFloat(s.adxMax) : undefined,
    atr_min: s.atrMin ? parseFloat(s.atrMin) : undefined,
    atr_max: s.atrMax ? parseFloat(s.atrMax) : undefined,
    stoch_k_min: s.stochKMin ? parseFloat(s.stochKMin) : undefined,
    stoch_k_max: s.stochKMax ? parseFloat(s.stochKMax) : undefined,
    roc_min: s.rocMin ? parseFloat(s.rocMin) : undefined,
    roc_max: s.rocMax ? parseFloat(s.rocMax) : undefined,
    above_vwap20: s.aboveVwap20,
    volume_above_sma20: s.volumeAboveSma20,
    market_cap_min: s.marketCapMin ? parseFloat(s.marketCapMin) : undefined,
    market_cap_max: s.marketCapMax ? parseFloat(s.marketCapMax) : undefined,
    sector: s.sector || undefined,
    industry: s.industry || undefined,
    golden_cross: s.goldenCross,
    use_ai_filter: s.useAiFilter,
    min_ai_precision: s.minAiPrecision ? parseFloat(s.minAiPrecision) : undefined,
  };
}

export function TechnicalScannerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TechScannerState>(DEFAULT_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  const hasBootstrappedRef = useRef(false);

  // Load from session storage after mount to prevent SSR/hydration mismatch
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TechScannerState>;
        setState((prev) => ({
          ...prev,
          ...parsed,
          selectedStock: null,
          results: Array.isArray(parsed.results) ? parsed.results : [],
          scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : [],
        }));
      }
    } catch (e) {
      console.error("Failed to load session state", e);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      const { selectedStock: _selected, ...persisted } = state;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted));
    } catch {
      // sessionStorage may be unavailable
    }
  }, [state, isLoaded]);

  const setTechScanner = useCallback((u: Updater<TechScannerState>) => {
    setState((prev) =>
      typeof u === "function" ? (u as (p: TechScannerState) => TechScannerState)(prev) : { ...prev, ...u }
    );
  }, []);

  const clearTechScannerView = useCallback(() => {
    setState((prev) => ({
      ...prev,
      results: [],
      hasScanned: false,
      scannedCount: 0,
      selectedStock: null,
    }));
  }, []);

  const restoreLastTechScan = useCallback(() => {
    let restored = false;
    setState((prev) => {
      const last = prev.scanHistory?.[prev.scanHistory.length - 1];
      if (!last) return prev;
      restored = true;
      return {
        ...prev,
        results: last.results,
        hasScanned: true,
        scannedCount: last.scannedCount,
        selectedStock: null,
      };
    });
    return restored;
  }, []);

  const resetTechScanner = useCallback(() => {
    setState(DEFAULT_STATE);
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  const runTechScan = useCallback(async (opts?: { force?: boolean }) => {
    const current = stateRef.current;
    const filter = buildFilterFromState(current);
    const key = buildFilterKey(filter);
    const now = Date.now();

    if (!opts?.force) {
      const cached = current.scanHistory?.find((h) => h.key === key && now - h.createdAt < CACHE_TTL_MS);
      if (cached) {
        setState((prev) => ({
          ...prev,
          results: cached.results,
          hasScanned: true,
          scannedCount: cached.scannedCount,
          selectedStock: null,
        }));
        return;
      }

      if (current.hasScanned) {
        return;
      }
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    if (opts?.force) {
      setState((prev) => ({
        ...prev,
        results: [],
        hasScanned: false,
        scannedCount: 0,
        selectedStock: null,
      }));
    }

    try {
      const res = await scanTech(filter, controller.signal);

      let next = res.results || [];
      if (current.goldenCross) {
        next = next.filter((r) => r.ema50 > r.ema200);
      }

      setState((prev) => {
        const history = Array.isArray(prev.scanHistory) ? prev.scanHistory : [];
        const snapshot = {
          key,
          createdAt: Date.now(),
          filter,
          results: next,
          scannedCount: res.scanned_count,
        };
        const deduped = history.filter((h) => h.key !== key);
        const capped = [...deduped, snapshot].slice(-5);
        return {
          ...prev,
          results: next,
          hasScanned: true,
          scannedCount: res.scanned_count,
          scanHistory: capped,
          selectedStock: null,
        };
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, []);

  const stopTechScan = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const current = stateRef.current;

    if (current.country !== "Egypt") {
      setTechScanner((prev) => ({ ...prev, country: "Egypt" }));
      return;
    }

    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    if (!current.hasScanned) {
      void runTechScan();
    }
  }, [state.country, runTechScan, setTechScanner, isLoaded]);

  const value = useMemo<TechnicalScannerContextType>(
    () => ({
      state,
      setTechScanner,
      loading,
      error,
      runTechScan,
      stopTechScan,
      clearTechScannerView,
      restoreLastTechScan,
      resetTechScanner,
    }),
    [
      state,
      setTechScanner,
      loading,
      error,
      runTechScan,
      stopTechScan,
      clearTechScannerView,
      restoreLastTechScan,
      resetTechScanner,
    ]
  );

  return <TechnicalScannerContext.Provider value={value}>{children}</TechnicalScannerContext.Provider>;
}

export function useTechnicalScanner() {
  const ctx = useContext(TechnicalScannerContext);
  if (!ctx) {
    throw new Error("useTechnicalScanner must be used within a TechnicalScannerProvider");
  }
  return ctx;
}
