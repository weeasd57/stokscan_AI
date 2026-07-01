import type { PredictResponse } from "@/lib/types";


export const getProductionApiUrl = (): string => {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.includes("ngrok-free.app") ||
      host.startsWith("192.168.") ||
      host.startsWith("10.")
    ) {
      return "";
    }
    if (host.endsWith(".vercel.app") || host === "stokscan-ai-web.vercel.app") {
      return "https://weeasdwee-ai-bot.hf.space";
    }
    return "https://weeasdwee-ai-bot.hf.space";
  }

  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (/localhost:3000|:3000\b/.test(fromEnv)) {
    return "";
  }
  return fromEnv.replace(/\/$/, "");
};

function getGlobalBaseUrl(): string {
  return getProductionApiUrl();
}

export type PredictParams = {
  ticker: string;
  exchange?: string;
  fromDate?: string;
  toDate?: string;
  includeFundamentals?: boolean;
  rfPreset?: string;
  rfParams?: Record<string, unknown>;
  modelName?: string;
  forceLocal?: boolean;
  targetPct?: number;
  stopLossPct?: number;
  lookForwardDays?: number;
  buyThreshold?: number;
};

export async function predictStock(params: PredictParams, signal?: AbortSignal): Promise<PredictResponse> {
  const baseUrl = getGlobalBaseUrl();

  let ticker = params.ticker.trim().toUpperCase();
  let exchange = params.exchange?.toUpperCase();

  if ((!exchange || exchange.trim() === "") && ticker.includes(".")) {
    const parts = ticker.split(".").filter(Boolean);
    if (parts.length >= 2) {
      exchange = parts[parts.length - 1];
      ticker = parts.slice(0, -1).join(".");
    }
  }

  if (!exchange || exchange === "") {
    if (!ticker.includes(".")) {
      exchange = "EGX";
    }
  }

  const payload = {
    ticker,
    exchange: exchange ?? null,
    from_date: params.fromDate ?? "2020-01-01",
    to_date: params.toDate ?? null,
    include_fundamentals: params.includeFundamentals ?? true,
    rf_preset: params.rfPreset ?? null,
    rf_params: params.rfParams ?? null,
    model_name: params.modelName ?? null,
    force_local: params.forceLocal ?? true,
    target_pct: params.targetPct ?? 0.15,
    stop_loss_pct: params.stopLossPct ?? 0.05,
    look_forward_days: params.lookForwardDays ?? 20,
    buy_threshold: params.buyThreshold ?? 0.45,
  };

  async function doFetch(url: string) {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal,
    });
  }

  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}/predict`) : await doFetch("/api/predict");
  } catch (e) {
    if (baseUrl) {
      res = await doFetch("/api/predict");
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data?.detail) msg = data.detail;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return (await res.json()) as PredictResponse;
}

export type SymbolResult = {
  symbol: string;
  exchange: string;
  name: string;
  country: string;
  hasLocal?: boolean;
};

export type CountriesResponse = {
  countries: string[];
};

export type SymbolSearchResponse = {
  results: SymbolResult[];
};

export type LocalModelMeta = {
  name: string;
  size_bytes?: number;
  size_mb?: number;
  created_at?: string;
  modified_at?: string;
  type?: string;
  num_features?: number;
  num_parameters?: number;
  trainingSamples?: number;
  target_pct?: number;
  stop_loss_pct?: number;
  look_forward_days?: number;
  buyThreshold?: number;
  exchange?: string;
  featurePreset?: string;
  learning_rate?: number;
  bestIteration?: number;
  n_estimators?: number;
  num_trees?: number;
  model_type?: string;
  meta_threshold?: number;
  has_meta_labeling?: boolean;
  uses_fundamentals?: boolean;
  uses_exchange_index_json?: boolean;
  training_stats?: Record<string, unknown>;
};

export type LocalModelsResponse = {
  models: (string | LocalModelMeta)[];
};

export async function getLocalModels(): Promise<(string | LocalModelMeta)[]> {
  const baseUrl = getGlobalBaseUrl();
  const endpoint = "/models/local";

  async function doFetch(url: string) {
    return await fetch(url, { cache: "no-store" });
  }

  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}${endpoint}`) : await doFetch(`/api${endpoint}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api${endpoint}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch models (${res.status})`);
  }

  const data = (await res.json()) as LocalModelsResponse;
  return data.models ?? [];
}

export type DateSymbolResult = {
  symbol: string;
  exchange: string;
  name: string;
  rowCount?: number;
};

