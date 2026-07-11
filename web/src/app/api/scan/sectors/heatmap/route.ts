import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const date = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function pickFundamentalText(payload: any, keys: string[]): string | null {
  if (!payload || typeof payload !== "object") return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const selectedDate = normalizeDate(incomingUrl.searchParams.get("date"));
  const startDate = normalizeDate(incomingUrl.searchParams.get("start"));
  const endDate = normalizeDate(incomingUrl.searchParams.get("end"));

  try {
    const supabase = getSupabaseClient();

    // Fetch unique dates using FWRY (active symbol representing EGX trading days)
    let { data: latestDates, error: datesError } = await supabase
      .from("stock_technical_indicators")
      .select("date")
      .eq("symbol", "FWRY")
      .order("date", { ascending: false })
      .limit(90);

    // Fallback 1: COMI
    if (datesError || !latestDates || latestDates.length === 0) {
      const fb = await supabase
        .from("stock_technical_indicators")
        .select("date")
        .eq("symbol", "COMI")
        .order("date", { ascending: false })
        .limit(90);
      latestDates = fb.data;
      datesError = fb.error;
    }

    // Fallback 2: General query (limit 10000 to extract unique dates)
    if (datesError || !latestDates || latestDates.length === 0) {
      const fb = await supabase
        .from("stock_technical_indicators")
        .select("date")
        .eq("exchange", "EGX")
        .order("date", { ascending: false })
        .limit(10000);
      latestDates = fb.data;
      datesError = fb.error;
    }

    if (datesError) {
      console.error("Heatmap dates Supabase error:", datesError);
      return NextResponse.json({ error: "Failed to fetch heatmap dates" }, { status: 500 });
    }

    const availableDates = Array.from(
      new Set<string>((latestDates || []).map((row: any) => String(row.date || "")).filter(Boolean))
    ).slice(0, 90);
    if (availableDates.length === 0) {
      return NextResponse.json({ rows: [], available_dates: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    let effectiveDate = selectedDate;
    if (!effectiveDate || !availableDates.includes(effectiveDate)) {
      const matchingDate = selectedDate
        ? availableDates.find((date) => date <= selectedDate)
        : availableDates[0];
      effectiveDate = matchingDate || availableDates[0];
    }

    const rangeStart = startDate && availableDates.includes(startDate) ? startDate : effectiveDate;
    const rangeEnd = endDate && availableDates.includes(endDate) ? endDate : effectiveDate;
    const fromDate = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const toDate = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    const rangeDates = availableDates.filter((date) => date >= fromDate && date <= toDate);

    const allRows: any[] = [];
    for (let offset = 0; offset < 20000; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("stock_technical_indicators")
        .select("symbol,exchange,date,close,volume,change_pct")
        .eq("exchange", "EGX")
        .gte("date", fromDate)
        .lte("date", toDate)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error("Heatmap technical rows Supabase error:", error);
        return NextResponse.json({ error: "Failed to fetch heatmap rows" }, { status: 500 });
      }

      allRows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const symbols = allRows.map((row) => row.symbol).filter(Boolean);
    const fundamentals = new Map<string, any>();
    for (let i = 0; i < symbols.length; i += 200) {
      const chunk = symbols.slice(i, i + 200);
      const { data, error } = await supabase
        .from("stock_fundamentals")
        .select("symbol,data")
        .eq("exchange", "EGX")
        .in("symbol", chunk);

      if (error) {
        console.error("Heatmap fundamentals Supabase error:", error);
        continue;
      }

      for (const row of data || []) {
        fundamentals.set(row.symbol, row.data || {});
      }
    }

    const rows = allRows.map((row) => {
      const data = fundamentals.get(row.symbol) || {};
      return {
        symbol: row.symbol,
        exchange: row.exchange,
        date: row.date,
        close: row.close,
        volume: row.volume,
        change_pct: row.change_pct,
        sector: pickFundamentalText(data, ["sector", "Sector", "sectorName"]) || "Other",
        industry: pickFundamentalText(data, ["industry", "Industry"]),
        name: pickFundamentalText(data, ["name", "Name", "companyName", "CompanyName"]) || row.symbol,
      };
    });

    return NextResponse.json(
      {
        rows,
        selected_date: effectiveDate,
        requested_date: selectedDate,
        available_dates: availableDates,
        range_start: fromDate,
        range_end: toDate,
        range_dates: rangeDates,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Heatmap API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
