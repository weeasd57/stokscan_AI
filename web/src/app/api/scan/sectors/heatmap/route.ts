import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const country = incomingUrl.searchParams.get("country") || "Egypt";
  
  try {
    const supabase = getSupabaseClient();
    
    // Get recent heatmap data from Supabase
    const { data: heatmapData, error } = await supabase
      .from('market_heatmap')
      .select('*')
      .eq('exchange', 'EGX') // Map country to exchange
      .order('captured_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Heatmap Supabase error:', error);
      return NextResponse.json({ error: 'Failed to fetch heatmap data' }, { status: 500 });
    }

    // Group by sector and calculate aggregates
    const sectors = new Map<string, {
      sector: string;
      totalCap: number;
      avgChange: number;
      count: number;
      symbols: Array<{
        symbol: string;
        change_pct: number;
        volume: number;
        cap: number;
      }>;
    }>();

    heatmapData?.forEach((row: any) => {
      const sector = row.sector || 'Other';
      if (!sectors.has(sector)) {
        sectors.set(sector, {
          sector,
          totalCap: 0,
          avgChange: 0,
          count: 0,
          symbols: []
        });
      }
      
      const sectorData = sectors.get(sector)!;
      sectorData.symbols.push({
        symbol: row.symbol,
        change_pct: row.change_pct || 0,
        volume: row.volume || 0,
        cap: row.cap || 0
      });
      sectorData.totalCap += row.cap || 0;
      sectorData.count++;
    });

    // Calculate averages
    const results = Array.from(sectors.values()).map(sector => ({
      ...sector,
      avgChange: sector.symbols.reduce((sum, s) => sum + s.change_pct, 0) / sector.count
    }));

    return NextResponse.json({ sectors: results });

  } catch (error) {
    console.error('Heatmap API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
