import { isRelevantNews, normalizeArabicText } from "./news-relevance";
import { ARABIC_STOCK_MAPPINGS } from "./symbol-aliases";
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

/**
 * Detects only a narrow, directly provable error: reversing which company is
 * the buyer/acquirer in an explicitly dated Arabic headline. Entity matching
 * alone is insufficient evidence for a transaction claim. This deliberately
 * avoids inferring relations from snippets, company names not present in the
 * headline, or undated rows.
 *
 * Keep this advisory function separate from the publication gate so callers
 * can decide where it belongs in the existing review flow.
 */
export function newsAcquisitionDirectionViolations(reply: string, results: ToolResult[]): string[] {
    const plainReply = String(reply || "").replace(/<[^>]*>/g, " ");
    const titlesBySymbol = new Map<string, Array<{ title: string; date: string | null }>>();
    const add = (symbolValue: unknown, titleValue: unknown, dateRow: unknown) => {
        const symbol = String(symbolValue || "").toUpperCase().trim();
        const title = typeof titleValue === "string" ? titleValue.trim() : "";
        if (!symbol || !title) return;
        const entries = titlesBySymbol.get(symbol) || [];
        entries.push({ title, date: newsEventDate(dateRow) });
        titlesBySymbol.set(symbol, entries);
    };

    for (const result of results.filter(item => !item.error && ["get_news", "get_corporate_actions", "search_web"].includes(item.tool))) {
        const rows: any[] = result.tool === "get_corporate_actions"
            ? (Array.isArray(result.data?.corporate_actions) ? result.data.corporate_actions : [])
            : result.tool === "get_news"
                ? (Array.isArray(result.data) ? result.data : [])
                : (Array.isArray(result.data?.results) ? result.data.results : []);
        for (const row of rows) {
            const rowSymbols = row?.symbol ? [row.symbol] : Array.isArray(result.symbols) ? result.symbols : [];
            const titles = newsHeadlines(row);
            const dateRow = result.tool === "get_corporate_actions"
                ? { published_at: corporateActionDates(row).published_date }
                : row;
            for (const symbol of rowSymbols) for (const title of titles) add(symbol, title, dateRow);
        }
    }

    const aliasesBySymbol = new Map<string, string[]>();
    for (const [alias, value] of Object.entries(ARABIC_STOCK_MAPPINGS)) {
        const symbols = Array.isArray(value) ? value : [value];
        if (!/[\u0600-\u06FF]/.test(alias) || alias.trim().length < 4) continue;
        for (const symbolValue of symbols) {
            const symbol = String(symbolValue).toUpperCase();
            const aliases = aliasesBySymbol.get(symbol) || [];
            aliases.push(alias);
            aliasesBySymbol.set(symbol, aliases);
        }
    }

    const acquirerDirection = (text: string, alias: string): "buyer" | "target" | null => {
        const normalized = normalizeArabicText(text);
        const normalizedAlias = normalizeArabicText(alias);
        const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const aliasToken = `(?:ال|لل|بال|و|ف|ب|ل)?${escaped}(?=$|[^\\u0621-\\u064A])`;
        const aliasBoundary = `(?:^|[^\\u0621-\\u064A])${aliasToken}`;
        if (!new RegExp(aliasBoundary).test(normalized)) return null;
        if (/(?:^|[^\u0621-\u064A\w])(?:لا|ليس|ليست|لم|لن|مش|مافيش|مفيش|غير)\s*.{0,24}(?:استحواذ|تستحوذ|استحوذت|يستحوذ|تشتري|اشترت|شراء)/i.test(normalized)) return null;
        if (/(?:تم|جرى|يتم)\s+(?:ال)?استحواذ/.test(normalized)) return null;
        // Buyer direction is accepted only for an active verb immediately
        // following the company name, or the explicit noun phrase
        // "استحواذ بلتون على ...". A nearby "تدرس/ترفض عرض استحواذ" is
        // intentionally ambiguous and does not establish the company as buyer.
        const buyer = new RegExp(`${aliasBoundary}\\s+(?:للقابضه\\s+)?(?:تستحوذ|استحوذت|تشتري|اشترت)\\s+(?:علي|من)`).test(normalized)
            || new RegExp(`(?:^|[^\\u0621-\\u064A])استحواذ\\s+(?:(?:شركه|مجموعه|بنك)\\s+)?${aliasToken}\\s+(?:علي|من)`).test(normalized);
        const target = new RegExp(`عرض شراء اجباري من .{1,55}للاستحواذ علي ${aliasToken}`).test(normalized)
            || new RegExp(`(?:شركه|مجموعه|بنك)\\s+.{1,35}(?:تستحوذ|استحوذت|يستحوذ|اشترت)\\s+علي ${aliasToken}`).test(normalized);
        if (buyer === target) return null;
        return buyer ? "buyer" : "target";
    };

    const replyRelations = (text: string, aliases: string[]) => text
        .split(/\n+|(?<=[.!?؟؛;])\s+|،\s*(?=(?:بل|لكن|إنما|انما)(?:\s|$))/)
        .flatMap(segment => {
            if (/^\s*(?:المصدر|المصادر|مصدر الخبر|عنوان الخبر|source)\s*[:：]/i.test(segment)) return [];
            const claim = segment.replace(/(?:المصدر|المصادر|مصدر الخبر|عنوان الخبر|source)\s*[:：].*$/i, "");
            if (/^\s*["'«“]/.test(claim)) return [];
            const directions = aliases.map(alias => acquirerDirection(claim, alias)).filter(Boolean);
            const unique = [...new Set(directions)];
            if (unique.length !== 1) return [];
            const date = claim.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || null;
            return [{ direction: unique[0], date }];
        });

    const reasons: string[] = [];
    for (const [symbol, items] of titlesBySymbol) {
        const aliases = [...new Set(aliasesBySymbol.get(symbol) || [])].sort((a, b) => a.length - b.length);
        if (!aliases.length) continue;
        const evidenceRelations = items.flatMap(item => {
            if (!item.date) return [];
            const relation = aliases.map(alias => acquirerDirection(item.title, alias)).find(Boolean);
            return relation ? [{ relation, date: item.date }] : [];
        });
        const claims = replyRelations(plainReply, aliases);
        for (const claim of claims) {
            const applicableEvidence = evidenceRelations.filter(item => !claim.date || item.date === claim.date);
            const evidenceDirections = new Set(applicableEvidence.map(item => item.relation));
            // Conflicting source directions or dates are ambiguous; do not guess.
            if (evidenceDirections.size !== 1 || new Set(applicableEvidence.map(item => item.date)).size !== 1) continue;
            if (claim.direction !== applicableEvidence[0].relation) {
                reasons.push(`${symbol}: اتجاه الاستحواذ في الرد يعاكس عنوان الخبر المؤرخ؛ تحقّق من هوية المشتري والجهة المستهدفة قبل عرض الحدث.`);
                break;
            }
        }
    }
    return [...new Set(reasons)];
}