export async function getSymbolsByDate(params: {
  start: string;
  end: string;
  exchange?: string;
  limit?: number;
  searchTerm?: string;
}): Promise<DateSymbolResult[]> {
  const baseUrl = getGlobalBaseUrl();
  const query = new URLSearchParams({ start: params.start, end: params.end });
  if (params.exchange) query.set("exchange", params.exchange);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.searchTerm) query.set("search_term", params.searchTerm);

  async function doFetch(url: string) {
    return await fetch(url, { cache: "no-store" });
  }

  let res: Response;
  try {
    const endpoint = `/symbols/by-date?${query.toString()}`;
    res = baseUrl ? await doFetch(`${baseUrl}${endpoint}`) : await doFetch(`/api${endpoint}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api/symbols/by-date?${query.toString()}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch symbols (${res.status})`);
  }

  const data = (await res.json()) as { results: DateSymbolResult[] };
  return data.results;
}

export async function getSymbolsForExchange(exchange: string): Promise<DateSymbolResult[]> {
  try {
    const res = await fetch(`/api/admin/db-symbols/${exchange}?mode=prices`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch symbols (${res.status})`);
    }
    const data = (await res.json()) as any[];
    return data.map((item) => ({
      symbol: item.symbol,
      exchange: exchange,
      name: item.name || "",
      rowCount: item.rowCount || item.row_count || 0,
    }));
  } catch (error) {
    console.error("Failed to fetch symbols from db-symbols:", error);
    return [];
  }
}

export async function getInventory(): Promise<any[]> {
  const baseUrl = getGlobalBaseUrl();
  const endpoint = "/symbols/inventory";

  async function doFetch(url: string) {
    return await fetch(url, { cache: "no-store" });
  }

  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}${endpoint}`) : await doFetch(`/api${endpoint}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api${endpoint}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch inventory (${res.status})`);
  }

  const data = (await res.json()) as { inventory: any[] };
  return data.inventory;
}

export async function getCountries(source?: "supabase" | "local"): Promise<string[]> {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  const endpoint = `/symbols/countries?${params.toString()}`;

  const baseUrl = getGlobalBaseUrl();
  const urls = baseUrl
    ? [`${baseUrl}${endpoint}`, `/api${endpoint}`]
    : [`/api${endpoint}`];

  let lastStatus = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as CountriesResponse;
        return (data.countries || []).filter((c) => typeof c === "string" && c.trim().length > 0);
      }
      lastStatus = res.status;
    } catch {
      // try next url
    }
  }

  throw new Error(`Failed to fetch countries (${lastStatus || 500})`);
}

export async function searchSymbols(
  query: string,
  country?: string,
  limit: number = 50,
  signal?: AbortSignal,
  source?: "supabase" | "local",
  exchange?: string
): Promise<SymbolResult[]> {
  const baseUrl = getGlobalBaseUrl();

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (country) params.set("country", country);
  if (source) params.set("source", source);
  if (exchange) params.set("exchange", exchange);

  async function doFetch(url: string) {
    return await fetch(url, { cache: "no-store", signal });
  }

  let res: Response;
  try {
    const endpoint = `/symbols/search?${params.toString()}`;
    res = baseUrl ? await doFetch(`${baseUrl}${endpoint}`) : await doFetch(`/api${endpoint}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api/symbols/search?${params.toString()}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to search symbols (${res.status})`);
  }

  const data = (await res.json()) as SymbolSearchResponse;
  return data.results;
}

export async function getSyncedSymbols(country?: string, source?: "supabase" | "local"): Promise<SymbolResult[]> {
  const baseUrl = getGlobalBaseUrl();
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  if (source) params.set("source", source);

  async function doFetch(url: string) {
    return await fetch(url, { cache: "no-store" });
  }

  let res: Response;
  try {
    const endpoint = `/symbols/synced?${params.toString()}`;
    res = baseUrl ? await doFetch(`${baseUrl}${endpoint}`) : await doFetch(`/api${endpoint}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api/symbols/synced?${params.toString()}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch synced symbols (${res.status})`);
  }
  const data = (await res.json()) as SymbolSearchResponse;
  return data.results;
}

