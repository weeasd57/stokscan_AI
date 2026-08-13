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
  "petroleum": { ar: "طاقة وبترول", en: "Energy & Oil" },
  "process industries": { ar: "صناعات تحويلية", en: "Process Industries" },
  "transportation": { ar: "خدمات النقل والشحن", en: "Transportation" },
  "consumer durables": { ar: "سلع استهلاكية معمرة", en: "Consumer Durables" },
  "distribution services": { ar: "خدمات لوجستية وتوزيع", en: "Distribution & Logistics" },
  "consumer services": { ar: "خدمات المستهلكين", en: "Consumer Services" },
  "non-energy minerals": { ar: "معادن وتعدين", en: "Non-Energy Minerals" },
  "retail trade": { ar: "تجارة التجزئة", en: "Retail Trade" },
  "industrial services": { ar: "خدمات صناعية ومقاولات", en: "Industrial Services" },
  "producer manufacturing": { ar: "التصنيع والإنتاج", en: "Producer Manufacturing" },
  "utilities": { ar: "المرافق والخدمات العامة", en: "Utilities" },
  "commercial services": { ar: "خدمات تجارية وأعمال", en: "Commercial Services" },
  "miscellaneous": { ar: "متنوع", en: "Miscellaneous" },
  "health services": { ar: "رعاية صحية ومستشفيات", en: "Health Services" },
  "technology services": { ar: "خدمات تكنولوجية وبرمجيات", en: "Technology Services" }
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

let symbolToSectorCache: Record<string, SectorInfo> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const dateFilter = url.searchParams.get("date") || "";
    const period = url.searchParams.get("period") || "15d";

    const supabase = getSupabaseClient();

    // 1. Fetch fundamentals to build symbol -> sector mapping (with server-side cache)
    const nowTime = Date.now();
    const symbolToSector: Record<string, SectorInfo> = {};

    if (symbolToSectorCache && (nowTime - lastCacheTime < CACHE_TTL)) {
      Object.assign(symbolToSector, symbolToSectorCache);
    } else {
      const { data: fundRows } = await supabase
        .from("stock_fundamentals")
        .select("symbol, data");

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
        symbolToSectorCache = { ...symbolToSector };
        lastCacheTime = nowTime;
      }
    }

    // Determine query date range and limits based on period
    let startDateStr = "";
    let limit = 600;
    if (period === "1m") {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      startDateStr = d.toISOString().split("T")[0];
      limit = 1200;
    } else if (period === "3m") {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      startDateStr = d.toISOString().split("T")[0];
      limit = 3000;
    } else {
      // 15 days or default
      const d = new Date();
      d.setDate(d.getDate() - 30); // 30 calendar days to guarantee 15 active sessions
      startDateStr = d.toISOString().split("T")[0];
      limit = 600;
    }

    // 2. Fetch stock news sentiments with filters applied
    let query = supabase
      .from("stock_news_sentiment")
      .select("symbol, sentiment_score, news_count, date")
      .gt("news_count", 0)
      .order("date", { ascending: false });

    if (search.trim()) {
      query = query.ilike("symbol", `%${search}%`);
    }
    if (dateFilter) {
      query = query.eq("date", dateFilter);
    } else if (startDateStr) {
      query = query.gte("date", startDateStr);
    }

    const { data: newsRows, error: newsError } = await query.limit(limit);

    if (newsError) {
      console.error("Error fetching news sentiments for stats:", newsError);
      return NextResponse.json({ error: "Failed to fetch sentiments" }, { status: 500 });
    }

    // 3. Initialize aggregation structures
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    const sectorAgg: Record<string, {
      ar: string;
      en: string;
      totalScore: number;
      count: number;
      newsCount: number;
      stocks: Record<string, { totalScore: number; count: number; newsCount: number }>;
    }> = {};
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
          newsCount: 0,
          stocks: {}
        };
      }
      sectorAgg[sectorKey].totalScore += score;
      sectorAgg[sectorKey].count += 1;
      sectorAgg[sectorKey].newsCount += count;

      if (!sectorAgg[sectorKey].stocks[symbol]) {
        sectorAgg[sectorKey].stocks[symbol] = {
          totalScore: 0,
          count: 0,
          newsCount: 0
        };
      }
      sectorAgg[sectorKey].stocks[symbol].totalScore += score;
      sectorAgg[sectorKey].stocks[symbol].count += 1;
      sectorAgg[sectorKey].stocks[symbol].newsCount += count;

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
      stocksCount: s.count,
      stocks: Object.entries(s.stocks).map(([sym, st]) => ({
        symbol: sym,
        averageSentiment: st.count > 0 ? Number((st.totalScore / st.count).toFixed(2)) : 0,
        newsCount: st.newsCount
      })).sort((a, b) => b.averageSentiment - a.averageSentiment)
    })).sort((a, b) => b.averageSentiment - a.averageSentiment);

    // 5. Format Timeline stats
    const sliceCount = period === "3m" ? -90 : period === "1m" ? -30 : -15;
    const timelineStats = Object.entries(dateAgg).map(([date, d]) => ({
      date,
      averageSentiment: d.count > 0 ? Number((d.totalScore / d.count).toFixed(2)) : 0,
      newsCount: d.newsCount
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
       .slice(sliceCount);

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
