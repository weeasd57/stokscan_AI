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

const UNRELATED_NEWS_KEYWORDS = [
    "زمالك", "أهلي", "كرة", "كره", "مباراة", "دوري", "كأس",
    "كابلات", "مقاولون", "سيارة", "سيارات", "أسمنت", "اسمنت",
    "بترول", "غاز", "بتروكيماويات", "صفحة", "أبراج", "عالم المال"
];

function isRelevantCorporateTitle(title: string, symbol: string, companyName: string): boolean {
    if (!title) return false;
    const t = title.toLowerCase();
    const sym = symbol.toLowerCase();
    const name = (companyName || "").toLowerCase();
    const nameTokens = name.split(/\s+/).filter(token => token.length > 3);
    const hasUnrelated = UNRELATED_NEWS_KEYWORDS.some(k => t.includes(k));
    if (hasUnrelated) return false;
    if (sym.length >= 3 && t.includes(sym)) return true;
    if (nameTokens.some(token => t.includes(token))) return true;
    return false;
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
    symbolsCovered: string[];
}

const LOOKBACK_DAYS = 90;
const NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // don't re-search the same empty symbol for 6h

// Module-level negative cache: symbols that returned no corporate actions
// from either the DB or the web. Survives across requests in the same
// server instance; serverless instances each keep their own — acceptable.
const negativeCache = new Map<string, number>();

function negativeCacheFresh(symbol: string): boolean {
    const ts = negativeCache.get(symbol);
    return ts != null && Date.now() - ts < NEGATIVE_CACHE_TTL_MS;
}

export async function getCorporateActionsForSymbols(
    supabase: any,
    symbols: string[],
    opts: { lookbackDays?: number; enableWebSearch?: boolean } = {}
): Promise<CorporateActionsResult> {
    const lookbackDays = opts.lookbackDays ?? LOOKBACK_DAYS;
    const enableWebSearch = opts.enableWebSearch ?? true;
    const out: CorporateActionsResult = { items: [], fromDatabase: 0, fromWeb: 0, savedToDatabase: 0, symbolsCovered: [] };
    if (!supabase || symbols.length === 0) return out;

    const cleanSymbols = Array.from(new Set(symbols.map(s => String(s).split(".")[0].toUpperCase()).filter(Boolean)));

    // 1) Database first
    let dbItems: CorporateActionItem[] = [];
    try {
        const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString();
        const { data, error } = await supabase
            .from("corporate_actions")
            .select("symbol, exchange, action_type, title, action_date, published_at, url, source, sentiment_score, sentiment_label, confidence, details, origin")
            .in("symbol", cleanSymbols)
            .gte("published_at", cutoff)
            .order("published_at", { ascending: false })
            .limit(60);
        if (!error && Array.isArray(data)) {
            dbItems = (data as CorporateActionItem[]).map(item => ({
                ...item,
                action_type_ar: item.action_type_ar || CA_TYPE_AR[item.action_type] || item.action_type,
            }));
        }
    } catch (e: any) {
        console.warn("[CA] Table query failed (migration applied?):", e?.message || e);
    }

    const covered = new Set(dbItems.map(i => String(i.symbol).toUpperCase()));
    out.items.push(...dbItems);
    out.fromDatabase = dbItems.length;

    // 2) Web search for uncovered symbols (skip when disabled or recently empty)
    const uncovered = cleanSymbols.filter(sym => !covered.has(sym) && !negativeCacheFresh(sym));
    if (enableWebSearch && uncovered.length > 0 && uncovered.length <= 5) {
        // Company names improve recall — many EGX headlines use the Arabic name
        let nameMap = new Map<string, string>();
        try {
            const { data: nameRows } = await supabase.from("stocks").select("symbol, name, name_ar").in("symbol", uncovered);
            (nameRows || []).forEach((r: any) => {
                if (r?.symbol) nameMap.set(String(r.symbol).toUpperCase(), r.name_ar || r.name || r.symbol);
            });
        } catch { /* names are optional */ }

        const webItems: CorporateActionItem[] = [];
        await Promise.all(uncovered.map(async sym => {
            try {
                const displayName = nameMap.get(sym) || sym;
                const query = `أخبار اكتتاب وتوزيعات وتجزئة ${displayName} ${sym} البورصة المصرية`;
                const webResults = await searchWeb(query, 5, 4500);
                for (const result of webResults) {
                    const classification = classifyCorporateAction(`${result.title} ${result.snippet || ""}`);
                    if (!classification) continue;
                    if (!isRelevantCorporateTitle(result.title, sym, displayName)) continue;
                    webItems.push({
                        symbol: sym,
                        exchange: "EGX",
                        action_type: classification.type,
                        action_type_ar: classification.typeAr,
                        title: result.title,
                        action_date: null,
                        published_at: new Date().toISOString(),
                        url: result.url || null,
                        source: result.domain || result.url || null,
                        sentiment_score: null,
                        sentiment_label: null,
                        confidence: classification.confidence,
                        details: classification.details,
                        origin: "chat_cache",
                    });
                }
                if (webItems.filter(i => i.symbol === sym).length === 0) {
                    negativeCache.set(sym, Date.now());
                }
            } catch (e: any) {
                console.warn(`[CA] Web search failed for ${sym}:`, e?.message || e);
            }
        }));

        // 3) Persist web findings back into the database (best effort)
        if (webItems.length > 0) {
            const rows = webItems.map(item => ({
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
                const { error } = await supabase.from("corporate_actions").upsert(rows, { onConflict: "dedupe_key" });
                if (!error) out.savedToDatabase = rows.length;
            } catch (e: any) {
                console.warn("[CA] Upsert failed (migration applied?):", e?.message || e);
            }
        }

        out.items.push(...webItems);
        out.fromWeb = webItems.length;
    }

    // Sort newest first, cap the list
    out.items.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
    if (out.items.length > 20) out.items = out.items.slice(0, 20);
    out.symbolsCovered = Array.from(new Set(out.items.map(i => String(i.symbol).toUpperCase())));

    // Mark symbols with rows (or a fresh negative cache hit) as covered
    for (const sym of cleanSymbols) {
        if (covered.has(sym)) out.symbolsCovered.push(sym);
    }
    out.symbolsCovered = Array.from(new Set(out.symbolsCovered));
    return out;
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by tools-v2 to inject text parts into LIVE DATA)
// ---------------------------------------------------------------------------

export function formatCorporateActionsSummary(ca: CorporateActionsResult): string {
    if (ca.items.length === 0) return "";
    const lines: string[] = [`\n [أحداث مالية مؤثرة للأسهم (اكتتابات/توزيعات/تجزئة/منح) — ${ca.fromDatabase > 0 ? "قاعدة البيانات" : "بحث حي"}]:\n`];
    for (const item of ca.items) {
        const dateStr = item.published_at ? String(item.published_at).slice(0, 10) : "غير محدد";
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
        lines.push(`  (تم جلب ${ca.fromWeb} حدث من البحث الحي وحفظه في قاعدة البيانات للاستخدام القادم)`);
    }
    return lines.join("\n");
}
