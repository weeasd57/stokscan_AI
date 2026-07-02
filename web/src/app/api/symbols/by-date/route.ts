import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const start = incomingUrl.searchParams.get("start");
  const end = incomingUrl.searchParams.get("end");
  const exchange = incomingUrl.searchParams.get("exchange");
  const limit = parseInt(incomingUrl.searchParams.get("limit") || "50");
  const searchTerm = incomingUrl.searchParams.get("search_term");

  try {
    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('stocks')
      .select(`
        symbol,
        exchange,
        name,
        stock_prices(count)
      `)
      .eq('is_active', true);

    if (exchange) {
      query = query.eq('exchange', exchange);
    }

    if (searchTerm) {
      query = query.or(`symbol.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`);
    }

    const { data: stocks, error } = await query
      .limit(limit)
      .order('symbol', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to fetch symbols' }, { status: 500 });
    }

    // Transform to match expected format
    const results = stocks?.map(stock => ({
      symbol: stock.symbol,
      exchange: stock.exchange,
      name: stock.name || '',
      rowCount: stock.stock_prices?.[0]?.count || 0
    })) || [];

    return NextResponse.json({ results });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
