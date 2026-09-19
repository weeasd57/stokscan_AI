// Corporate Actions module — free & smart on-demand caching for the chatbot.
//
// Flow (per asked-about symbol):
//   1. Check the Supabase `corporate_actions` table first (fast, free).
//   2. If the symbol has no recent coverage, run a keyless web search
//      (DuckDuckGo / Google News RSS via searchWeb), classify the results
//      with the same bilingual rule-based classifier used by the Python
//      scheduler, show them with their sources, AND upsert them back into
//      `corporate_actions` (origin = 'chat_cache') so future questions hit
//      the database directly — the DB grows organically around the stocks
//      users actually ask about.
//
// The table is written by the service role only; if it does not exist yet
// (migration pending) every DB call fails silently and web results are
// still returned unsaved.

import { searchWeb } from "./web-search";
import { getExecutionSignal } from "./execution";

// ---------------------------------------------------------------------------
// Taxonomy + bilingual patterns (mirrors api/corporate_actions_engine.py;
// order matters: first match wins)
// ---------------------------------------------------------------------------

interface CorporateActionPattern {
    type: string;
    typeAr: string;
    patterns: RegExp[];
    confidence: number;
}

const CA_PATTERNS: CorporateActionPattern[] = [
    {
        type: "rights_issue",
        typeAr: "حقوق اكتتاب",
        patterns: [/حقوق?\s*اكتتاب/i, /اكتتاب\s*(?:في|فى)?\s*حق/i, /حق\s*الاولوي[هة]/i, /\brights?\s+(?:issue|offering|subscription)\b/i, /\bsubscription\s+rights\b/i],
        confidence: 0.9,
    },
    {
        type: "dividend",
        typeAr: "توزيعات أرباح",
        patterns: [/توزيعات/i, /توزيع\s*ارباح/i, /كوبون/i, /توزيع\s*نقدي/i, /\bdividend/i, /cash\s+distribution/i],
        confidence: 0.85,
    },
    {
        type: "bonus_shares",
        typeAr: "أسهم مجانية (منحة)",
        patterns: [/اسهم?\s*مجاني[هة]?/i, /منح[هة]?\s*(?:اسهم|حصص|سهم)/i, /حصص\s*مجاني[هة]?/i, /\bbonus\s+shares?\b/i, /\bfree\s+shares?\b/i, /\bstock\s+dividend\b/i],
        confidence: 0.85,
    },
    {
        type: "stock_split",
        typeAr: "تجزئة السهم",
        patterns: [/تجزئ[ةه]?\s*(?:ال)?سهم/i, /سهم.{0,12}تجزئ/i, /تجزئ[ةه]?.{0,12}الاسمي[هة]/i, /تقسيم\s*(?:ال)?سهم/i, /\bstock\s+split\b/i, /\bshare\s+split\b/i],
        confidence: 0.85,
    },
    {
        type: "par_value_reduction",
        typeAr: "تخفيض القيمة الاسمية",
        patterns: [/تخفيض.{0,12}الاسمي[هة]/i, /الاسمي[هة].{0,12}تخفيض/i, /\bpar\s+value\s+reduction\b/i],
        confidence: 0.8,
    },
    {
        type: "capital_increase",
        typeAr: "زيادة رأس المال",
        patterns: [/زياد[هة].{0,6}راس.{0,6}المال/i, /زياد[هة].{0,20}(?:المصدر|المدفوع)/i, /رفع.{0,15}ر[أا]س.{0,6}المال/i, /\bcapital\s+increase\b/i, /rais\w*\s+capital\b/i, /\bshare\s+issue\b/i],
        confidence: 0.8,
    },
    {
        type: "capital_reduction",
        typeAr: "تخفيض رأس المال",
        patterns: [/تخفيض.{0,6}راس.{0,6}المال/i, /تخفيض.{0,20}(?:المصدر|غير\s*المدفوع)/i, /\bcapital\s+reduction\b/i, /reduc\w*\s+capital\b/i],
        confidence: 0.8,
    },
    {
        type: "buyback",
        typeAr: "إعادة شراء الأسهم",
        patterns: [/اعاده\s*شراء/i, /برنامج\s*استرداد/i, /استرداد\s*اسهم/i, /\bbuy-?back\b/i, /\brepurchas/i, /\btreasury\s+shares?\b/i],
        confidence: 0.8,
    },
    {
        type: "merger_acquisition",
        typeAr: "استحواذ / اندماج",
        patterns: [/استحواذ/i, /اندماج/i, /صفق[هة]\s*(?:شراء|استحواذ|دمج)/i, /\bacquisition\b/i, /\bmerger\b/i, /\bacquir\w*\b/i],
        confidence: 0.75,
    },
    {
        type: "earnings",
        typeAr: "نتائج أعمال",
        patterns: [/نتائج\s*(?:الاعمال|الربع|اعمال|النصف)/i, /ارباح.{0,15}(?:الربع|النصف|العام|السنه)/i, /بيانات?\s*مالي[هة]/i, /قوائم?\s*مالي[هة]/i, /\bearnings\b/i, /\bquarterly\s+results?\b/i],
        confidence: 0.6,
    },
];

