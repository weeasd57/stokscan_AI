import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let symbolToSectorCache: Record<string, { ar: string; en: string }> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    const search = url.searchParams.get("search") || "";
    const sentiment = url.searchParams.get("sentiment") || "all";
    const dateFilter = url.searchParams.get("date") || "";
    const sector = url.searchParams.get("sector") || "";
 
    const supabase = getSupabaseClient();
    // stock_news_sentiment columns: id, symbol, exchange, date, sentiment_score,
    // news_count, negative_flag, positive_flag, headlines (jsonb), sources (jsonb), created_at
    let query = supabase
      .from("stock_news_sentiment")
      .select("*", { count: "exact" })
      .order("date", { ascending: false });

    // Filter by sector
    if (sector) {
      const nowTime = Date.now();
      const symbolToSector: Record<string, { ar: string; en: string }> = {};

      if (symbolToSectorCache && (nowTime - lastCacheTime < CACHE_TTL)) {
        Object.assign(symbolToSector, symbolToSectorCache);
      } else {
        const { data: fundRows } = await supabase
          .from("stock_fundamentals")
          .select("symbol, data");

        if (fundRows) {
          const SECTOR_MAP_LOCAL: Record<string, { ar: string; en: string }> = {
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
          for (const row of fundRows) {
            if (!row.symbol) continue;
            let sectorStr = "Other";
            try {
              const parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data || {};
              sectorStr = parsed.sector || parsed.Sector || parsed.sector_ar || parsed.SectorAr || parsed.industry || parsed.Industry || "Other";
            } catch {}
            let matchedEn = "Other";
            let matchedAr = "أخرى";
            const lower = sectorStr.toLowerCase();
            for (const [k, val] of Object.entries(SECTOR_MAP_LOCAL)) {
              if (lower.includes(k)) {
                matchedEn = val.en;
                matchedAr = val.ar;
                break;
              }
            }
            symbolToSector[row.symbol.toUpperCase()] = { ar: matchedAr, en: matchedEn };
          }
          symbolToSectorCache = { ...symbolToSector };
          lastCacheTime = nowTime;
        }
      }

      const symbolsInSector: string[] = [];
      for (const [sym, val] of Object.entries(symbolToSector)) {
        if (val.en === sector || val.ar === sector) {
          symbolsInSector.push(sym);
        }
      }

      if (symbolsInSector.length > 0) {
        query = query.in("symbol", symbolsInSector);
      } else {
        query = query.eq("symbol", "NON_EXISTENT_SYMBOL");
      }
    }

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
