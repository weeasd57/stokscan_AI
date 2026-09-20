import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { filterByDelay, hasActiveProSubscription, paymentsEnabled } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 200)
      : 50;
  const recommendationFields =
    "id,batch_id,symbol,exchange,name,last_close,precision,signal,status,entry_price,target_price,stop_loss,is_public,created_at,updated_at,exit_price,profit_loss_pct,top_reasons";
  
  try {
    const supabase = getSupabaseServiceClient();
    let authenticated = false;
    let pro = false;
    try {
      const auth = createSupabaseServerClient(req);
      const { data: { user } } = await auth.auth.getUser();
      authenticated = Boolean(user);
      if (user && paymentsEnabled()) {
        const { data: subs } = await auth.from("subscriptions").select("plan_id,status,current_period_end").eq("user_id", user.id);
        pro = hasActiveProSubscription(subs || []);
      }
    } catch { /* unauthenticated users are always delayed */ }

    const delayedVisibility = !authenticated || (paymentsEnabled() && !pro);
    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const applyVisibility = (query: any) => delayedVisibility
      ? query.lt("created_at", cutoff)
      : query;

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
    // Anonymous visitors must never receive today's recommendations, even when
    // billing is disabled for the rest of the authenticated platform.
    if (delayedVisibility) {
      visibleData = filterByDelay(visibleData, 5);
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

    const results = visibleData.map((row: Record<string, unknown>) => ({
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
      precision: toNumber(row.precision, 0),
      last_close: toNumber(row.last_close, 0),
    }));

    return NextResponse.json(results, {
      headers: {
        // Visibility depends on the request's Supabase session. Never let a
        // CDN-shared response cross between anonymous and authenticated users.
        "Cache-Control": "private, no-store",
        "Vercel-Cache-Tag": DAILY_CACHE_TAGS.recommendations,
      },
    });
  } catch (error) {
    console.error("ai_bot recommendations error:", error);
    return NextResponse.json([], { status: 200 });
  }
}
