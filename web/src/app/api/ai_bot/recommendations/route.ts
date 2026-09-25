import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";
import { getViewerContext } from "@/lib/supabase/viewer-context";
import { filterByDelay, paymentsEnabled } from "@/lib/ai/plan-gate";

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
    // Minute/millisecond-specific cutoffs would defeat shared query reuse.
    // Round down conservatively; filterByDelay still enforces the exact cutoff.
    const cutoff = new Date(Math.floor(cutoffTime / 86400000) * 86400000).toISOString();
    const applyVisibility = (query: any) => {
      if (!authenticated) {
        return query.eq("status", "open").lt("created_at", cutoff);
      }
      // Authenticated Free users receive every recommendation, but rows newer
      // than the delay window are row-masked in the mapper below (locked).
      return query;
    };

    let recommendationsQuery = supabase
      .from("current_public_recommendations")
      .select(recommendationFields)
      .eq("is_public", true)
    let { data, error } = await applyVisibility(recommendationsQuery)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Older production databases may not have the reconciliation view yet.
    // Keep a deliberately narrow, public-only fallback rather than exposing
    // every scan_results column through a public endpoint.
    if (error) {
      let fallbackQuery = supabase
        .from("scan_results")
        .select(recommendationFields)
        .eq("is_public", true);
      const fallback = await applyVisibility(fallbackQuery)
        .order("created_at", { ascending: false })
        .limit(limit);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;

    let visibleData = data || [];
    // Safety rate mirrors the client's low-risk score (1-10, stop distance);
    // picks above the Pro threshold are Pro-only regardless of age.
    const safetyRateOf = (row: Record<string, unknown>) => {
      const lastClose = toNumber(row.last_close, 0);
      const stopLoss = toNumber(row.stop_loss, 0);
      if (!stopLoss || !lastClose) return 0;
      const distPct = Math.abs((lastClose - stopLoss) / lastClose);
      return Math.max(1, Math.min(10, Math.round(10 - distPct * 20)));
    };
    // Anonymous visitors must never receive today's recommendations, even when
    // billing is disabled for the rest of the authenticated platform.
    // High-safety picks are Pro-only content and are withheld from anonymous
    // requests entirely (locked placeholders render for signed-in Free only).
    if (!authenticated) {
      visibleData = filterByDelay(visibleData, delayDays).filter((row: Record<string, unknown>) => safetyRateOf(row) <= PRO_SAFETY_THRESHOLD);
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
      // Free users receive every row, but fresh signals (delay window) and
      // high-safety picks are Pro-only: identity stays hidden — no symbol,
      // company name, logo or prices. Scores, signal, status and dates stay
      // visible so locked rows render like real recommendations with an
      // encrypted name.
      const createdMs = row.created_at ? new Date(String(row.created_at)).getTime() : Number.NaN;
      const fresh = !Number.isFinite(createdMs) || createdMs > cutoffTime;
      const locked = authenticated && delayedVisibility && (fresh || safetyRateOf(row) > PRO_SAFETY_THRESHOLD);
      if (locked) {
        return {
          id: row.id,
          locked: true,
          signal: row.signal || "BUY",
          status: row.status || "open",
          exchange: row.exchange || null,
          precision: toNumber(row.precision, 0),
          // Prices are withheld, so the client cannot recompute the low-risk
          // score — send the value the row was gated on.
          safety_rate: safetyRateOf(row) || null,
          created_at: row.created_at,
          updated_at: row.updated_at || row.created_at,
          sector: sectorMap.get(String(row.symbol)) || "General",
          year: row.created_at ? new Date(String(row.created_at)).getFullYear() : null,
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
        delayed: true,
        anonymous: true,
      }),
      sector: sectorMap.get(String(row.symbol)) || "General",
      year: row.created_at ? new Date(String(row.created_at)).getFullYear() : null,
      // The client must not present live-looking values for delayed rows.
      delayed: delayedVisibility,
      snapshot_cutoff: delayedVisibility ? cutoff : null,
      precision: authenticated ? toNumber(row.precision, 0) : null,
      last_close: authenticated ? toNumber(row.last_close, 0) : null,
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
