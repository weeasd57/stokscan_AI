import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSETS = [
  { symbol: "EGX30", exchange: "INDX", kind: "index", nameAr: "مؤشر EGX30", nameEn: "EGX30 Index" },
  { symbol: "EGREF", exchange: "EGX", kind: "fund", nameAr: "صندوق المصريين العقاري", nameEn: "Egyptians Real Estate Fund" },
  { symbol: "KASABF", exchange: "EGX", kind: "fund", nameAr: "وثائق كاسب", nameEn: "KASAB Fund Certificates" },
] as const;

const PAGE_SIZE = 1000;
const MAX_ROWS_PER_ASSET = 5000;
const MAX_RANGE_DAYS = 5 * 366;

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function loadPrices(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  asset: (typeof ASSETS)[number],
  from: string,
  to: string,
) {
  const prices: Array<{ date: string; close: number }> = [];
  let offset = 0;

  while (offset < MAX_ROWS_PER_ASSET) {
    const end = Math.min(offset + PAGE_SIZE, MAX_ROWS_PER_ASSET) - 1;
    const { data, error } = await supabase
      .from("stock_prices")
      .select("date,close")
      .eq("symbol", asset.symbol)
      .eq("exchange", asset.exchange)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .range(offset, end);

    if (error) throw error;
    const rows = data || [];
    prices.push(...rows.flatMap((row: any) => {
      const close = Number(row.close);
      return row.date && Number.isFinite(close) && close > 0
        ? [{ date: String(row.date).slice(0, 10), close }]
        : [];
    }));
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    ...asset,
    prices,
    truncated: prices.length >= MAX_ROWS_PER_ASSET,
    asOf: prices.length ? prices[prices.length - 1].date : null,
  };
}

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!validDate(from) || !validDate(to) || from > to) {
    return NextResponse.json({ error: "Valid from and to dates are required." }, { status: 400 });
  }

  const dayCount = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (dayCount > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: "Benchmark range is limited to five years." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServiceClient({ cacheMarketData: true });
    // Include the preceding week so a recommendation opened on a market holiday
    // can be paired with the last available close, subject to a freshness check.
    const queryFrom = new Date(Date.parse(`${from}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const assets = await Promise.all(ASSETS.map(asset => loadPrices(supabase, asset, queryFrom, to)));
    return NextResponse.json(
      { from, to, assets },
      { headers: dailyCacheHeaders(DAILY_CACHE_TAGS.market) },
    );
  } catch (error) {
    console.error("[RECOMMENDATION_BENCHMARK] Failed to load market prices", error);
    return NextResponse.json(
      { error: "Benchmark market data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "public, s-maxage=300, stale-if-error=86400" } },
    );
  }
}