export const CORPORATE_ACTIONS_QUERY_PATTERN = /اكتتاب|توزيع(?:ات)?|توزيعات|كوبون|تجزئ|تقسيم\s*(?:ال)?سهم|منح[هة]|سهم\s*مجاني|زياد[هة]\s*(?:راس|رأس)\s*القيمة|تخفيض\s*(?:راس|رأس|القيمه|القيمة)|اعاده\s*شراء|استحواذ|اندماج|dividend|rights?\s+issue|stock\s+split|bonus\s+shares|buy-?back/i;

// action_type_ar is computed at classification time and not stored in the
// table — map it back for rows read from the database.
const CA_TYPE_AR: Record<string, string> = {
    rights_issue: "حقوق اكتتاب",
    dividend: "توزيعات أرباح",
    bonus_shares: "أسهم مجانية (منحة)",
    stock_split: "تجزئة السهم",
    par_value_reduction: "تخفيض القيمة الاسمية",
    capital_increase: "زيادة رأس المال",
    capital_reduction: "تخفيض رأس المال",
    buyback: "إعادة شراء الأسهم",
    merger_acquisition: "استحواذ / اندماج",
    earnings: "نتائج أعمال",
};

function normalizeArabicText(text: string): string {
    return (text || "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/\u0640/g, "")
        .toLowerCase();
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface CorporateActionClassification {
    type: string;
    typeAr: string;
    confidence: number;
    details: Record<string, number | string> | null;
}

export function classifyCorporateAction(title: string): CorporateActionClassification | null {
    if (!title) return null;
    const normalized = normalizeArabicText(title);
    for (const entry of CA_PATTERNS) {
        // A stock dividend is a bonus-share event, not a cash distribution.
        if (entry.type === "dividend" && /stock\s+dividend|اسهم?\s*مجاني|منح[هة]?\s*(?:اسهم|سهم)/i.test(normalized)) continue;
        const matched = entry.patterns.some(p => p.test(normalized) || p.test(title));
        if (!matched) continue;
        const details = extractCorporateActionDetails(title);
        return {
            type: entry.type,
            typeAr: entry.typeAr,
            confidence: Math.min(1, entry.confidence + (details ? 0.1 : 0)),
            details,
        };
    }
    return null;
}

function isCredibleStoredCorporateAction(item: CorporateActionItem): boolean {
    const title = String(item.title || "").trim();
    if (!title) return false;
    // Search result directory/quote pages are not issuer events. Older chat
    // cache rows can contain them because a snippet (not the title) matched a
    // dividend keyword.
    if (/سعر\s+سهم.+(?:اليوم|البورص[هة])|(?:توزيعات|dividends?).+(?:investing|tradingview)/i.test(title)) {
        return false;
    }
    const titleClassification = classifyCorporateAction(title);
    if (!titleClassification) return false;
    return titleClassification.type === item.action_type;
}

function extractCorporateActionDetails(title: string): Record<string, number | string> | null {
    const normalized = normalizeArabicText(title);
    const details: Record<string, number | string> = {};
    const pct = title.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) details.percentage = parseFloat(pct[1]);
    // JS \b is ASCII-only (Arabic letters are non-word chars), so use
    // lookarounds instead of \b around Arabic currency words.
    const amount = normalized.match(/(\d+(?:\.\d+)?)\s*(?:جنيه|ج\.?م\.?|le|egp)(?![a-zء-ي])/);
    if (amount) details.amount_egp = parseFloat(amount[1]);
    const perShare = normalized.match(/(\d+(?:\.\d+)?)\s*(?:جنيه|ج\.?م\.?|le|egp)\s*(?:لكل|لـ|ا?ل?|لل)?\s*سهم/);
    if (perShare) details.amount_per_share_egp = parseFloat(perShare[1]);
    const ratio = normalized.match(/لكل\s*(?:سهم|اسهم)\s*(\d+(?:\.\d+)?\s*(?:سهم|اسهم))/);
    if (ratio) details.ratio_per_share = ratio[1];
    return Object.keys(details).length > 0 ? details : null;
}

// ---------------------------------------------------------------------------
// Relevance (symbol / company name must appear — same rules as news tools)
// ---------------------------------------------------------------------------

const COMPANY_GENERIC_WORDS = new Set([
    "شركه", "الشركه", "مساهمه", "المساهمه", "المصريه", "مصر", "للاستثمار", "القابضه",
    "company", "co", "sae", "egypt", "egyptian", "investment", "holding", "holdings", "bank", "البنك",
]);

function isRelevantCorporateTitle(title: string, symbol: string, companyName: string): boolean {
    if (!title) return false;
    const words = (value: string) => normalizeArabicText(value).match(/[\p{L}\p{N}]+/gu) || [];
    const titleWords = new Set(words(title));
    if (titleWords.has(symbol.toLowerCase())) return true;
    // Sector words such as "أسمنت" and "غاز" are legitimate company names.
    // Require a company identity match rather than rejecting whole industries
    // or accepting one generic word shared by unrelated issuers.
    const nameTokens = Array.from(new Set(words(companyName).filter(token => token.length > 2 && !COMPANY_GENERIC_WORDS.has(token))));
    if (nameTokens.length === 0) return false;
    return nameTokens.filter(token => titleWords.has(token)).length >= Math.min(2, nameTokens.length);
}

// ---------------------------------------------------------------------------
// Dedupe key (must match api/corporate_actions_engine.py)
// ---------------------------------------------------------------------------

function makeDedupeKey(exchange: string, symbol: string, actionType: string, url: string, title: string): string {
    let identity: string;
    if (url) {
        identity = url.trim().toLowerCase();
    } else {
        let hash = 0;
        const normalized = normalizeArabicText(title);
        for (let i = 0; i < normalized.length; i++) {
            hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
        }
        identity = `t${Math.abs(hash).toString(36)}`;
    }
    return `${exchange}|${symbol}|${actionType}|${identity}`;
}

// ---------------------------------------------------------------------------
// Public API used by the chat pipeline
// ---------------------------------------------------------------------------

export interface CorporateActionItem {
    symbol: string;
    exchange: string;
    action_type: string;
    action_type_ar: string;
    title: string;
    action_date: string | null;
    published_at: string | null;
    updated_at?: string | null;
    url: string | null;
    source: string | null;
    sentiment_score: number | null;
    sentiment_label: string | null;
    confidence: number;
    details: Record<string, any> | null;
    origin: string;
}

export interface CorporateActionsResult {
    items: CorporateActionItem[];
    fromDatabase: number;
    fromWeb: number;
    savedToDatabase: number;
    fromCache?: number;
    symbolsCovered: string[];
    failedSymbols?: string[];
}

const LOOKBACK_DAYS = 90;
const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Lookup freshness is independent of publication/action/update dates. Keep
// successful AND empty searches, including findings that could not be saved.
// Per-instance only: no table/schema changes or synthetic news marker rows.
const searchCache = new Map<string, { searchedAt: number; items: CorporateActionItem[] }>();

function readSearchCache(key: string) {
    const entry = searchCache.get(key);
    if (entry && Date.now() - entry.searchedAt < SEARCH_CACHE_TTL_MS) return entry;
    searchCache.delete(key);
    return undefined;
}

function cacheSearch(key: string, items: CorporateActionItem[]) {
    for (const existingKey of searchCache.keys()) readSearchCache(existingKey);
    searchCache.delete(key);
    if (searchCache.size >= 500) searchCache.delete(searchCache.keys().next().value!);
    searchCache.set(key, { searchedAt: Date.now(), items });
}

function throwIfCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

// Pass cancellation into Supabase and also stop awaiting a non-cooperative
// transport. Always remove listeners, including after normal completion.
async function queryWithSignal(query: any, signal?: AbortSignal): Promise<any> {
    throwIfCancelled(signal);
    if (!signal) return await query;
    const request = typeof query.abortSignal === "function" ? query.abortSignal(signal) : query;
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        return await Promise.race([request, cancelled]);
    } finally {
        signal.removeEventListener("abort", onAbort);
    }
}

