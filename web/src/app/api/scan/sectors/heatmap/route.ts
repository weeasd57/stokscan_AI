import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const revalidate = 3600; // ISR: 1 hour (data updated daily)

const SECTOR_AR: Record<string, string> = {
  'finance': 'الخدمات المالية',
  'energy minerals': 'معادن الطاقة',
  'transportation': 'النقل',
  'electronic technology': 'التكنولوجيا الإلكترونية',
  'consumer durables': 'السلع الاستهلاكية المعمرة',
  'non-energy minerals': 'المعادن غير المعدة للطاقة',
  'commercial services': 'الخدمات التجارية',
  'utilities': 'المرافق العامة',
  'consumer services': 'الخدمات الاستهلاكية',
  'miscellaneous': 'متنوع',
  'retail trade': 'تجارة التجزئة',
  'health services': 'الخدمات الصحية',
  'distribution services': 'خدمات التوزيع',
  'industrial services': 'الخدمات الصناعية',
  'consumer non-durables': 'السلع الاستهلاكية غير المعمرة',
  'process industries': 'الصناعات التحويلية',
  'health technology': 'تكنولوجيا الصحة',
  'producer manufacturing': 'التصنيع الإنتاجي',
  'technology services': 'خدمات التكنولوجيا',
  'speculative sector': 'قطاع المضاربة',
  'communications': 'الاتصالات',
  'real estate': 'العقارات',
  'energy': 'الطاقة',
  'industrial': 'الصناعي',
  'commercial': 'التجاري',
  'services': 'الخدمات',
  'other': 'أخرى'
};

const getSentiment = (avgChange: number): string => {
  if (avgChange > 1.5) return 'bullish';
  if (avgChange > 0.3) return 'slightly_bullish';
  if (avgChange < -1.5) return 'bearish';
  if (avgChange < -0.3) return 'slightly_bearish';
  return 'neutral';
};

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const country = incomingUrl.searchParams.get("country") || "Egypt";
  
  try {
    const supabase = getSupabaseClient();
    
    // Get the latest captured_at timestamp for EGX
    const { data: latestRow, error: latestError } = await supabase
      .from('market_heatmap')
      .select('captured_at')
      .eq('exchange', 'EGX')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error('Heatmap latest row Supabase error:', latestError);
      return NextResponse.json({ error: 'Failed to fetch latest heatmap metadata' }, { status: 500 });
    }

    if (!latestRow) {
      return NextResponse.json({ sectors: [] }, {
        headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' }
      });
    }

    const latestTime = latestRow.captured_at;
    
    // Fetch all records for this latest timestamp (explicit columns only)
    const { data: heatmapData, error: dataError } = await supabase
      .from('market_heatmap')
      .select('symbol, sector, change_pct, volume, cap')
      .eq('exchange', 'EGX')
      .eq('captured_at', latestTime);

    if (dataError) {
      console.error('Heatmap data Supabase error:', dataError);
      return NextResponse.json({ error: 'Failed to fetch heatmap data' }, { status: 500 });
    }

    const { data: stocksData } = await supabase
      .from('stocks')
      .select('symbol, name');
    const symbolToName = new Map<string, string>();
    stocksData?.forEach((s: {symbol: string; name: string}) => symbolToName.set(s.symbol, s.name));

    // Group by sector and calculate aggregates
    const sectors = new Map<string, {
      sector: string;
      sector_ar: string;
      money_flow: number;
      change_pct: number;
      stocks_count: number;
      stocks: Array<{
        symbol: string;
        name: string;
        close: number;
        change_pct: number;
        volume: number;
        money_flow: number;
      }>;
    }>();

    let totalMarketCap = 0;

    heatmapData?.forEach((row: any) => {
      const sector = row.sector || 'Other';
      const sectorAr = SECTOR_AR[sector.toLowerCase()] || sector;
      const symbol = row.symbol;
      const name = symbolToName.get(symbol) || symbol;
      const volume = row.volume || 0;
      const cap = row.cap || 0;
      const changePct = row.change_pct || 0;
      const close = volume > 0 ? (cap / volume) : 0;

      if (!sectors.has(sector)) {
        sectors.set(sector, {
          sector,
          sector_ar: sectorAr,
          money_flow: 0,
          change_pct: 0,
          stocks_count: 0,
          stocks: []
        });
      }
      
      const sectorData = sectors.get(sector)!;
      sectorData.stocks.push({
        symbol,
        name,
        close,
        change_pct: changePct,
        volume,
        money_flow: cap
      });
      sectorData.money_flow += cap;
      sectorData.stocks_count++;
      totalMarketCap += cap;
    });

    // Calculate averages and market shares
    const results = Array.from(sectors.values()).map(sector => {
      const avgChange = sector.stocks.reduce((sum, s) => sum + s.change_pct, 0) / sector.stocks_count;
      const marketShare = totalMarketCap > 0 ? (sector.money_flow / totalMarketCap) * 100 : 0;
      return {
        ...sector,
        change_pct: avgChange,
        market_share: Number(marketShare.toFixed(2)),
        sentiment: getSentiment(avgChange)
      };
    });

    return NextResponse.json({ sectors: results }, {
      headers: {
        // Data updates once daily — cache 1 hour on Vercel CDN, serve stale 24h while revalidating
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      }
    });

  } catch (error) {
    console.error('Heatmap API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
