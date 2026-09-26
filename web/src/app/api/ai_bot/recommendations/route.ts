import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";
import { getViewerContext } from "@/lib/supabase/viewer-context";
import { paymentsEnabled } from "@/lib/ai/plan-gate";

const FREE_HIDDEN_WIN_RETURN_PCT = 50;

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
    const closed = (row: Record<string, unknown>) => ["win", "loss"].includes(String(row.status || "").toLowerCase());
    const highReturnWin = (row: Record<string, unknown>) =>
      String(row.status || "").toLowerCase() === "win" &&
      toNumber(row.profit_loss_pct, 0) > FREE_HIDDEN_WIN_RETURN_PCT;
    if (delayedVisibility) {
      visibleData = visibleData.filter((row: Record<string, unknown>) => !highReturnWin(row));
    }
    // Anonymous visitors must never receive today's actionable picks.
    // Settled outcomes are public immediately, including losses; a closed
    // recommendation can no longer be traded on its original signal.
    if (!authenticated) {
      visibleData = visibleData.filter((row: Record<string, unknown>) => {
        if (closed(row)) return true;
        const createdMs = new Date(String(row.created_at)).getTime();
        return Number.isFinite(createdMs) && createdMs <= cutoffTime;
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
      // Closed outcomes below the high-return filter are visible immediately,
      // but their identity remains Pro-only. Open signals use the 15-day delay.
      const createdMs = row.created_at ? new Date(String(row.created_at)).getTime() : Number.NaN;
      const isClosed = closed(row);
      const fresh = !Number.isFinite(createdMs) || createdMs > cutoffTime;
      const locked = delayedVisibility && !isClosed && (!authenticated || fresh);
      if (locked) {
        const precision = toNumber(row.precision, 0);
        const score = (value: number) => Math.max(1, Math.min(10, Math.round(value)));
        const lastClose = toNumber(row.last_close, 0);
        const entryPrice = toNumber(row.entry_price, 0);
        const sinceRecommendationPct = entryPrice > 0 && lastClose > 0
          ? ((lastClose - entryPrice) / entryPrice) * 100
          : row.profit_loss_pct != null
            ? toNumber(row.profit_loss_pct, 0)
            : null;
        const stopLoss = toNumber(row.stop_loss, 0);
        const safetyRate = lastClose > 0 && stopLoss > 0
          ? score(10 - Math.abs((lastClose - stopLoss) / lastClose) * 20)
          : 5;
        return {
          id: row.id,
          locked: true,
          exchange: row.exchange || "EGX",
          signal: row.signal || "BUY",
          status: row.status || "open",
          precision,
          technical_score: score(precision * 10 - 0.5),
          fundamental_score: score(precision * 10 - 0.8),
          sentiment_score: score(precision * 10 - 1.2),
          safety_rate: safetyRate,
          profit_loss_pct: sinceRecommendationPct,
          created_at: row.created_at,
          delayed: true,
          snapshot_cutoff: cutoff,
        };
      }
      if (delayedVisibility && isClosed) {
        return {
          id: row.id,
          identity_locked: true,
          exchange: row.exchange || "EGX",
          status: row.status,
          precision: toNumber(row.precision, 0),
          profit_loss_pct: toNumber(row.profit_loss_pct, 0),
          created_at: row.created_at,
          updated_at: row.updated_at || row.created_at,
          delayed: false,
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
        ...(isClosed ? {
          status: row.status,
          updated_at: row.updated_at,
          entry_price: row.entry_price,
          exit_price: row.exit_price,
          profit_loss_pct: row.profit_loss_pct,
        } : {}),
        delayed: !isClosed,
        anonymous: true,
      }),
      sector: sectorMap.get(String(row.symbol)) || "General",
      year: row.created_at ? new Date(String(row.created_at)).getFullYear() : null,
      // Rows reaching this branch are visible now (Pro, or Free after the
      // 15-day delay); only rows returned by the locked branch are delayed.
      delayed: false,
      snapshot_cutoff: null,
      precision: authenticated ? toNumber(row.precision, 0) : null,
      // Locked rows returned above never carry quotes or analysis. Once the
      // delay expires, visible recommendations can safely include their data.
      last_close: toNumber(row.last_close, 0) > 0 ? toNumber(row.last_close, 0) : null,
      top_reasons: row.top_reasons,
      };
    });

    return NextResponse.json(results, {
      headers: {
        // Visibility depends on the request's Supabase session. Never let a
        // CDN-shared response cross between anonymous and authenticated users.
        // Keep plan-specific responses private, but allow the same browser
        // tab to reuse the daily snapshot while navigating between tabs.
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Vercel-Cache-Tag": DAILY_CACHE_TAGS.recommendations,
      },
    });
  } catch (error) {
    console.error("ai_bot recommendations error:", error);
    return NextResponse.json([], { status: 200 });
  }
}