function sourceIdentity(url: string | null): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (/^utm_|^(fbclid|gclid)$/i.test(key)) parsed.searchParams.delete(key);
        }
        parsed.searchParams.sort();
        return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
    } catch { return url.trim(); }
}

type Finding = { item: CorporateActionItem; via: "database" | "web" | "cache" };

function dedupeFindings(findings: Finding[]): Finding[] {
    const urls = new Set<string>();
    const titles = new Set<string>();
    return findings.filter(({ item }) => {
        const prefix = `${item.exchange}|${item.symbol.toUpperCase()}|${item.action_type}|`;
        const url = sourceIdentity(item.url);
        const title = normalizeArabicText(item.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        const duplicate = (!!url && urls.has(prefix + url)) || (!!title && titles.has(prefix + title));
        if (url) urls.add(prefix + url);
        if (title) titles.add(prefix + title);
        return !duplicate;
    });
}

export async function getCorporateActionsForSymbols(
    supabase: any,
    symbols: string[],
    opts: { lookbackDays?: number; enableWebSearch?: boolean; signal?: AbortSignal } = {}
): Promise<CorporateActionsResult> {
    const lookbackDays = opts.lookbackDays ?? LOOKBACK_DAYS;
    const enableWebSearch = opts.enableWebSearch ?? true;
    const signal = opts.signal ?? getExecutionSignal();
    throwIfCancelled(signal);
    const out: CorporateActionsResult = { items: [], fromDatabase: 0, fromWeb: 0, savedToDatabase: 0, symbolsCovered: [] };
    if (!supabase || symbols.length === 0) return out;

    const cleanSymbols = Array.from(new Set(symbols.map(s => String(s).split(".")[0].toUpperCase()).filter(Boolean)));
    const cutoffMs = Date.now() - lookbackDays * 86400000;
    const withinWindow = (item: CorporateActionItem) => {
        const published = Date.parse(item.published_at || "");
        const action = Date.parse(item.action_date || "");
        return (!Number.isFinite(published) && !Number.isFinite(action))
            || (Number.isFinite(published) && published >= cutoffMs)
            || (Number.isFinite(action) && action >= cutoffMs);
    };
    const failedSymbols = new Set<string>();

    // 1) Database first
    let dbItems: CorporateActionItem[] = [];
    try {
        const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString();
        const cutoffDate = cutoff.slice(0, 10);
        const { data, error } = await queryWithSignal(supabase
            .from("corporate_actions")
            .select("symbol, exchange, action_type, title, action_date, published_at, updated_at, url, source, sentiment_score, sentiment_label, confidence, details, origin")
            .in("symbol", cleanSymbols)
            .or(`published_at.gte.${cutoff},action_date.gte.${cutoffDate},updated_at.gte.${cutoff}`)
            .order("published_at", { ascending: false })
            .limit(60), signal);
        if (error) {
            cleanSymbols.forEach(sym => failedSymbols.add(sym));
            console.warn("[CA] Table query failed:", error.message || error);
        }
        if (!error && Array.isArray(data)) {
            dbItems = (data as CorporateActionItem[])
                .map(item => ({
                    ...item,
                    // Legacy chat rows may have a discovery timestamp masquerading
                    // as publication time; the explicit unknown flag wins.
                    published_at: item.details?.published_at_unknown === true ? null : item.published_at,
                    action_type_ar: item.action_type_ar || CA_TYPE_AR[item.action_type] || item.action_type,
                }))
                .filter(isCredibleStoredCorporateAction);
        }
    } catch (e: any) {
        throwIfCancelled(signal);
        cleanSymbols.forEach(sym => failedSymbols.add(sym));
        console.warn("[CA] Table query failed (migration applied?):", e?.message || e);
    }

    throwIfCancelled(signal);
    const findings: Finding[] = dbItems.filter(withinWindow).map(item => ({ item, via: "database" }));
    const cacheKey = (sym: string) => `EGX|${sym}|${lookbackDays}`;
    const uncovered = cleanSymbols.filter(sym => {
        if (!enableWebSearch) return false;
        const cached = readSearchCache(cacheKey(sym));
        if (!cached) return true;
        findings.push(...cached.items.filter(withinWindow).map(item => ({ item, via: "cache" as const })));
        return false;
    }).slice(0, 5);

    // 2) Search only symbols without a fresh lookup, regardless of DB news age.
    if (uncovered.length > 0) {
        // Company names improve recall — many EGX headlines use the Arabic name
        let nameMap = new Map<string, string>();
        try {
            const { data: nameRows } = await queryWithSignal(supabase.from("stocks").select("symbol, name, name_ar").in("symbol", uncovered), signal);
            (nameRows || []).forEach((r: any) => {
                if (r?.symbol) nameMap.set(String(r.symbol).toUpperCase(), r.name_ar || r.name || r.symbol);
            });
        } catch { throwIfCancelled(signal); /* names are optional */ }

        const webItems: CorporateActionItem[] = [];
        await Promise.all(uncovered.map(async sym => {
            try {
                const displayName = nameMap.get(sym) || sym;
                const query = `أخبار اكتتاب وتوزيعات وتجزئة ${displayName} ${sym} البورصة المصرية`;
                throwIfCancelled(signal);
                const webResults = await searchWeb(query, 5, 4500, signal);
                throwIfCancelled(signal);
                const symbolItems: CorporateActionItem[] = [];
                for (const result of webResults) {
                    // The visible headline itself must contain the corporate
                    // action. Matching only a search snippet created false
                    // dividend rows from generic quote and directory pages.
                    const classification = classifyCorporateAction(result.title);
                    if (!classification) continue;
                    if (!isRelevantCorporateTitle(result.title, sym, displayName)) continue;
                    const published = Date.parse(result.published_at || "");
                    const publishedAt = Number.isFinite(published) ? new Date(published).toISOString() : null;
                    if (Number.isFinite(published) && published < cutoffMs) continue;
                    symbolItems.push({
                        symbol: sym,
                        exchange: "EGX",
                        action_type: classification.type,
                        action_type_ar: classification.typeAr,
                        title: result.title,
                        action_date: null,
                        published_at: publishedAt,
                        url: result.url || null,
                        source: result.domain || result.url || null,
                        sentiment_score: null,
                        sentiment_label: null,
                        confidence: classification.confidence,
                        details: {
                            ...(classification.details || {}),
                            discovered_at: new Date().toISOString(),
                            published_at_unknown: publishedAt === null,
                            verification_status: "unverified_search_result",
                        },
                        origin: "chat_cache",
                    });
                }
                const unique = dedupeFindings(symbolItems.map(item => ({ item, via: "web" }))).map(f => f.item);
                // An empty result is cacheable only when the provider call
                // completed successfully. Network/provider failures jump to
                // the catch block and never create a negative cache entry.
                cacheSearch(cacheKey(sym), unique);
                webItems.push(...unique);
            } catch (e: any) {
                throwIfCancelled(signal);
                failedSymbols.add(sym);
                console.warn(`[CA] Web search failed for ${sym}:`, e?.message || e);
            }
        }));

        // 3) Persist web findings back into the database (best effort)
        throwIfCancelled(signal);
        findings.push(...webItems.map(item => ({ item, via: "web" as const })));
        // Do not overwrite an existing DB article with a less complete web
        // result, or submit duplicate conflict keys in the same upsert batch.
        const newItems = dedupeFindings(findings).filter(f => f.via === "web").map(f => f.item);
        if (newItems.length > 0) {
            const rows = newItems.map(item => ({
                symbol: item.symbol,
                exchange: item.exchange,
                action_type: item.action_type,
                title: item.title,
                action_date: item.action_date,
                published_at: item.published_at,
                url: item.url,
                source: item.source,
                sentiment_score: item.sentiment_score,
                sentiment_label: item.sentiment_label,
                details: item.details,
                confidence: item.confidence,
                origin: "chat_cache",
                dedupe_key: makeDedupeKey(item.exchange, item.symbol, item.action_type, item.url || "", item.title),
                updated_at: new Date().toISOString(),
            }));
            try {
                const { error } = await queryWithSignal(supabase.from("corporate_actions").upsert(rows, { onConflict: "dedupe_key" }), signal);
                if (!error) out.savedToDatabase = rows.length;
                else console.warn("[CA] Upsert failed:", error.message || error);
            } catch (e: any) {
                throwIfCancelled(signal);
                console.warn("[CA] Upsert failed (migration applied?):", e?.message || e);
            }
        }
    }

    throwIfCancelled(signal);
    // Combine and dedupe before sorting/capping or computing source counts.
    const unique = dedupeFindings(findings)
        .sort((a, b) => String(b.item.published_at || "").localeCompare(String(a.item.published_at || "")))
        .slice(0, 20);
    out.items = unique.map(f => f.item);
    out.fromDatabase = unique.filter(f => f.via === "database").length;
    out.fromWeb = unique.filter(f => f.via === "web").length;
    out.fromCache = unique.filter(f => f.via === "cache").length;
    out.symbolsCovered = Array.from(new Set(out.items.map(i => String(i.symbol).toUpperCase())));
    out.failedSymbols = Array.from(failedSymbols);

    return out;
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by tools-v2 to inject text parts into LIVE DATA)
// ---------------------------------------------------------------------------

export function formatCorporateActionsSummary(ca: CorporateActionsResult): string {
    if (ca.items.length === 0) return "";
    const lines: string[] = [`\n [أحداث مالية مؤثرة للأسهم (اكتتابات/توزيعات/تجزئة/منح) — ${ca.fromDatabase > 0 ? "قاعدة البيانات" : ca.fromWeb > 0 ? "بحث حي" : "نتائج بحث مخزنة مؤقتاً"}]:\n`];
    if (ca.items.some(item => item.origin === "chat_cache")) {
        lines.push("نتائج البحث قرائن للاكتشاف وليست تأكيداً لاعتماد الحدث أو تنفيذه؛ لا تستنتج موعد استحقاق أو نسبة تعديل سعر دون إفصاح موثق.");
    }
    for (const item of ca.items) {
        const dateStr = item.details?.published_at_unknown
            ? "غير محدد (وقت الاكتشاف محفوظ للتتبع فقط)"
            : item.published_at
                ? String(item.published_at).slice(0, 10)
                : "غير محدد";
        const sourceStr = item.source ? ` (المصدر: ${item.source})` : "";
        lines.push(`  • ${item.symbol} — ${item.action_type_ar}: ${item.title}${sourceStr} [تاريخ النشر: ${dateStr}]`);
        if (item.details) {
            const detailStr = Object.entries(item.details)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
            if (detailStr) lines.push(`    تفاصيل مستخرجة: ${detailStr}`);
        }
    }
    if (ca.fromWeb > 0) {
        lines.push(`  (تم جلب ${ca.fromWeb} حدث من البحث الحي)`);
    }
    if (ca.savedToDatabase > 0) lines.push(`  (تم حفظ ${ca.savedToDatabase} حدث في قاعدة البيانات للاستخدام القادم)`);
    return lines.join("\n");
}