// Scan AI
export type ScanResult = {
  symbol: string;
  exchange?: string | null;
  name: string;
  last_close: number;
  precision: number;
  signal: string;
  confidence: string;
  logo_url?: string | null;
  ai_score?: number;
  fundamental_score?: number;
  technical_score?: number;
  sentiment_score?: number;
  status?: "win" | "loss" | "pending" | "open" | "hit_stop" | "hit_target" | null;
  profit_loss_pct?: number | null;
  top_reasons?: string[];
  target_price?: number;
  stop_loss?: number;
  id?: string;
  created_at?: string;
  updated_at?: string;
  exit_price?: number;
  features?: number[] | null;
  council_score?: number;
  consensus_ratio?: string;
};

export type ScanResponse = {
  results: ScanResult[];
  scanned_count: number;
};

export type ScanAiParams = {
  country: string;
  scanAll: boolean;
  limit: number;
  minPrecision: number;
  rfPreset: "fast" | "default" | "accurate";
  rfParamsJson: string;
  rfParams: Record<string, unknown> | null;
  modelName?: string;
  from_date?: string;
  to_date?: string;
  target_pct?: number;
  stop_loss_pct?: number;
  look_forward_days?: number;
  buy_threshold?: number;
  councilModel?: string;
  validatorModel?: string;
};

export async function scanAiFastWithParams(params: ScanAiParams, signal?: AbortSignal): Promise<ScanResponse> {
  const baseUrl = getGlobalBaseUrl();

  const query = new URLSearchParams({
    country: params.country,
    limit: String(params.limit),
    min_precision: String(params.minPrecision ?? 0.1),
    model_name: params.modelName ?? "",
    from_date: params.from_date || new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    target_pct: String(params.target_pct ?? 0.10),
    stop_loss_pct: String(params.stop_loss_pct ?? 0.05),
    look_forward_days: String(params.look_forward_days ?? 20),
    buy_threshold: String(params.buy_threshold ?? 0.45),
    council_model: params.councilModel ?? "",
    validator_model: params.validatorModel ?? "",
  });
  if (params.to_date) {
    query.set("to_date", params.to_date);
  }

  async function doFetch(url: string) {
    return await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal,
    });
  }

  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}/scan/fast?${query}`) : await doFetch(`/api/scan/fast?${query}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api/scan/fast?${query}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    let msg = `Scan failed(${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data?.detail) msg = data.detail;
    } catch {
      try {
        const text = await res.text();
        if (text) msg = text;
      } catch {
      }
    }
    throw new Error(msg);
  }

  return (await res.json()) as ScanResponse;
}

export async function scanAiWithParams(params: ScanAiParams, signal?: AbortSignal): Promise<ScanResponse> {
  const baseUrl = getGlobalBaseUrl();

  async function doFetch(url: string) {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rf_preset: params.rfPreset,
        rf_params: params.rfParams ?? null,
        model_name: params.modelName ?? null,
      }),
      cache: "no-store",
      signal: signal,
    });
  }

  const query = new URLSearchParams({
    country: params.country,
    limit: String(params.limit),
    min_precision: String(params.minPrecision),
  });

  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}/scan/ai?${query}`) : await doFetch(`/api/scan/ai?${query}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api/scan/ai?${query}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    let msg = `Scan failed(${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data?.detail) msg = data.detail;
    } catch {
      try {
        const text = await res.text();
        if (text) msg = text;
      } catch {
      }
    }
    throw new Error(msg);
  }

  return (await res.json()) as ScanResponse;
}

export async function scanAi(country: string = "Egypt", signal?: AbortSignal): Promise<ScanResponse> {
  const baseUrl = getGlobalBaseUrl();

  async function doFetch(url: string) {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: signal
    });
  }

  const query = new URLSearchParams({ country, limit: "50", min_precision: "0.6" });
  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}/scan/ai?${query}`) : await doFetch(`/api/scan/ai?${query}`);
  } catch (e) {
    if (baseUrl) {
      res = await doFetch(`/api/scan/ai?${query}`);
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    let msg = `Scan failed(${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data?.detail) msg = data.detail;
    } catch {
      try {
        const text = await res.text();
        if (text) msg = text;
      } catch {
        // ignore
      }
    }
    throw new Error(msg);
  }

  return (await res.json()) as ScanResponse;
}

// Technical Scan Types
export type TechFilter = {
  country?: string;
  limit?: number;
  rsi_min?: number;
  rsi_max?: number;
  min_price?: number;
  above_ema50?: boolean;
  above_ema200?: boolean;
  below_ema50?: boolean;
  adx_min?: number;
  adx_max?: number;
  atr_min?: number;
  atr_max?: number;
  stoch_k_min?: number;
  stoch_k_max?: number;
  roc_min?: number;
  roc_max?: number;
  above_vwap20?: boolean;
  volume_above_sma20?: boolean;
  market_cap_min?: number;
  market_cap_max?: number;
  sector?: string;
  industry?: string;
  golden_cross?: boolean;
  use_ai_filter?: boolean;
  min_ai_precision?: number;
  avoid_distribution?: boolean;
  require_accumulation?: boolean;
  cmf_min?: number;
};

