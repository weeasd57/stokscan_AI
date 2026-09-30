import { getSupabaseClient } from "@/lib/supabase/route-data";

export type NewsRow = {
  id: number; symbol: string; exchange: string; date: string;
  sentiment_score: number; news_count: number; headlines: string[]; sources: string[];
};

/** Canonical monthly queries reuse the existing generation-based Vercel cache.
 * Search, sorting, pagination and charts never create new Supabase query keys.
 */
export async function getNewsRows(params: URLSearchParams): Promise<NewsRow[]> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const exact = params.get("date") || "";
  const month = params.get("month") || "";
  if (exact && !/^\d{4}-\d{2}-\d{2}$/.test(exact)) throw new Error("Invalid date");
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  let start = exact || (month ? `${month}-01` : today);
  let end = exact || today;
  if (!exact && month) {
    const [y, m] = month.split("-").map(Number);
    end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  } else if (!exact) {
    const d = new Date(`${today}T00:00:00Z`);
    const period = params.get("period") || "15d";
    if (period === "3m") d.setUTCMonth(d.getUTCMonth() - 3);
    else if (period === "1m") d.setUTCMonth(d.getUTCMonth() - 1);
    else d.setUTCDate(d.getUTCDate() - 30);
    start = d.toISOString().slice(0, 10);
  }
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const rows: NewsRow[] = [];
  const supabase = getSupabaseClient();
  while (cursor.toISOString().slice(0, 10) <= end) {
    const from = cursor.toISOString().slice(0, 10);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const until = cursor.toISOString().slice(0, 10);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("stock_news_sentiment")
        .select("id,symbol,exchange,date,sentiment_score,news_count,headlines,sources")
        .eq("exchange", "EGX").gt("news_count", 0)
        .gte("date", from).lt("date", until)
        .order("date", { ascending: false }).order("id", { ascending: true })
        .range(offset, offset + 499);
      if (error) throw new Error("News data unavailable");
      rows.push(...(data || []));
      if (!data || data.length < 500) break;
    }
  }
  const search = (params.get("search") || "").trim().toUpperCase();
  const sessionDates = !exact && !month && (!params.get("period") || params.get("period") === "15d")
    ? new Set([...new Set(rows.filter(row => row.date >= start && row.date <= end).map(row => row.date))].sort().slice(-15))
    : null;
  return rows.filter(row => row.date >= start && row.date <= end && (!sessionDates || sessionDates.has(row.date)) &&
    (!search || row.symbol.toUpperCase().includes(search)));
}

export function newsLabel(score: number): "positive" | "negative" | "neutral" {
  return score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
}
