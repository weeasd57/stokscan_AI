import { buildPortfolioPerformance, type DailyPrice, type PerformanceHolding, type PortfolioSaleEvent } from "./portfolio-performance";

/** Public symbol queries are canonical and shared; no owner/quantity enters a cache key. */
export async function loadDailyHistory(market: any, symbol: string): Promise<DailyPrice[]> {
  const { data, error } = await market.from("stock_prices").select("date,close,adjusted_close")
    .eq("symbol", symbol).eq("exchange", symbol === "EGX30" ? "INDX" : "EGX")
    .order("date", { ascending: false }).limit(300);
  if (error) throw new Error(`Daily prices unavailable for ${symbol}`);
  return data || [];
}

export async function loadPortfolioPerformance(privateClient: any, market: any, userId: string) {
  // Cookie client + explicit owner predicate + RLS. These rows never use marketCachedFetch.
  const { data: positions, error } = await privateClient.from("positions")
    .select("id,symbol,quantity,entry_price,status").eq("user_id", userId).eq("status", "open").limit(101);
  if (error) throw new Error("Portfolio holdings unavailable");
  if ((positions || []).length > 100) throw new Error("Portfolio exceeds supported holding count");
  const holdings: PerformanceHolding[] = positions || [];
  const events: PortfolioSaleEvent[] = [];
  let historyTruncated = false;
  // Fetch only actual sales, not every chat/portfolio event. Bounded pagination avoids silent 1,000-row truncation.
  for (let page = 0; page < 10; page++) {
    const { data: rows, error: eventError } = await privateClient.from("position_events")
      .select("id,position_id,event_at,event_type,payload").eq("user_id", userId).eq("event_type", "portfolio_sell")
      .order("event_at", { ascending: false }).order("id", { ascending: false }).range(page * 1000, page * 1000 + 999);
    if (eventError) throw new Error("Portfolio sale history unavailable");
    events.push(...(rows || []));
    if ((rows || []).length < 1000) break;
    if (page === 9) historyTruncated = true;
  }
  const symbols = [...new Set(holdings.filter(row => Number(row.quantity) > 0).map(row => row.symbol)), "EGX30"];
  const histories: Record<string, DailyPrice[]> = {};
  // Cap cold-miss concurrency; subsequent viewers reuse the daily Vercel market cache.
  for (let start = 0; start < symbols.length; start += 6) {
    await Promise.all(symbols.slice(start, start + 6).map(async symbol => {
      histories[symbol] = await loadDailyHistory(market, symbol);
    }));
  }
  return buildPortfolioPerformance(holdings, events, histories, histories.EGX30 || [], historyTruncated);
}
