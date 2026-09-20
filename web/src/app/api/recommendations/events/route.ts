import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasActiveProSubscription } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_EVENT_TYPES = [
  "recommendation_closed",
  "recommendation_stale",
  "target_or_stop_adjusted",
];

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 500);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 1000);

  try {
    const supabase = getSupabaseServiceClient();
    const { data: events, error: eventError } = await supabase
      .from("recommendation_events")
      .select("id,recommendation_id,event_type,old_values,new_values,price_at_event,source,telegram_status,created_at")
      .in("event_type", PUBLIC_EVENT_TYPES)
      .not("recommendation_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (eventError) throw eventError;
    const auth = createSupabaseServerClient(request);
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ detail: "Pro subscription required" }, { status: 401 });
    const { data: subs } = await auth.from("subscriptions").select("plan_id,status,current_period_end").eq("user_id", user.id);
    const pro = hasActiveProSubscription(subs || []);
    if (!pro) return NextResponse.json({ detail: "Pro subscription required" }, { status: 403 });
    const visibleEvents = events || [];
    const recommendationIds = [...new Set(visibleEvents.map((event: any) => String(event.recommendation_id)))];
    if (!recommendationIds.length) {
      return NextResponse.json(
        { events: [], tracked_recommendation_ids: [] },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const { data: recommendations, error: recommendationError } = await supabase
      .from("scan_results")
      .select("id,symbol,exchange,name,signal,status,is_public,entry_price,target_price,stop_loss,exit_price,profit_loss_pct,logo_url")
      .in("id", recommendationIds)
      .eq("is_public", true);

    if (recommendationError) throw recommendationError;
    const byId = new Map<string, any>(
      (recommendations || []).map((row: any): [string, any] => [String(row.id), row]),
    );

    const trackedRecommendationIds = [...new Set(
      visibleEvents
        .filter((event: any) => event.event_type === "recommendation_closed" || event.event_type === "recommendation_stale")
        .filter((event: any) => event.telegram_status !== "historical")
        .map((event: any) => String(event.recommendation_id))
        .filter((id: string) => byId.has(id)),
    )];
    const sanitized = visibleEvents.filter((event: any) => event.telegram_status === "sent").flatMap((event: any) => {
      const recommendation = byId.get(String(event.recommendation_id));
      if (!recommendation) return [];
      const oldValues = event.old_values && typeof event.old_values === "object" ? event.old_values : {};
      const newValues = event.new_values && typeof event.new_values === "object" ? event.new_values : {};
      return [{
        id: String(event.id),
        recommendation_id: String(event.recommendation_id),
        event_type: event.event_type,
        occurred_at: event.created_at,
        price_at_event: numeric(event.price_at_event),
        source: event.source,
        symbol: recommendation.symbol,
        exchange: recommendation.exchange,
        name: recommendation.name,
        signal: recommendation.signal,
        logo_url: recommendation.logo_url,
        status: newValues.status || recommendation.status,
        entry_price: numeric(oldValues.entry_price ?? recommendation.entry_price),
        exit_price: numeric(newValues.exit_price ?? recommendation.exit_price ?? event.price_at_event),
        profit_loss_pct: numeric(newValues.profit_loss_pct ?? recommendation.profit_loss_pct),
        old_target: numeric(oldValues.target_price),
        new_target: numeric(newValues.target_price),
        old_stop: numeric(oldValues.stop_loss),
        new_stop: numeric(newValues.stop_loss),
        target_price: numeric(newValues.target_price ?? recommendation.target_price),
        stop_loss: numeric(newValues.stop_loss ?? recommendation.stop_loss),
        adjustment_type: newValues.adjustment_type || null,
      }];
    });

    return NextResponse.json(
      { events: sanitized, tracked_recommendation_ids: trackedRecommendationIds },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[RECOMMENDATION_EVENTS_API] Failed to load sent events", error);
    return NextResponse.json(
      { detail: "Recommendation event history is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
