import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";
import { getNewsRows, newsLabel } from "@/lib/news-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let symbolToSectorCache: Record<string, { ar: string; en: string }> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const PUBLIC_CACHE_HEADERS = dailyCacheHeaders(DAILY_CACHE_TAGS.news);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 20, 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const sentiment = url.searchParams.get("sentiment") || "all";
    const sector = url.searchParams.get("sector") || "";
 
    const supabase = getSupabaseClient();
    let rows = await getNewsRows(url.searchParams);

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
            for (const [k, val] of Object.entries(SECTOR_MAP_LOCAL).sort(([a], [b]) => b.length - a.length)) {
              if (lower === val.en.toLowerCase() || lower === val.ar || lower.includes(k)) {
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

      const symbolSet = new Set(symbolsInSector);
      rows = rows.filter(row => symbolSet.has(row.symbol.toUpperCase()));
    }
    if (sentiment !== "all") rows = rows.filter(row => newsLabel(Number(row.sentiment_score)) === sentiment);
    const sort = url.searchParams.get("sort") || "newest";
    rows.sort((a, b) => {
      const primary = sort === "highest_sent" ? b.sentiment_score - a.sentiment_score
        : sort === "lowest_sent" ? a.sentiment_score - b.sentiment_score
        : sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      return primary || a.symbol.localeCompare(b.symbol) || a.id - b.id;
    });
    const count = rows.length;
    const data = rows.slice(offset, offset + limit);

    const items = (data || []).map((row: Record<string, unknown>) => {
      const score = toNumber(row.sentiment_score);
      const label = newsLabel(score);
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

    return NextResponse.json(
      { data: items, total: count || 0 },
      { headers: PUBLIC_CACHE_HEADERS },
    );
  } catch (error) {
    console.error("news route error:", error);
    return NextResponse.json(
      { data: [], total: 0 },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
