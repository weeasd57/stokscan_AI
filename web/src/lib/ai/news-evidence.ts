import { isRelevantNews } from "./news-relevance";
import type { ToolResult } from "./types";

export function isTodayNewsRequest(message: string): boolean {
    return /اخبار|أخبار|خبر|عناوين|news/i.test(message)
        && /اليوم|النهارده|النهاردة|today/i.test(message);
}

export function corporateActionDates(row: any) {
    return {
        published_date: newsEventDate({ published_at: row?.published_at || row?.publication_date }),
        action_date: newsEventDate({ date: row?.action_date || row?.event_date || row?.date }),
    };
}

/** Corporate execution dates are not publication dates. This view works even
 * when a planner selected only corporate actions for an explicit news query. */
export function summarizeToolNewsEvidence(results: ToolResult[]) {
    const rows = results.filter(result => !result.error).flatMap(result => {
        if (result.tool === "get_corporate_actions") {
            const actions = Array.isArray(result.data?.corporate_actions) ? result.data.corporate_actions : [];
            return actions.map((action: any) => ({ ...action, date: null, published_at: corporateActionDates(action).published_date }));
        }
        if (result.tool === "get_news") return Array.isArray(result.data) ? result.data : [];
        if (result.tool === "search_web") return Array.isArray(result.data?.results) ? result.data.results : [];
        return [];
    });
    return summarizeNewsEvidence(rows);
}

/** Only publication/event dates count as news freshness, never retrieval time. */
export function newsEventDate(row: any): string | null {
    const value = row?.published_at || row?.publication_date || row?.date;
    if (typeof value !== "string" || !value.trim()) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parsed = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
    }
    // Datetimes without a timezone are not reliable publication evidence.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

export function newsHeadlines(row: any): string[] {
    const headlines = Array.isArray(row?.headlines) ? row.headlines : [row?.title || row?.headline];
    return [...new Set<string>(headlines.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0).map((value: string) => value.trim()))];
}

/** Aggregated sentiment cannot survive a change in its supporting articles. */
export function sanitizeNewsRows(rows: any[], companyNames: Map<string, string>): any[] {
    return rows.flatMap(row => {
        const symbol = String(row.symbol || "").toUpperCase();
        const original = newsHeadlines(row);
        const headlines = original.filter(title => isRelevantNews(title, symbol, companyNames.get(symbol) || ""));
        if (!headlines.length) return [];
        const sourceCount = Number(row.news_count);
        const sentimentSupported = headlines.length === original.length && sourceCount === headlines.length;
        return [{ ...row, headlines, news_count: headlines.length,
            sentiment_score: sentimentSupported ? row.sentiment_score ?? null : null,
            sentiment_status: sentimentSupported && row.sentiment_score != null ? "supported" : "unavailable",
            event_date: newsEventDate(row), record_type: "news_headlines" }];
    });
}

export function summarizeNewsEvidence(data: unknown, today = newsEventDate({ published_at: new Date().toISOString() })!) {
    const rows: any[] = Array.isArray(data) ? data : [];
    const articles = rows.flatMap(row => newsHeadlines(row).map(title => ({ title, symbol: row.symbol || null, event_date: newsEventDate(row) })));
    const todayArticles = articles.filter(article => article.event_date === today);
    const dated = articles.map(article => article.event_date).filter((date): date is string => Boolean(date));
    return { today, headline_count: articles.length, today_count: todayArticles.length,
        latest_event_date: dated.length ? dated.sort().at(-1)! : null,
        today_status: todayArticles.length ? "covered" as const : "no_verified_news" as const,
        articles, today_articles: todayArticles };
}
