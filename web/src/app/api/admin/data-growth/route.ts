import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Number(url.searchParams.get("days") || 14), 90);
    
    const supabase = getSupabaseClient();
    
    // Calculate data growth for the last N days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get daily counts from multiple tables
    const tables = [
      'stock_prices',
      'stock_technical_indicators', 
      'scan_results',
      'stock_news_sentiment',
      'market_heatmap',
      'daily_job_runs'
    ];
    
    const results = await Promise.all(
      tables.map(async (tableName) => {
        try {
          // Get total count
          const { count: totalCount } = await supabase
            .from(tableName)
            .select("*", { count: "exact", head: true });
          
          // Get recent count (last N days)
          let dateField = 'created_at';
          if (tableName === 'stock_prices') dateField = 'date';
          else if (tableName === 'stock_news_sentiment') dateField = 'date';
          else if (tableName === 'stock_technical_indicators') dateField = 'updated_at';
          else if (tableName === 'market_heatmap') dateField = 'captured_at';
          
          const { count: recentCount } = await supabase
            .from(tableName)
            .select("*", { count: "exact", head: true })
            .gte(dateField, startDate.toISOString().split('T')[0]);
          
          return {
            table: tableName,
            total_records: totalCount || 0,
            recent_records: recentCount || 0,
            growth_rate: totalCount ? ((recentCount || 0) / totalCount * 100).toFixed(2) + '%' : '0%'
          };
        } catch (error) {
          console.error(`Error fetching data for ${tableName}:`, error);
          return {
            table: tableName,
            total_records: 0,
            recent_records: 0,
            growth_rate: '0%'
          };
        }
      })
    );
    
    // Calculate total growth metrics
    const totalRecords = results.reduce((sum, r) => sum + r.total_records, 0);
    const totalRecent = results.reduce((sum, r) => sum + r.recent_records, 0);
    
    return NextResponse.json({
      period_days: days,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      total_records: totalRecords,
      recent_records: totalRecent,
      overall_growth_rate: totalRecords ? ((totalRecent / totalRecords) * 100).toFixed(2) + '%' : '0%',
      tables: results
    });
    
  } catch (error) {
    console.error('Data growth API error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch data growth metrics',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}