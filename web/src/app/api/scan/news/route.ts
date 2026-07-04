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
    // stock_news_sentiment columns: id, symbol, exchange, date, sentiment_score,
    // news_count, negative_flag, positive_flag, headlines (jsonb), sources (jsonb), created_at
    let query = supabase
      .from("stock_news_sentiment")
      .select("*", { count: "exact" })
      .order("date", { ascending: false });

    // Filter: only show stocks with actual news unless explicitly searched for
    if (search.trim()) {
      query = query.ilike("symbol", `%${search}%`);
    } else {
      query = query.gt("news_count", 0);
    }

    // Apply range pagination
    query = query.range(offset, offset + limit - 1);

    // Derive sentiment from score — no sentiment_label column
    if (sentiment === "positive") {
      query = query.gt("sentiment_score", 0.1);
    } else if (sentiment === "negative") {
      query = query.lt("sentiment_score", -0.1);
    } else if (sentiment === "neutral") {
      query = query.gte("sentiment_score", -0.1).lte("sentiment_score", 0.1);
    }

    // Filter by date (column is 'date', not 'published_at')
    if (dateFilter) {
      query = query.eq("date", dateFilter);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("news fetch error:", error);
      return NextResponse.json({ data: [], total: 0 });
    }

    const items = (data || []).map((row: Record<string, unknown>) => {
      const score = toNumber(row.sentiment_score);
      const label = score > 0.1 ? "positive" : score < -0.1 ? "negative" : "neutral";
      const headlines = Array.isArray(row.headlines) ? row.headlines : [];
      return {
        id: row.id,
        symbol: row.symbol,
        exchange: row.exchange,
        date: row.date,
        sentiment_score: score,
        sentiment_label: label,
        news_count: typeof row.news_count === "number" ? row.news_count : headlines.length,
        headlines,
        sources: Array.isArray(row.sources) ? row.sources : [],
      };
    });

    return NextResponse.json({ data: items, total: count || 0 });
  } catch (error) {
    console.error("news route error:", error);
    return NextResponse.json({ data: [], total: 0 });
  }
}