export type TechResult = {
  symbol: string;
  name: string;
  last_close: number;
  rsi: number;
  volume: number;
  ema50: number;
  ema200: number;
  momentum: number;
  atr14?: number;
  adx14?: number;
  stoch_k?: number;
  stoch_d?: number;
  cci20?: number;
  vwap20?: number;
  roc12?: number;
  vol_sma20?: number;
  change_p: number;
  market_cap?: number;
  pe_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  sector?: string;
  industry?: string;
  beta?: number;
  logo_url?: string | null;
  ai_score?: number;
  fundamental_score?: number;
  technical_score?: number;
  sentiment_score?: number;
  cmf_20?: number;
  mm_accumulation?: boolean;
  mm_distribution?: boolean;
  distribution_blocked?: boolean;
  distribution_reason?: string | null;
};

export type TechResponse = {
  results: TechResult[];
  scanned_count: number;
};

export async function scanTech(filter: TechFilter, signal?: AbortSignal): Promise<TechResponse> {
  const baseUrl = getGlobalBaseUrl();

  async function doFetch(url: string) {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: filter.country ?? "Egypt",
        limit: filter.limit ?? 50,
        rsi_min: filter.rsi_min,
        rsi_max: filter.rsi_max,
        min_price: filter.min_price,
        above_ema50: filter.above_ema50 ?? false,
        above_ema200: filter.above_ema200 ?? false,
        below_ema50: filter.below_ema50 ?? false,
        adx_min: filter.adx_min,
        adx_max: filter.adx_max,
        atr_min: filter.atr_min,
        atr_max: filter.atr_max,
        stoch_k_min: filter.stoch_k_min,
        stoch_k_max: filter.stoch_k_max,
        roc_min: filter.roc_min,
        roc_max: filter.roc_max,
        above_vwap20: filter.above_vwap20 ?? false,
        volume_above_sma20: filter.volume_above_sma20 ?? false,
        market_cap_min: filter.market_cap_min,
        market_cap_max: filter.market_cap_max,
        sector: filter.sector,
        industry: filter.industry,
        golden_cross: filter.golden_cross ?? false,
        use_ai_filter: filter.use_ai_filter ?? false,
        min_ai_precision: filter.min_ai_precision ?? 0.6,
        avoid_distribution: filter.avoid_distribution ?? false,
        require_accumulation: filter.require_accumulation ?? false,
        cmf_min: filter.cmf_min
      }),
      cache: "no-store",
      signal: signal
    });
  }

  let res: Response;
  try {
    res = baseUrl ? await doFetch(`${baseUrl}/scan/technical`) : await doFetch("/api/scan/technical");
  } catch (e) {
    if (baseUrl) {
      res = await doFetch("/api/scan/technical");
    } else {
      throw e;
    }
  }

  if (!res.ok) {
    let msg = `Scan failed(${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data?.detail) msg = data.detail;
    } catch {
      try {
        const text = await res.text();
        if (text) msg = text;
      } catch {
        // ignore
      }
    }
    throw new Error(msg);
  }

  return (await res.json()) as TechResponse;
}

export async function scanAiSingle(symbol: string, exchange?: string, min_precision: number = 0.6, signal?: AbortSignal): Promise<ScanResult | null> {
  const res = await fetch("/api/scan/ai/single", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, exchange, min_precision }),
    signal: signal
  });
  if (!res.ok) return null;
  return res.json();
}

export interface AdminConfig {
  priceSource: string;
  fundSource: string;
  maxWorkers: number;
  enabledModels: string[];
  modelAliases?: Record<string, string>;
  scanDays?: number;
}

export async function getAdminConfig(): Promise<AdminConfig> {
  const res = await fetch("/api/admin/config");
  if (!res.ok) throw new Error("Failed to fetch admin config");
  return res.json();
}

export async function updateAdminConfig(config: Partial<AdminConfig>): Promise<AdminConfig> {
  const res = await fetch("/api/admin/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!res.ok) throw new Error("Failed to update admin config");
  return res.json();
}

export type NewsArticle = {
  title: string;
  description: string;
  content: string;
  url: string;
  image: string;
  publishedAt: string;
  source: {
    name: string;
    url: string;
  };
};

export async function fetchStockNews(query: string, limit: number = 3): Promise<NewsArticle[]> {
  try {
    const baseUrl = getGlobalBaseUrl() || "/api";
    const q = encodeURIComponent(query);
    const url = `${baseUrl}/news?symbol=${q}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const articles = (data.articles || []) as NewsArticle[];
    return articles.slice(0, limit);
  } catch (e) {
    console.error("Failed to fetch news:", e);
    return [];
  }
}

