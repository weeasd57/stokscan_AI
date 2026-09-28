import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { getViewerContext } from "@/lib/supabase/viewer-context";
import { paymentsEnabled } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScanRow {
  id: string;
  created_at: string;
  updated_at: string | null;
  status: string | null;
  entry_price: number | null;
  exit_price: number | null;
  profit_loss_pct: number | null;
  last_close: number | null;
  signal: string | null;
  target_price: number | null;
  stop_loss: number | null;
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  const exchange = (request.nextUrl.searchParams.get("exchange") || "EGX").trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,20}$/.test(symbol) || !/^[A-Z0-9._-]{1,12}$/.test(exchange)) {
    return NextResponse.json({ markers: [] }, { status: 400 });
  }

  try {
    const { authenticated, pro } = await getViewerContext(request);
    const unrestricted = authenticated && (!paymentsEnabled() || pro);
    const delayDays = Number(process.env.FREE_SIGNAL_DELAY_DAYS || 15) || 15;
    const cutoff = Date.now() - delayDays * 86400000;
    const db = getSupabaseServiceClient();
    const { data, error } = await db.from("scan_results")
      .select("id,created_at,updated_at,status,signal,entry_price,exit_price,profit_loss_pct,last_close,target_price,stop_loss")
      .eq("symbol", symbol).eq("exchange", exchange).eq("is_public", true)
      .order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    const visible = ((data || []) as ScanRow[]).filter((row) => {
      const closed = ["win", "loss"].includes(String(row.status).toLowerCase());
      const created = Date.parse(row.created_at);
      const entry = Number(row.entry_price);
      const last = Number(row.last_close);
      const returnPct = entry > 0 && last > 0 ? ((last - entry) / entry) * 100 : Number(row.profit_loss_pct);
      return Number.isFinite(created) && (unrestricted || (created <= cutoff && !closed && !(returnPct > 50)));
    });
    const closedIds = visible.filter((row) => ["win", "loss"].includes(String(row.status).toLowerCase())).map((row) => row.id);
    const { data: events, error: eventError } = closedIds.length
      ? await db.from("recommendation_events")
        .select("recommendation_id,created_at,new_values,telegram_status")
        .in("recommendation_id", closedIds).eq("event_type", "recommendation_closed")
        .order("created_at", { ascending: false }).limit(500)
      : { data: [], error: null };
    if (eventError) throw eventError;
    const exitDates = new Map<string, string>();
    for (const event of events || []) {
      if (event.telegram_status !== "sent" || exitDates.has(String(event.recommendation_id))) continue;
      const closedOn = (event.new_values as any)?.rich_details?.evaluation?.closed_on;
      exitDates.set(String(event.recommendation_id), typeof closedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(closedOn) ? closedOn : event.created_at);
    }
    const markers = visible.flatMap((row) => {
      const result: Array<{ id: string; kind: "entry" | "exit"; time: number; price: number; outcome?: string }> = [];
      const entry = Number(row.entry_price);
      if (Number.isFinite(entry) && entry > 0) result.push({ id: String(row.id), kind: "entry", time: Math.floor(Date.parse(row.created_at) / 1000), price: entry });
      const exitDate = exitDates.get(String(row.id)) || row.updated_at;
      const exit = Number(row.exit_price);
      if (["win", "loss"].includes(String(row.status).toLowerCase()) && exitDate && Number.isFinite(Date.parse(exitDate)) && Number.isFinite(exit) && exit > 0) {
        result.push({ id: String(row.id), kind: "exit", time: Math.floor(Date.parse(exitDate) / 1000), price: exit, outcome: row.status });
      }
      return result;
    });
    const recommendations = visible.map((row) => ({
      id: String(row.id),
      created_at: row.created_at,
      status: row.status,
      signal: row.signal,
      entry_price: row.entry_price,
      exit_price: row.exit_price,
      exit_at: exitDates.get(String(row.id)) || (["win", "loss"].includes(String(row.status).toLowerCase()) ? row.updated_at : null),
      profit_loss_pct: row.profit_loss_pct,
      target_price: row.target_price,
      stop_loss: row.stop_loss,
    }));
    return NextResponse.json({ markers, recommendations }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[CHART_MARKERS]", error);
    return NextResponse.json({ markers: [] }, { status: 503 });
  }
}
