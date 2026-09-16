/**
 * Shared news-relevance filtering for the chat tools.
 *
 * This mirrors `api/news_sentiment_engine.py` (is_relevant_news / is_unrelated_news)
 * so the read path never drops a headline the ingestion engine accepted — most
 * importantly Arabic-only headlines that carry the company name but not the
 * Latin ticker ("عامر جروب …" for AMER).
 */

export function normalizeArabicText(text: string): string {
    return String(text ?? "")
        .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
        .replace(/\u0640/g, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** Structural words common to many EGX names — never identifying on their own. */
const GENERIC_NAME_TOKENS = new Set<string>([
    "جروب", "مجموعه", "القابضه", "قابضه", "هولدنج", "هولدينج",
    "مصر", "مصري", "المصري", "مصريه", "المصريه",
    "للاستثمار", "للاستثمارات", "استثمار", "استثمارات", "الاستثمار", "الاستثمارات",
    "للتنميه", "تنميه", "التنميه",
    "القاهره", "قاهره", "الجيزه", "الاسكندريه", "اسكندريه",
    "العربيه", "عربي", "العربي", "الدوليه", "دولي", "الدولي",
    "القوميه", "قومي", "القومي", "العالميه", "العالمي",
    "الوطنيه", "وطنيه", "الوطني", "بنك", "البنك",
    "شمال", "جنوب", "شرق", "غرب", "الشرقيه", "الغربيه",
    "للصناعات", "الصناعيه", "صناعيه", "للتجاره", "تجاريه",
    "الماليه", "ماليه", "الاسلامي", "الاسلاميه",
    "الزراعيه", "زراعيه", "الغذائيه", "غذائيه",
    "العقاريه", "العقاري", "التعمير", "للتعمير",
    "المقاولات", "للمقاولات", "الطبيه", "طبيه", "الادويه",
    "الخدمات", "للخدمات", "الحديد", "الصلب", "والصلب", "الورق",
    "ومخابز", "مطاحن", "دواجن",
    "holding", "holdings", "group", "company", "co", "corp", "inc", "ltd", "plc",
    "sae", "egypt", "egyptian", "bank", "for", "and", "the", "general",
    "investment", "investments", "financial", "industrial", "industries",
    "development", "international", "national", "egx", "stock",
]);

/** Sector words too common on their own ("طاقة" matches "قطر للطاقة"). */
const AMBIGUOUS_SINGLE_TOKENS = new Set<string>([
    "طاقه", "غاز", "بترول", "سياحه", "سياحيه", "زراعه", "زراعي",
    "اسمنت", "حديد", "ادويه", "دواجن", "مطاحن", "فنادق", "منتجعات",
]);

const UNRELATED_NEWS_KEYWORDS = [
    "زمالك", "أهلي", "كرة", "كره", "مباراة", "دوري", "كأس",
    "كابلات", "مقاولون", "سيارة", "سيارات", "عقاري", "عقارات",
    "أسمنت", "اسمنت", "بترول", "غاز", "بتروكيماويات",
    "صفحة", "أبراج", "عالم المال",
];

const SPLIT_RE = /[\s,،|/()\[\]{}\-–—.:;!؟?'"]+/;

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isArabicText(text: string): boolean {
    return /[\u0600-\u06FF]/.test(text);
}

function nameMatchTokens(companyName: string): string[] {
    return Array.from(new Set(
        normalizeArabicText(companyName)
            .split(SPLIT_RE)
            .map(token => token.trim())
            .filter(token => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token) && !AMBIGUOUS_SINGLE_TOKENS.has(token))
    ));
}

/** Arabic token match with the same prefix/suffix tolerance as the backend. */
function hasArabicToken(normTitle: string, token: string): boolean {
    const prefixes = "(?:ال|لل|بال|وال|فال|ب|ل|و|ف)?";
    const suffixes = "(?:اً|ا|ات|ين|ون|ه|ها|هم|هما|هن|نا|ك|كم|كما|كن|ي|يه|ه)?";
    const re = new RegExp(
        `(?:^|[^\\u0621-\\u064A])${prefixes}${escapeRegex(token)}${suffixes}(?:$|[^\\u0621-\\u064A])`
    );
    return re.test(normTitle);
}

export function isUnrelatedNews(title: string): boolean {
    const t = normalizeArabicText(title);
    return UNRELATED_NEWS_KEYWORDS.some(keyword => t.includes(normalizeArabicText(keyword)));
}

/**
 * True when a headline is about the requested symbol/company.
 * Latin ticker as a whole token, full-name phrase (space-insensitive), or a
 * distinctive company-name token.
 */
export function isRelevantNews(title: string, symbol: string, companyName: string): boolean {
    if (!title || !symbol) return false;
    const normTitle = normalizeArabicText(title);
    const sym = String(symbol).split(".")[0].trim().toLowerCase();
    let relevant = false;

    if (sym.length >= 3) {
        relevant = new RegExp(`(^|[^a-z0-9])${escapeRegex(sym)}($|[^a-z0-9])`).test(normTitle);
    }

    if (!relevant) {
        const normName = normalizeArabicText(companyName);
        if (normName) {
            const squashedTitle = normTitle.replace(/ /g, "");
            const words = normName.split(SPLIT_RE).filter(Boolean);
            for (const size of [3, 2, 1]) {
                for (let i = 0; i + size <= words.length; i += 1) {
                    const chunk = words.slice(i, i + size);
                    if (chunk.every(word => GENERIC_NAME_TOKENS.has(word))) continue;
                    const phrase = chunk.join("");
                    if (phrase.length < 6) continue;
                    // Latin phrases need word boundaries ("arabia" must not match
                    // the domain "cnbcarabia.com"); Arabic phrases use the
                    // squashed compare because spacing/prefixes vary.
                    if (/^[a-z0-9]+$/.test(phrase)) {
                        if (new RegExp(`\\b${escapeRegex(phrase)}\\b`).test(normTitle)) {
                            relevant = true;
                            break;
                        }
                    } else if (squashedTitle.includes(phrase)) {
                        relevant = true;
                        break;
                    }
                }
                if (relevant) break;
            }
            if (!relevant) {
                relevant = nameMatchTokens(companyName).some(token => (
                    isArabicText(token) ? hasArabicToken(normTitle, token) : new RegExp(`\\b${escapeRegex(token)}\\b`).test(normTitle)
                ));
            }
        }
    }

    if (!relevant) return false;
    return !isUnrelatedNews(title);
}