export async function evaluateScan(scanId: string): Promise<{ count: number; message: string }> {
  const baseUrl = getGlobalBaseUrl();
  const url = baseUrl ? `${baseUrl}/scan/fast/evaluate/${scanId}` : `/api/scan/fast/evaluate/${scanId}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to evaluate scan performance");
  return await response.json();
}

export async function getBacktests(model?: string, admin: boolean = false): Promise<any[]> {
  // Prefer same-origin `/api` proxy on Vercel. If NEXT_PUBLIC_API_BASE_URL is set, use it as-is.
  const baseUrl = getGlobalBaseUrl() || "/api";
  const params = new URLSearchParams();
  if (model) params.append("model", model);
  if (admin) params.append("admin", "true");
  const queryStr = params.toString();
  const url = queryStr ? `${baseUrl}/backtests?${queryStr}` : `${baseUrl}/backtests`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch backtests");
  return await response.json();
}

export async function getBacktestTrades(backtestId: string): Promise<any[]> {
  const baseUrl = getGlobalBaseUrl() || "/api";
  const response = await fetch(`${baseUrl}/backtests/${backtestId}/trades`);
  if (!response.ok) throw new Error("Failed to fetch backtest trades");
  return await response.json();
}

export async function deleteBacktest(id: string): Promise<void> {
  const baseUrl = getGlobalBaseUrl() || "/api";
  const response = await fetch(`${baseUrl}/backtests/${id}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error("Failed to delete backtest");
}

export async function updateBacktestVisibility(id: string, isPublic: boolean): Promise<void> {
  const baseUrl = getGlobalBaseUrl() || "/api";
  const response = await fetch(`${baseUrl}/backtests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_public: isPublic })
  });
  if (!response.ok) throw new Error("Failed to update backtest visibility");
}

export async function updateBacktestFavorite(id: string, isFavorite: boolean): Promise<void> {
  const baseUrl = getGlobalBaseUrl() || "/api";
  const response = await fetch(`${baseUrl}/backtests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_favorite: isFavorite })
  });
  if (!response.ok) throw new Error("Failed to update backtest favorite status");
}

export type Asset = {
  symbol: string;
  name: string;
  exchange: string;
  class_name: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
};

export type IntradayTimeframe =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "12h"
  | "1d"
  | "1w";

export type CryptoSymbolStat = {
  symbol: string;
  rows_count: number;
  first_ts: string | null;
  last_ts: string | null;
};

export async function getCryptoSymbolStats(
  timeframe: IntradayTimeframe = "1h"
): Promise<CryptoSymbolStat[]> {
  const params = new URLSearchParams();
  params.set("timeframe", timeframe);
  const res = await fetch(`/api/ai_bot/crypto_symbols_stats?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to fetch crypto symbol stats" }));
    throw new Error(error.detail || "Failed to fetch crypto symbol stats");
  }
  return res.json();
}

export async function deleteCryptoBars(
  symbols: string[],
  timeframe: IntradayTimeframe = "1h"
): Promise<{ success: boolean; deleted: number; symbols: number; timeframe: string }> {
  const res = await fetch("/api/ai_bot/crypto_delete_bars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols, timeframe }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to delete crypto bars" }));
    throw new Error(error.detail || "Failed to delete crypto bars");
  }
  return res.json();
}

export async function getAssets(
  exchange?: string,
  assetClass: "us_equity" | "crypto" = "us_equity"
): Promise<Asset[]> {
  const params = new URLSearchParams();
  if (exchange) params.set("exchange", exchange);
  params.set("asset_class", assetClass);
  params.set("source", "local");
  const url = `/api/ai_bot/assets?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to fetch assets" }));
    throw new Error(error.detail || "Failed to fetch assets");
  }
  return res.json();
}

