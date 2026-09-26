import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";
import { getViewerContext } from "@/lib/supabase/viewer-context";
import { paymentsEnabled } from "@/lib/ai/plan-gate";

/** Recommendations with a safety rate above this are Pro-only too. */
const PRO_SAFETY_THRESHOLD = 8;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 86400;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 200)
      : 50;
  const recommendationFields =
    "id,batch_id,symbol,exchange,name,last_close,precision,signal,status,entry_price,target_price,stop_loss,is_public,created_at,updated_at,exit_price,profit_loss_pct,top_reasons";
  
  try {
    const supabase = getSupabaseServiceClient({ cacheMarketData: true });
    // Session + plan now resolve through in-memory freshness windows instead
    // of a Supabase auth round trip on every page view.
    const { authenticated, pro } = await getViewerContext(req);
    const payments = paymentsEnabled();
    const delayedVisibility = !authenticated || (payments && !pro);
    const delayDays = Number(process.env.FREE_SIGNAL_DELAY_DAYS || 15) || 15;
    const cutoffTime = Date.now() - delayDays * 24 * 60 * 60 * 1000;
    // Round down the display cutoff; actionable-signal gating uses cutoffTime.
    const cutoff = new Date(Math.floor(cutoffTime / 86400000) * 86400000).toISOString();
    // The calendar and closed archive need every public recommendation.
    // current_public_recommendations deduplicates by symbol and would erase
    // historical wins/losses whenever that view exists.
    const recommendationsQuery = supabase
      .from("scan_results")
      .select(recommendationFields)
      .eq("is_public", true);
    const { data, error } = await recommendationsQuery
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    let visibleData = data || [];
    // Safety rate mirrors the client's low-risk score (1-10, stop distance);
    // actionable picks above the Pro threshold are Pro-only regardless of age.
    const safetyRateOf = (row: Record<string, unknown>) => {
      const lastClose = toNumber(row.last_close, 0);
      const stopLoss = toNumber(row.stop_loss, 0);
      if (!stopLoss || !lastClose) return 0;
      const distPct = Math.abs((lastClose - stopLoss) / lastClose);
      return Math.max(1, Math.min(10, Math.round(10 - distPct * 20)));
    };
    // Anonymous visitors must never receive today's actionable picks.
    // Settled outcomes are public immediately, including losses; a closed
    // recommendation can no longer be traded on its original signal.
    if (!authenticated) {
      visibleData = visibleData.filter((row: Record<string, unknown>) => {
        const closed = ["win", "loss"].includes(String(row.status || "").toLowerCase());
        if (closed) return true;
        const createdMs = new Date(String(row.created_at)).getTime();
        return Number.isFinite(createdMs) && createdMs <= cutoffTime &&
          safetyRateOf(row) <= PRO_SAFETY_THRESHOLD;
      });
    }

    const symbols = Array.from(new Set(visibleData.map((row: Record<string, unknown>) => String(row.symbol || "")).filter(Boolean)));
    const { data: fundamentals } = symbols.length
      ? await supabase
        .from("stock_fundamentals")
        .select("symbol,data")
        .in("symbol", symbols)
      : { data: [] as Array<{ symbol: string; data?: Record<string, unknown> }> };
    const sectorMap = new Map((fundamentals || []).map((row: any) => [
      String(row.symbol),
      row.data?.sector || row.data?.Sector || row.data?.industry || "General",
    ]));

    const results = visibleData.map((row: Record<string, unknown>) => {
      // Closed outcomes are public immediately. Only actionable recommendations
      // inside the delay window or with high safety remain locked for Free.
      const createdMs = row.created_at ? new Date(String(row.created_at)).getTime() : Number.NaN;
      const closed = ["win", "loss"].includes(String(row.status || "").toLowerCase());
      const fresh = !Number.isFinite(createdMs) || createdMs > cutoffTime;
      const locked = authenticated && delayedVisibility &&
        !closed && (fresh || safetyRateOf(row) > PRO_SAFETY_THRESHOLD);
      if (locked) {
        return {
          id: row.id,
          locked: true,
          created_at: row.created_at,
          delayed: true,
          snapshot_cutoff: cutoff,
        };
      }
      return {
      ...(authenticated ? row : {
        id: row.id,
        symbol: row.symbol,
        exchange: row.exchange,
        name: row.name,
        is_public: row.is_public,
        created_at: row.created_at,
        ...(closed ? {
          status: row.status,
          updated_at: row.updated_at,
          entry_price: row.entry_price,
          exit_price: row.exit_price,
          profit_loss_pct: row.profit_loss_pct,
        } : {}),
        delayed: !closed,
        anonymous: true,
      }),
      sector: sectorMap.get(String(row.symbol)) || "General",
      year: row.created_at ? new Date(String(row.created_at)).getFullYear() : null,
      // The client must not present live-looking values for delayed rows.
      delayed: delayedVisibility && !closed,
      snapshot_cutoff: delayedVisibility && !closed ? cutoff : null,
      precision: authenticated ? toNumber(row.precision, 0) : null,
      // A delayed recommendation must not carry today's live quote.
      last_close: delayedVisibility ? null : toNumber(row.last_close, 0),
      top_reasons: delayedVisibility ? null : row.top_reasons,
      };
    });

    return NextResponse.json(results, {
      headers: {
        // Visibility depends on the request's Supabase session. Never let a
        // CDN-shared response cross between anonymous and authenticated users.
        // Keep plan-specific responses private, but allow the same browser
        // tab to reuse the daily snapshot while navigating between tabs.
        "Cache-Control": "private, max-age=300, stale-while-revalidate=300",
        "Vercel-Cache-Tag": DAILY_CACHE_TAGS.recommendations,
      },
    });
  } catch (error) {
    console.error("ai_bot recommendations error:", error);
    return NextResponse.json([], { status: 200 });
  }
}
