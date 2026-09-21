import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPro, filterByDelay, planLimits, paymentsEnabled } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function paymentsEnabledSafe(): boolean {
  try {
    return paymentsEnabled();
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const billingEnabled = paymentsEnabledSafe();
    const responseHeaders: Record<string, string> = billingEnabled
      ? { "Cache-Control": "private, max-age=300, stale-while-revalidate=300" }
      : {
          "Cache-Control": "public, max-age=30",
          "Vercel-CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        };

    // Determine the requesting user (if logged in) so we can apply plan-gated
    // visibility: subscribers see today's recommendations immediately; free
    // users only see recommendations older than the configured signal delay.
    let userIsPro = !billingEnabled; // the route is shared/cacheable while billing is disabled
    let userPlan = "free";
    if (billingEnabled) {
      try {
        const userClient = createSupabaseServerClient(req);
        const { data: authUser } = await userClient.auth.getUser();
        if (authUser?.user?.id) {
          const { data: planRows } = await userClient
            .from("subscriptions")
            .select("plan_id,status,current_period_end")
            .eq("user_id", authUser.user.id)
            .limit(10);
          userIsPro = isPro(planRows || []);
          userPlan = userIsPro ? "pro" : "free";
        }
      } catch {
        // Not logged in -> treat as free (delayed) when payments are on.
        userIsPro = false;
      }
    }

    // 1. Fetch latest open AI recommendations
    const { data: recommendations, error: recError } = await supabase
      .from("scan_results")
      .select("symbol, name, signal, entry_price, target_price, stop_loss, precision, top_reasons, model_name, created_at")
      .eq("country", "Egypt")
      .eq("status", "open")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (recError) {
      console.error("Failed to fetch scan results:", recError);
      return NextResponse.json({ error: "Failed to fetch AI signals" }, { status: 500 });
    }

    if (!recommendations || recommendations.length === 0) {
      return NextResponse.json({
        signals: [],
        total_open: 0,
        buy_count: 0,
        sell_count: 0,
      }, { headers: responseHeaders });
    }

    // Visibility gate: free (non-subscriber) users only see recommendations
    // older than the signal-delay window when payments are enabled.
    const limits = planLimits(userPlan);
    const visible = userIsPro
      ? recommendations
      : filterByDelay(recommendations, limits.signal_delay_days);

    if (visible.length === 0) {
      return NextResponse.json({
        signals: [],
        total_open: 0,
        buy_count: 0,
        sell_count: 0,
        delayed: limits.signal_delay_days,
        gated: !userIsPro,
      }, { headers: responseHeaders });
    }

    const symbols = visible.map((r: any) => r.symbol);

    // 2. Fetch latest prices for these symbols from stock_technical_indicators
    // Get the latest technical indicators date first to query the exact row
    const { data: dateRows } = await supabase
      .from("stock_technical_indicators")
      .select("date")
      .eq("exchange", "EGX")
      .order("date", { ascending: false })
      .limit(1);

    const latestDate = dateRows && dateRows.length > 0 ? dateRows[0].date : null;

    let pricesMap = new Map<string, number>();
    if (latestDate) {
      const { data: priceRows } = await supabase
        .from("stock_technical_indicators")
        .select("symbol, close")
        .eq("date", latestDate)
        .in("symbol", symbols);

      if (priceRows) {
        for (const row of priceRows) {
          pricesMap.set(row.symbol.toUpperCase(), Number(row.close || 0));
        }
      }
    }

    // Fallback: if some symbols are missing or date failed, check stock_prices latest close
    const missingSymbols = symbols.filter((s: any) => !pricesMap.has(s.toUpperCase()));
    if (missingSymbols.length > 0) {
      const uniqueMissing = [...new Set(missingSymbols.map((symbol: any) => String(symbol).toUpperCase()))];
      const fallbackLimit = Math.min(Math.max(uniqueMissing.length * 30, 300), 2000);
      const { data: fallbackPrices } = await supabase
        .from("stock_prices")
        .select("symbol,close,date")
        .in("symbol", uniqueMissing)
        .order("date", { ascending: false })
        .limit(fallbackLimit);

      if (fallbackPrices) {
        for (const row of fallbackPrices) {
          const symbol = String(row.symbol || "").toUpperCase();
          if (symbol && !pricesMap.has(symbol)) {
            pricesMap.set(symbol, Number(row.close || 0));
          }
        }
      }
    }

    // 3. Process Signals
    let buyCount = 0;
    let sellCount = 0;
    const signals: any[] = [];

    for (const rec of visible) {
      const symbolUpper = rec.symbol.toUpperCase();
      const currentPrice = pricesMap.get(symbolUpper) || Number(rec.entry_price || 0);

      const entry = Number(rec.entry_price || 0);
      const isBuy = String(rec.signal || "").toUpperCase().includes("BUY");
      if (isBuy) buyCount++;
      else sellCount++;

      // Compute PnL %
      let pnlPct = 0;
      if (entry > 0) {
        pnlPct = isBuy
          ? ((currentPrice - entry) / entry) * 100
          : ((entry - currentPrice) / entry) * 100;
      }

      // Parse top reasons
      let reasons: string[] = [];
      if (rec.top_reasons) {
        if (Array.isArray(rec.top_reasons)) {
          reasons = rec.top_reasons;
        } else if (typeof rec.top_reasons === "string") {
          try {
            reasons = JSON.parse(rec.top_reasons);
          } catch {
            reasons = [rec.top_reasons];
          }
        }
      }

      signals.push({
        symbol: rec.symbol,
        name: rec.name || rec.symbol,
        signal: isBuy ? "BUY" : "SELL",
        entry_price: entry,
        current_price: currentPrice,
        target_price: Number(rec.target_price || 0),
        stop_loss: Number(rec.stop_loss || 0),
        precision: Number(rec.precision || 0),
        pnl_pct: pnlPct,
        top_reasons: reasons,
        model_name: rec.model_name || "AI Council",
        created_at: rec.created_at,
        council_score: 0,
      });
    }

    return NextResponse.json({
      signals,
      total_open: signals.length,
      buy_count: buyCount,
      sell_count: sellCount,
      gated: !userIsPro,
      signal_delay_days: userIsPro ? 0 : planLimits(userPlan).signal_delay_days,
    }, { headers: responseHeaders });
  } catch (error) {
    console.error("AI Signals API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
