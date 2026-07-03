import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackendBaseUrl() {
  return (
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000"
  );
}

async function buildSupabaseModelFallback(exchange: string, reason: string) {
  const supabase = getSupabaseClient();
  const { data: models } = await supabase
    .from("model_metadata")
    .select("name, exchange, accuracy, metadata, created_at")
    .eq("exchange", exchange)
    .order("accuracy", { ascending: false })
    .limit(5);

  const best = models?.[0] as any;
  if (!best?.name) return null;

  return {
    exchange,
    recommended_model: best.name,
    recommended_model_path: best.name,
    regime: "cached_model_metadata",
    confidence: Number(best.accuracy || 0),
    momentum_score: 0,
    volatility_score: 0,
    trend_strength: 0,
    reason,
    candidate_models: (models || []).map((model: any) => model.name).filter(Boolean),
    candidate_count: models?.length || 0,
    meets_min_confidence: Number(best.accuracy || 0) >= 0.55,
    min_confidence: 0.55,
    as_of: best.created_at || null,
  };
}

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const exchange = (incomingUrl.searchParams.get("exchange") || "EGX").toUpperCase();
  const cacheKey = `adaptive_recommendation_${exchange}`;
  const forceRefresh = incomingUrl.searchParams.get("force_refresh") === "true";

  try {
    const supabase = getSupabaseClient();

    if (!forceRefresh) {
      const { data: cached, error } = await supabase
        .from("market_cache")
        .select("payload, computed_at")
        .eq("cache_key", cacheKey)
        .eq("country", exchange === "EGX" ? "Egypt" : exchange)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && cached?.payload) {
        const payload = typeof cached.payload === "string" ? JSON.parse(cached.payload) : cached.payload;
        return NextResponse.json({
          ...payload,
          cached: true,
          computed_at: cached.computed_at,
        });
      }
    }

    const backendUrl = new URL("/adaptive/recommendation", getBackendBaseUrl());
    incomingUrl.searchParams.forEach((value, key) => {
      backendUrl.searchParams.append(key, value);
    });
    backendUrl.searchParams.set("exchange", exchange);

    const res = await fetch(backendUrl.toString(), { cache: "no-store" });
    const payload = res.ok
      ? await res.json()
      : await buildSupabaseModelFallback(exchange, `Using Supabase model metadata because backend adaptive engine returned ${res.status}.`);

    if (!payload) {
      throw new Error(`Backend adaptive recommendation failed (${res.status})`);
    }

    await supabase.from("market_cache").upsert(
      {
        cache_key: cacheKey,
        country: exchange === "EGX" ? "Egypt" : exchange,
        payload,
        computed_at: new Date().toISOString(),
      },
      {
        onConflict: "cache_key,country",
      }
    );

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("Adaptive recommendation route error:", error);
    return NextResponse.json(
      {
        exchange,
        recommended_model: "",
        regime: "unknown",
        confidence: 0,
        momentum_score: 0,
        volatility_score: 0,
        trend_strength: 0,
        reason: error?.message || "Adaptive recommendation is unavailable.",
        candidate_models: [],
        candidate_count: 0,
        meets_min_confidence: false,
        min_confidence: Number(incomingUrl.searchParams.get("min_confidence") || 0.55),
      },
      { status: 200 }
    );
  }
}
