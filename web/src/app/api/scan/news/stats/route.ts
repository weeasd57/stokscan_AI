import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SectorInfo {
  ar: string;
  en: string;
}

const SECTOR_MAP: Record<string, SectorInfo> = {
  "bank": { ar: "بنوك", en: "Banks" },
  "banking": { ar: "بنوك", en: "Banks" },
  "financial": { ar: "خدمات مالية", en: "Financial Services" },
  "finance": { ar: "خدمات مالية", en: "Financial Services" },
  "real estate": { ar: "عقارات وتطوير", en: "Real Estate" },
  "homebuilding": { ar: "عقارات وتطوير", en: "Real Estate" },
  "housing": { ar: "عقارات وتطوير", en: "Real Estate" },
  "construction": { ar: "عقارات وتطوير", en: "Real Estate" },
  "development": { ar: "عقارات وتطوير", en: "Real Estate" },
  "pharma": { ar: "أدوية ورعاية صحية", en: "Healthcare & Pharma" },
  "pharmaceutical": { ar: "أدوية ورعاية صحية", en: "Healthcare & Pharma" },
  "health": { ar: "أدوية ورعاية صحية", en: "Healthcare & Pharma" },
  "food": { ar: "أغذية ومشروبات", en: "Food & Beverages" },
  "beverage": { ar: "أغذية ومشروبات", en: "Food & Beverages" },
  "consumer non-durables": { ar: "أغذية ومشروبات", en: "Food & Beverages" },
  "agriculture": { ar: "زراعة واستصلاح", en: "Agriculture" },
  "agricultural": { ar: "زراعة واستصلاح", en: "Agriculture" },
  "farming": { ar: "زراعة واستصلاح", en: "Agriculture" },
  "reclamation": { ar: "زراعة واستصلاح", en: "Agriculture" },
  "materials": { ar: "مواد أساسية ومقاولات", en: "Basic Materials" },
  "building": { ar: "مواد أساسية ومقاولات", en: "Basic Materials" },
  "cement": { ar: "مواد أساسية ومقاولات", en: "Basic Materials" },
  "steel": { ar: "مواد أساسية ومقاولات", en: "Basic Materials" },
  "mining": { ar: "مواد أساسية ومقاولات", en: "Basic Materials" },
  "telecom": { ar: "اتصالات وتكنولوجيا", en: "Telecom & Tech" },
  "telecommunications": { ar: "اتصالات وتكنولوجيا", en: "Telecom & Tech" },
  "communications": { ar: "اتصالات وتكنولوجيا", en: "Telecom & Tech" },
  "technology": { ar: "اتصالات وتكنولوجيا", en: "Telecom & Tech" },
  "tourism": { ar: "سياحة وترفيه", en: "Tourism & Leisure" },
  "travel": { ar: "سياحة وترفيه", en: "Tourism & Leisure" },
  "hotel": { ar: "سياحة وترفيه", en: "Tourism & Leisure" },
  "energy": { ar: "طاقة وبترول", en: "Energy & Oil" },
  "oil": { ar: "طاقة وبترول", en: "Energy & Oil" },
  "gas": { ar: "طاقة وبترول", en: "Energy & Oil" },
  "petroleum": { ar: "طاقة وبترول", en: "Energy & Oil" }
};

function getNormalizedSector(sectorStr: string): SectorInfo {
  if (!sectorStr) return { ar: "أخرى", en: "Other" };
  const lower = sectorStr.toLowerCase();
  
  for (const [key, value] of Object.entries(SECTOR_MAP)) {
    if (lower.includes(key)) {
      return value;
    }
  }
  
  return { ar: "أخرى", en: "Other" };
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 1. Fetch fundamentals to build symbol -> sector mapping
    const { data: fundRows } = await supabase
      .from("stock_fundamentals")
      .select("symbol, data");

    const symbolToSector: Record<string, SectorInfo> = {};
    if (fundRows) {
      for (const row of fundRows) {
        if (!row.symbol) continue;
        let sectorStr = "Other";
        try {
          const parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data || {};
          sectorStr = parsed.sector || parsed.Sector || parsed.sector_ar || parsed.SectorAr || parsed.industry || parsed.Industry || "Other";
        } catch {}
        symbolToSector[row.symbol.toUpperCase()] = getNormalizedSector(sectorStr);
      }
    }

    // 2. Fetch stock news sentiments from last 30 days or latest 500 rows
    const { data: newsRows, error: newsError } = await supabase
      .from("stock_news_sentiment")
      .select("symbol, sentiment_score, news_count, date")
      .gt("news_count", 0)
      .order("date", { ascending: false })
      .limit(600);

    if (newsError) {
      console.error("Error fetching news sentiments for stats:", newsError);
      return NextResponse.json({ error: "Failed to fetch sentiments" }, { status: 500 });
    }

    // 3. Initialize aggregation structures
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    const sectorAgg: Record<string, { ar: string; en: string; totalScore: number; count: number; newsCount: number }> = {};
    const dateAgg: Record<string, { totalScore: number; count: number; newsCount: number }> = {};

    for (const row of newsRows || []) {
      const symbol = (row.symbol || "").toUpperCase();
      const score = toNumber(row.sentiment_score);
      const count = toNumber(row.news_count) || 1;
      const date = row.date;

      // Overall sentiment breakdown
      if (score > 0.15) {
        positiveCount++;
      } else if (score < -0.15) {
        negativeCount++;
      } else {
        neutralCount++;
      }

      // Sector Aggregation
      const sector = symbolToSector[symbol] || { ar: "أخرى", en: "Other" };
      const sectorKey = sector.en;
      if (!sectorAgg[sectorKey]) {
        sectorAgg[sectorKey] = {
          ar: sector.ar,
          en: sector.en,
          totalScore: 0,
          count: 0,
          newsCount: 0
        };
      }
      sectorAgg[sectorKey].totalScore += score;
      sectorAgg[sectorKey].count += 1;
      sectorAgg[sectorKey].newsCount += count;

      // Timeline/Date Aggregation
      if (date) {
        if (!dateAgg[date]) {
          dateAgg[date] = {
            totalScore: 0,
            count: 0,
            newsCount: 0
          };
        }
        dateAgg[date].totalScore += score;
        dateAgg[date].count += 1;
        dateAgg[date].newsCount += count;
      }
    }

    // 4. Format Sector stats
    const sectorStats = Object.values(sectorAgg).map(s => ({
      nameAr: s.ar,
      nameEn: s.en,
      averageSentiment: s.count > 0 ? Number((s.totalScore / s.count).toFixed(2)) : 0,
      newsCount: s.newsCount,
      stocksCount: s.count
    })).sort((a, b) => b.averageSentiment - a.averageSentiment);

    // 5. Format Timeline stats
    const timelineStats = Object.entries(dateAgg).map(([date, d]) => ({
      date,
      averageSentiment: d.count > 0 ? Number((d.totalScore / d.count).toFixed(2)) : 0,
      newsCount: d.newsCount
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
       .slice(-15); // Show latest 15 active days

    const totalRecords = positiveCount + negativeCount + neutralCount;

    return NextResponse.json({
      summary: {
        positive: positiveCount,
        negative: negativeCount,
        neutral: neutralCount,
        total: totalRecords
      },
      sectors: sectorStats,
      timeline: timelineStats
    });

  } catch (error: any) {
    console.error("Error in news stats route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
