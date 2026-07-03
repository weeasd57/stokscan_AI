import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fallback: build response from model_metadata table directly */
async function buildFromModelMetadata(exchange: string) {
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
    reason: "Served from model_metadata (daily update pending).",
    candidate_models: (models || []).map((m: any) => m.name).filter(Boolean),
    candidate_count: models?.length || 0,
    meets_min_confidence: Number(best.accuracy || 0) >= 0.55,
    min_confidence: 0.55,
    as_of: best.created_at || null,
  };
}

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const exchange = (incomingUrl.searchParams.get("exchange") || "EGX").toUpperCase();
  const minConfidence = Number(incomingUrl.searchParams.get("min_confidence") || 0.55);
  const cacheKey = `adaptive_recommendation_${exchange}`;
  const country = exchange === "EGX" ? "Egypt" : exchange;

  try {
    const supabase = getSupabaseClient();

    // 1️⃣ Try market_cache first (written by daily Python automation)
    const { data: cached, error } = await supabase
      .from("market_cache")
      .select("payload, computed_at")
      .eq("cache_key", cacheKey)
      .eq("country", country)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Adaptive recommendation cache error:", error);
    }

    if (cached?.payload) {
      const payload =
        typeof cached.payload === "string"
          ? JSON.parse(cached.payload)
          : cached.payload;
      return NextResponse.json({
        ...payload,
        cached: true,
        computed_at: cached.computed_at,
      });
    }

    // 2️⃣ Fallback to model_metadata table
    const fallback = await buildFromModelMetadata(exchange);
    if (fallback) {
      return NextResponse.json(fallback);
    }

    // 3️⃣ Nothing available yet
    return NextResponse.json({
      exchange,
      recommended_model: "",
      regime: "unknown",
      confidence: 0,
      momentum_score: 0,
      volatility_score: 0,
      trend_strength: 0,
      reason: "Adaptive recommendation not yet computed. Will be available after the next daily update.",
      candidate_models: [],
      candidate_count: 0,
      meets_min_confidence: false,
      min_confidence: minConfidence,
    });
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
        reason: "Adaptive recommendation is currently unavailable.",
        candidate_models: [],
        candidate_count: 0,
        meets_min_confidence: false,
        min_confidence: minConfidence,
      },
      { status: 200 }
    );
  }
}