export type CryptoSupabaseStats = {
  asset_class: "us_equity" | "crypto";
  exchange_filter?: string | null;
  exchanges?: string[];
  assets_cache?: { rows: number; last_updated_at?: string | null };
  stock_prices?: { rows: number; last_date?: string | null };
  stock_bars_intraday?: {
    rows: number;
    last_ts?: string | null;
    by_timeframe?: Partial<Record<IntradayTimeframe, number>>;
  };
};

export async function getCryptoSupabaseStats(
  assetClass: "us_equity" | "crypto" = "us_equity",
  exchange?: string
): Promise<CryptoSupabaseStats> {
  const params = new URLSearchParams();
  params.set("asset_class", assetClass);
  if (exchange) params.set("exchange", exchange);
  const res = await fetch(`/api/ai_bot/supabase-stats?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to fetch Supabase stats" }));
    throw new Error(error.detail || "Failed to fetch Supabase stats");
  }
  return res.json();
}

export async function getAvailableCoins(
  source: string = "virtual",
  limit: number = 0,
  pairType?: string
): Promise<string[]> {
  const params = new URLSearchParams({ source, limit: limit.toString() });
  if (pairType) params.set("pair_type", pairType);
  const res = await fetch(`/api/ai_bot/available_coins?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch available coins");
  return res.json();
}

export interface TechnicalAlert {
  id: string;
  user_id: string;
  name: string;
  filters: TechFilter;
  is_active: boolean;
  created_at: string;
  last_triggered_at?: string;
  last_triggered_matches?: string[];
}

export async function getTechnicalAlerts(userId: string): Promise<TechnicalAlert[]> {
  const baseUrl = getGlobalBaseUrl() || "";
  const endpoint = baseUrl ? `${baseUrl}/scan/alerts?user_id=${encodeURIComponent(userId)}` : `/api/scan/alerts?user_id=${encodeURIComponent(userId)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to fetch technical alerts");
  const data = await response.json();
  return data.alerts ?? [];
}

export async function createTechnicalAlert(params: { user_id: string; name: string; filters: TechFilter }): Promise<TechnicalAlert> {
  const baseUrl = getGlobalBaseUrl() || "";
  const endpoint = baseUrl ? `${baseUrl}/scan/alerts` : `/api/scan/alerts`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to create technical alert");
  }
  return response.json();
}

export async function deleteTechnicalAlert(id: string): Promise<void> {
  const baseUrl = getGlobalBaseUrl() || "";
  const endpoint = baseUrl ? `${baseUrl}/scan/alerts/${id}` : `/api/scan/alerts/${id}`;
  const response = await fetch(endpoint, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error("Failed to delete technical alert");
}

export async function toggleTechnicalAlert(id: string, isActive: boolean): Promise<TechnicalAlert> {
  const baseUrl = getGlobalBaseUrl() || "";
  const endpoint = baseUrl ? `${baseUrl}/scan/alerts/${id}` : `/api/scan/alerts/${id}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive })
  });
  if (!response.ok) throw new Error("Failed to toggle alert status");
  return response.json();
}

export async function getStockFundamentals(ticker: string): Promise<any> {
  try {
    const res = await fetch(`/api/admin/fundamentals/${encodeURIComponent(ticker)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const result = await res.json();
    return result.data || null;
  } catch (err) {
    console.error("Failed to load stock fundamentals:", err);
    return null;
  }
}

export type AdaptiveRecommendation = {
  recommended_model: string;
  recommended_model_path?: string;
  regime: string;
  confidence: number;
  momentum_score: number;
  volatility_score: number;
  trend_strength: number;
  reason: string;
  candidate_models: string[];
  candidate_count: number;
  meets_min_confidence: boolean;
  min_confidence: number;
  as_of?: string | null;
  exchange: string;
};

export async function getAdaptiveRecommendation(params: {
  exchange?: string;
  as_of?: string;
  model_names?: string[];
  min_confidence?: number;
}): Promise<AdaptiveRecommendation> {
  const baseUrl = getProductionApiUrl();
  const query = new URLSearchParams();
  query.set("exchange", params.exchange ?? "EGX");
  if (params.min_confidence !== undefined) {
    query.set("min_confidence", String(params.min_confidence));
  }
  for (const modelName of params.model_names ?? []) {
    query.append("model_names", modelName);
  }
  if (params.as_of) query.set("as_of", params.as_of);
  const fetchUrl = `${baseUrl ? `${baseUrl}/adaptive/recommendation` : "/api/adaptive/recommendation"}?${query.toString()}`;
  const res = await fetch(fetchUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch adaptive recommendation (${res.status})`);
  }
  return res.json() as Promise<AdaptiveRecommendation>;
}

