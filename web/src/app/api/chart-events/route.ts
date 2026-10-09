import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";
import {
  cairoCalendarDate,
  CHART_EVENTS_WARNING,
  projectChartEvents,
  shiftCalendarDate,
  validChartEventDate,
} from "@/lib/chart-events";

export const runtime = "nodejs";
const errorResponse = (error: string, status: number) =>
  NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const symbol = (query.get("symbol") || "")
    .trim()
    .toUpperCase()
    .replace(/\.CA$/, "");
  if (
    !/^[A-Z0-9._-]{1,24}$/.test(symbol) ||
    (query.has("exchange") && query.get("exchange") !== "EGX")
  )
    return errorResponse("Invalid EGX symbol", 400);
  const today = cairoCalendarDate();
  const start = query.get("start_date") ?? shiftCalendarDate(today, -90);
  const end = query.get("end_date") ?? shiftCalendarDate(today, 365);
  if (
    !validChartEventDate(start) ||
    !validChartEventDate(end) ||
    start > end ||
    (Date.parse(end) - Date.parse(start)) / 86400000 > 730
  )
    return errorResponse("Invalid date range (maximum 730 days)", 400);
  try {
    // Only the public projection is cached. This function reads no cookies/user state.
    const read = unstable_cache(
      async () => {
        const client = getSupabaseServiceClient();
        const { data, error } = await client
          .from("corporate_actions")
          .select("symbol,action_date,title,action_type,url,source,confidence")
          .eq("exchange", "EGX")
          .eq("symbol", symbol)
          .gte("action_date", start)
          .lte("action_date", end)
          .not("action_date", "is", null)
          .not("url", "is", null)
          .order("action_date", { ascending: true })
          .limit(30);
        if (error) throw new Error("Corporate announcements read unavailable");
        return projectChartEvents(data || [], symbol, start, end);
      },
      ["chart-events-public-v1", symbol, start, end],
      { tags: [DAILY_CACHE_TAGS.news], revalidate: 86400 },
    );
    const events = await read();
    return NextResponse.json(
      { events, warning: CHART_EVENTS_WARNING },
      { headers: dailyCacheHeaders(DAILY_CACHE_TAGS.news) },
    );
  } catch {
    return errorResponse(
      "Corporate announcements temporarily unavailable",
      503,
    );
  }
}
