import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    const search = url.searchParams.get("search") || "";
    const sentiment = url.searchParams.get("sentiment") || "all";
    const dateFilter = url.searchParams.get("date") || "";

    const supabase = getSupabaseClient();
    let query = supabase
      .from("stock_news_sentiment")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search.trim()) {
      query = query.ilike("title", `%${search}%`);
    }

    if (sentiment !== "all") {
      query = query.eq("sentiment_label", sentiment);
    }

    if (dateFilter) {
      const start = new Date(dateFilter);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query = query.gte("published_at", start.toISOString()).lt("published_at", end.toISOString());
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("news fetch error:", error);
      return NextResponse.json({ data: [], total: 0 });
    }

    const items = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      source: row.source,
      published_at: row.published_at,
      sentiment_score: toNumber(row.sentiment_score),
      sentiment_label: row.sentiment_label,
    }));

    return NextResponse.json({ data: items, total: count || 0 });
  } catch (error) {
    console.error("news route error:", error);
    return NextResponse.json({ data: [], total: 0 });
  }
}
