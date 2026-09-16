"""
News Sentiment Engine — Python Standard Library & Rule-Based Financial NLP.
Fetches EGX stock news from Google News (Arabic & English) and analyzes sentiment.
"""

import os
import re
import time
import datetime as dt
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import email.utils
from typing import List, Dict, Tuple, Any

# Financial Sentiment Dictionary (Bilingual Arabic & English)
FINANCIAL_LEXICON = {
    # Positive Financial Indicators
    "positive": {
        # Arabic
        "أرباح": 2.0, "نمو": 2.0, "ارتفاع": 1.0, "صعود": 1.0, "قفزة": 1.5, "شراء": 1.5,
        "توزيعات": 1.5, "استحواذ": 2.0, "صفقة": 1.5, "مكاسب": 1.5, "تفاؤل": 1.0,
        "انتعاش": 1.0, "توسع": 1.5, "إيجابي": 1.5, "أداء قوي": 2.0, "أرباح قياسية": 2.5,
        "إيرادات": 1.0, "فائض": 1.5, "توصية": 1.0, "تفوق": 1.5,
        # Arabic spelling/number variants (EGX news often omits hamza / uses singular)
        "ربح": 2.0, "ارباح": 2.0, "مكسب": 1.5, "صعد": 1.0, "يرتفع": 1.0, "توزيع": 1.5,
        # English
        "profit": 2.0, "growth": 2.0, "rise": 1.0, "gain": 1.0, "jump": 1.5, "buy": 1.5,
        "dividend": 1.5, "acquisition": 2.0, "merge": 2.0, "bullish": 1.5, "positive": 1.5,
        "upside": 1.5, "revenue": 1.0, "record": 1.5, "surge": 1.5, "outperform": 2.0,
        "upgrade": 1.5, "expansion": 1.5, "earnings": 1.0
    },
    # Negative Financial Indicators
    "negative": {
        # Arabic
        "خسائر": 2.5, "تراجع": 1.0, "انخفاض": 1.0, "هبوط": 1.0, "غرامة": 1.5, "قضية": 1.0,
        "ديون": 1.5, "أزمة": 1.5, "سلبي": 1.5, "تحذير": 1.5, "تباطؤ": 1.0, "عجز": 2.0,
        "خسارة": 2.0, "انكماش": 1.5, "تسييل": 1.5, "إفلاس": 3.0, "تصفية": 2.0,
        # English
        "loss": 2.5, "drop": 1.0, "fall": 1.0, "decline": 1.0, "fine": 1.5, "lawsuit": 1.5,
        "debt": 1.5, "crisis": 1.5, "negative": 1.5, "warning": 1.5, "slowdown": 1.0,
        "bearish": 1.5, "downside": 1.5, "downgrade": 1.5, "underperform": 2.0, "crash": 2.5,
        "bankruptcy": 3.0, "deficit": 2.0
    }
}

# Negation tokens that flip sentiment (bilingual)
NEGATION_TOKENS = {
    # English
    "no", "not", "without", "despite", "failed", "fails", "fails to", "didn't", "doesn't",
    "isn't", "aren't", "wasn't", "weren't", "never", "nor", "unable", "reject", "rejected",
    "cancel", "cancelled", "halt", "halted", "suspend", "suspended",
    # Arabic
    "لا", "لم", "لن", "بدون", "رغم", "فشل", "يتخلف", "رفض", "ألغى", "يوقف", "تعطل", "يعجز",
}

# Window (in words) after a negation token within which sentiment is flipped
NEGATION_WINDOW = 4


def _is_arabic(text: str) -> bool:
    return any('\u0600' <= ch <= '\u06FF' for ch in text)


def get_symbol_search_terms(symbol: str) -> List[str]:
    sym = symbol.split(".")[0].upper().strip()
    terms = [sym]
    if sym.endswith("S") and len(sym) > 1:
        terms.append(sym[:-1])
    return list(dict.fromkeys(terms))


_TASHKEEL_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")


def _normalize_arabic(text: str) -> str:
    """Normalize Arabic spelling variants so news text can be matched reliably.

    Handles hamza forms, ta-marbuta, alif-maqsura, tatweel, tashkeel and
    irregular whitespace (EGX news outlets write the same company name in
    several ways: "أودن"/"اودن", "أبو ظبي"/"أبوظبي", "قرة"/"قره").
    """
    out = _TASHKEEL_RE.sub("", str(text or ""))
    out = out.replace("ـ", "")
    for src, dst in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"),
                     ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")):
        out = out.replace(src, dst)
    return re.sub(r"\s+", " ", out).strip().lower()


# Generic structural words that appear in many EGX company names. On their own
# they must never be treated as identifying tokens, otherwise "جروب" would
# match every "… جروب" headline and "المصرية" would match hundreds of companies.
GENERIC_NAME_TOKENS = {
    # Arabic legal/structure words
    "جروب", "مجموعه", "القابضه", "قابضه", "هولدنج", "هولدينج",
    "مصر", "مصري", "المصري", "مصريه", "المصريه",
    "للاستثمار", "للاستثمارات", "استثمار", "استثمارات", "الاستثمار", "الاستثمارات",
    "للتنميه", "تنميه", "التنميه", "للتنميه والتعمير",
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
    "التنميه", "التنميه والاستثمار", "ومخابز", "مطاحن", "دواجن",
    # Latin legal/structure words
    "holding", "holdings", "group", "company", "co", "corp", "inc", "ltd", "plc",
    "sae", "egypt", "egyptian", "bank", "for", "and", "the", "general",
    "investment", "investments", "financial", "industrial", "industries",
    "development", "international", "national", "egx", "stock",
}


# Sector words that appear inside legitimate company names but are far too
# common on their own ("طاقة" matches "قطر للطاقة", "غاز" matches any gas story).
# They are still allowed as part of a multi-word name phrase ("طاقة عربية",
# "غاز مصر"), just never as a single-token match.
AMBIGUOUS_SINGLE_TOKENS = {
    "طاقه", "غاز", "بترول", "سياحه", "سياحيه", "زراعه", "زراعي",
    "اسمنت", "حديد", "ادويه", "دواجن", "مطاحن", "فنادق", "منتجعات",
}


def _name_match_tokens(company_name: str) -> List[str]:
    """Distinctive tokens of a company name (generic words and short noise removed)."""
    tokens: List[str] = []
    for raw in re.split(r"[\s,،|/()\[\]{}\-–—.:;!؟?'\"]+", _normalize_arabic(company_name)):
        token = raw.strip()
        if len(token) < 3 or token in GENERIC_NAME_TOKENS or token in AMBIGUOUS_SINGLE_TOKENS:
            continue
        tokens.append(token)
    return list(dict.fromkeys(tokens))


def is_relevant_news(title: str, symbol: str, company_name: str = "") -> bool:
    """True when the headline is about the requested symbol/company.

    Matching order:
      1. Latin ticker as a whole token ("COMI" never matches "COMING").
      2. The full company name as a normalized phrase (handles "أبو ظبي").
      3. A distinctive company-name token ("عامر" for AMER, "قره" for KORA)
         matched with Arabic prefix/suffix tolerance ("الطاقة" ↔ "للطاقة").
    """
    if not title or not symbol:
        return False

    norm_title = _normalize_arabic(title)
    sym = symbol.split(".")[0].upper().strip()

    for term in get_symbol_search_terms(sym):
        if len(term) >= 3 and re.search(
            rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])", norm_title
        ):
            return True

    norm_name = _normalize_arabic(company_name)
    if not norm_name:
        return False

    # Consecutive-token phrases match space/squash variants: "ابو ظبي" must match
    # "أبوظبي" in the headline even when the name also has the Latin legal name.
    # Windows made only of generic words ("بنك مصر") are ignored on purpose.
    squashed_title = norm_title.replace(" ", "")
    name_words = [w for w in re.split(r"[\s,،|/()\[\]{}\-–—.:;!؟?'\"]+", norm_name) if w]
    for size in (3, 2, 1):
        for start in range(0, max(0, len(name_words) - size + 1)):
            chunk = name_words[start:start + size]
            # A window made only of generic words ("المصرية", "بنك مصر") must
            # never be enough on its own, otherwise every Egyptian company matches.
            if all(word in GENERIC_NAME_TOKENS for word in chunk):
                continue
            phrase = "".join(chunk)
            if len(phrase) < 6:
                continue
            # Latin phrases need word boundaries ("arabia" must not match the
            # domain "cnbcarabia.com"); Arabic phrases use the squashed compare
            # because outlets vary spacing and attached prefixes.
            if re.fullmatch(r"[a-z0-9]+", phrase):
                if re.search(rf"\b{re.escape(phrase)}\b", norm_title):
                    return True
            elif phrase in squashed_title:
                return True

    for token in _name_match_tokens(company_name):
        if _is_arabic(token):
            if _build_keyword_pattern(token).search(norm_title):
                return True
        elif re.search(rf"\b{re.escape(token)}\b", norm_title):
            return True

    return False


UNRELEVANT_NEWS_PATTERNS = [
    r"\bزمالك\b", r"\bأهلي\b", r"\bكره\b", r"\bكرة\b", r"\bمباراة\b", r"\bدوري\b",
    r"\bكابلات\b", r"\bكهربائية\b", r"\bمقاولون\b", r"\bسيارة\b", r"\bسيارات\b",
    r"\bعقاري\b", r"\bعقارات\b", r"\bعقار\b", r"\bاسمنت\b", r"\bأسمنت\b",
    r"\bبترول\b", r"\bغاز\b", r"\bبتروكيماويات\b",
    r"\bصفحة\b", r"\bأبراج\b", r"\bعالم\s+المال\b",
]


def is_unrelated_news(title: str) -> bool:
    if not title:
        return False
    t = title.lower()
    return any(re.search(p, t) for p in UNRELEVANT_NEWS_PATTERNS)


def _build_keyword_pattern(keyword: str) -> re.Pattern:
    """
    Build a word-boundary regex pattern for the given keyword.
    - English keywords: use \b word boundaries
    - Arabic keywords: Arabic has no \b; use explicit non-letter lookarounds
      and allow common prefixes (ال, لل, بال, وال, فال, ب, ل, و, ف)
      and common suffixes (اً, ا, ات, ين, ون, ه, ها, هم, هما, هن, نا, ك, كم, كما, كن, ي, ية, ة)
    """
    if _is_arabic(keyword):
        # Complete standard Arabic letters range from hamza to ya, plus Alif Wasla
        ar_letters = r'[\u0621-\u064A\u0671]'
        prefixes = r'(?:ال|لل|بال|وال|فال|ب|ل|و|ف)?'
        suffixes = r'(?:اً|ا|ات|ين|ون|ه|ها|هم|هما|هن|نا|ك|كم|كما|كن|ي|ية|ة)?'
        
        # Match the keyword with optional prefixes/suffixes, with non-Arabic-letter lookarounds on both sides
        pattern_str = rf'(?<!{ar_letters}){prefixes}{re.escape(keyword)}{suffixes}(?!{ar_letters})'
        return re.compile(pattern_str, re.IGNORECASE)
    else:
        # English: word boundary with optional simple plural ('s' or 'es').
        # Handles "loss"->"losses", "profit"->"profits", "crash"->"crashes".
        # The trailing \b still prevents substring matches like "loss" in "lossless" or "rise" in "surprise".
        return re.compile(r'\b' + re.escape(keyword) + r'(?:es|s)?\b', re.IGNORECASE)


def tokenize_with_positions(text: str) -> List[Dict[str, Any]]:
    """
    Tokenize the text into non-whitespace words, retaining their start and end character indices.
    """
    tokens = []
    for match in re.finditer(r'\S+', text):
        word = match.group(0)
        # Strip common punctuation for cleaner negation matching
        clean_word = word.strip('.,!?;:"\'()[]{}،؛؟<>*&^%$#@~`-_+=|\\/').lower()
        tokens.append({
            "text": clean_word,
            "original": word,
            "start": match.start(),
            "end": match.end()
        })
    return tokens


def _detect_negation_tokens(tokens: List[Dict[str, Any]]) -> set:
    """
    Return a set of token indices that fall within the negation window
    of any negation token.
    """
    negated_indices: set = set()
    for i, token in enumerate(tokens):
        if token["text"] in NEGATION_TOKENS:
            for j in range(i + 1, min(i + 1 + NEGATION_WINDOW, len(tokens))):
                negated_indices.add(j)
    return negated_indices


def get_token_index_for_char(tokens: List[Dict[str, Any]], char_pos: int) -> int:
    """
    Find which token covers a given character position. Falls back to the closest token.
    """
    for i, token in enumerate(tokens):
        if token["start"] <= char_pos <= token["end"]:
            return i
    # Fallback to closest token by distance
    best_idx = -1
    min_dist = float('inf')
    for i, token in enumerate(tokens):
        dist = min(abs(token["start"] - char_pos), abs(token["end"] - char_pos))
        if dist < min_dist:
            min_dist = dist
            best_idx = i
    return best_idx


# Pre-compile patterns for all keywords (done once at import time)
_POSITIVE_PATTERNS: Dict[str, Tuple[re.Pattern, float]] = {
    kw: (_build_keyword_pattern(kw), wt) for kw, wt in FINANCIAL_LEXICON["positive"].items()
}
_NEGATIVE_PATTERNS: Dict[str, Tuple[re.Pattern, float]] = {
    kw: (_build_keyword_pattern(kw), wt) for kw, wt in FINANCIAL_LEXICON["negative"].items()
}

def parse_pub_date(pub_str: str):
    """Parse an RSS pubDate into a ``datetime.date``.

    Always returns a *date* (never a datetime) so callers can compare it with
    another date directly. Comparing a datetime against a date raises TypeError,
    which previously aborted every item and produced silent zero-news runs.
    """
    try:
        parsed = email.utils.parsedate_to_datetime(str(pub_str or ""))
    except Exception:
        return None
    if parsed is None:
        return None
    if isinstance(parsed, dt.datetime):
        return parsed.date()
    return parsed


def fetch_google_news(
    symbol: str,
    days_back: int = 3,
    company_names: List[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetches news from Google News RSS using both Arabic and English queries.
    Uses standard xml.etree.ElementTree and urllib.
    Returns only headlines relevant to the requested symbol/company.

    ``company_names`` must include the Arabic company name(s) when available:
    most Egyptian outlets publish the Arabic name and never the Latin ticker,
    so without them Arabic coverage is silently dropped.
    """
    clean_sym = symbol.split(".")[0].upper()
    names = [str(n).strip() for n in (company_names or []) if str(n or "").strip()]
    company_name = ", ".join(names)

    # We combine Arabic and English search queries for maximum local market coverage
    queries = [
        f"{clean_sym} البورصة المصرية",
        f"{clean_sym} stock EGX",
    ]
    # Prefer the most specific Arabic alias (longest) for the name query.
    arabic_aliases = [n for n in names if _is_arabic(n)]
    if arabic_aliases:
        primary_arabic = max(arabic_aliases, key=len)
        queries.append(f"{primary_arabic} البورصة المصرية")

    news_items = {}
    cutoff_date = dt.date.today() - dt.timedelta(days=days_back)
    raw_item_count = 0

    for query in queries:
        try:
            encoded_query = urllib.parse.quote(query)
            # Use hl=ar for Arabic query and hl=en for English query
            hl = "ar" if "البورصة" in query else "en"
            gl = "EG"
            url = f"https://news.google.com/rss/search?q={encoded_query}&hl={hl}&gl={gl}&ceid={gl}:{hl}"

            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as response:
                xml_data = response.read()

            root = ET.fromstring(xml_data)

            for item in root.findall(".//item"):
                title_elem = item.find("title")
                link_elem = item.find("link")
                pub_elem = item.find("pubDate")
                source_elem = item.find("source")

                if title_elem is None or link_elem is None or pub_elem is None:
                    continue

                title = title_elem.text
                link = link_elem.text
                pub_str = pub_elem.text
                source = source_elem.text if source_elem is not None else "Google News"
                raw_item_count += 1

                try:
                    # parse_pub_date always yields a date so it can be compared
                    # with cutoff_date safely (a raw datetime raises TypeError,
                    # which used to be swallowed and silently produced zero news).
                    pub_date = parse_pub_date(pub_str)
                    if pub_date is None or pub_date < cutoff_date:
                        continue

                    # Deduplicate by link
                    if link not in news_items:
                        news_items[link] = {
                            "title": title,
                            "link": link,
                            "published": pub_date.isoformat(),
                            "source": source
                        }
                except Exception:
                    continue
        except Exception as e:
            print(f"[NEWS_ENGINE] Error fetching news query '{query}': {e}")

    # Keep only headlines that are relevant to the requested symbol
    relevant_items = [
        item for item in news_items.values()
        if is_relevant_news(item["title"], clean_sym, company_name)
        and not is_unrelated_news(item["title"])
    ]
    if raw_item_count > 0 and not relevant_items:
        print(
            f"[NEWS_ENGINE] {clean_sym}: {raw_item_count} RSS items but 0 matched "
            f"symbol/name (names={names or 'none'})"
        )
    return relevant_items

def analyze_sentiment(news_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyzes sentiment of the news list using our bilingual financial lexicon.
    Uses word-boundary regex matching with optional prefix/suffix (for Arabic),
    and negation detection based on precise character indices.
    """
    if not news_list:
        return {
            "sentiment_score": 0.0,
            "news_count": 0,
            "negative_flag": 0,
            "positive_flag": 0,
            "headlines": [],
            "sources": []
        }
        
    scores = []
    for item in news_list:
        title = item.get("title", "")
        
        # Tokenize with exact positions
        tokens = tokenize_with_positions(title)
        if not tokens:
            scores.append(0.0)
            continue
            
        negated_positions = _detect_negation_tokens(tokens)
        
        pos_hits = 0.0
        neg_hits = 0.0
        
        # Check positive keywords
        for keyword, (pattern, weight) in _POSITIVE_PATTERNS.items():
            for match in pattern.finditer(title):
                match_start = match.start()
                word_idx = get_token_index_for_char(tokens, match_start)
                if word_idx in negated_positions:
                    # Negated positive -> counts as negative
                    neg_hits += weight
                else:
                    pos_hits += weight
                
        # Check negative keywords
        for keyword, (pattern, weight) in _NEGATIVE_PATTERNS.items():
            for match in pattern.finditer(title):
                match_start = match.start()
                word_idx = get_token_index_for_char(tokens, match_start)
                if word_idx in negated_positions:
                    # Negated negative -> counts as positive (e.g. "no losses")
                    pos_hits += weight
                else:
                    neg_hits += weight
                
        total_hits = pos_hits + neg_hits
        if total_hits > 0:
            score = (pos_hits - neg_hits) / total_hits
            scores.append(score)
        else:
            # Neutral/Ambiguous
            scores.append(0.0)
            
    avg_score = sum(scores) / len(scores) if scores else 0.0
    
    # Flags for extreme news
    # A negative flag is raised if average sentiment is significantly negative
    neg_flag = 1 if avg_score < -0.15 else 0
    pos_flag = 1 if avg_score > 0.15 else 0
    
    return {
        "sentiment_score": round(avg_score, 4),
        "news_count": len(news_list),
        "negative_flag": neg_flag,
        "positive_flag": pos_flag,
        "headlines": [n.get("title", "") for n in news_list[:5] if n.get("title")],
        "sources": list({n.get("source", "Unknown") for n in news_list})
    }

def load_company_names(supabase_client=None) -> Dict[str, List[str]]:
    """symbol -> company name aliases (Latin name + Arabic aliases from stocks).

    Arabic aliases are required because Egyptian outlets publish Arabic names
    only; without them the symbol query returns nothing usable.
    """
    out: Dict[str, List[str]] = {}
    try:
        client = supabase_client
        if client is None:
            import api.stock_ai as stock_ai
            stock_ai._init_supabase()
            client = stock_ai.supabase
        if not client:
            return out
        res = client.table("stocks").select("symbol,name,name_ar").execute()
        for row in res.data or []:
            sym = str(row.get("symbol") or "").upper().strip()
            if not sym:
                continue
            aliases: List[str] = []
            if row.get("name"):
                aliases.append(str(row["name"]).strip())
            for part in re.split(r"[,،|/]", str(row.get("name_ar") or "")):
                part = part.strip()
                if part:
                    aliases.append(part)
            deduped = list(dict.fromkeys(a for a in aliases if a))
            if deduped:
                out[sym] = deduped
    except Exception as e:
        print(f"[NEWS_ENGINE] Could not load company names: {e}")
    return out


def process_exchange_news(
    exchange: str,
    symbols: List[str],
    name_map: Dict[str, List[str]] = None,
) -> Tuple[bool, int]:
    """
    Fetches, analyzes, and saves news sentiment for symbols to Supabase.

    Returns ``(found_any_news, symbols_with_news)``. Callers use the count to
    detect a silent coverage failure — previously a run that fetched nothing
    still looked successful because empty rows were written for every symbol.
    """
    import api.stock_ai as stock_ai
    stock_ai._init_supabase()

    if not stock_ai.supabase:
        print("[NEWS_ENGINE] Supabase not initialized. Skipping save.")
        return False, 0

    today_str = dt.date.today().isoformat()
    processed_count = 0
    symbols_with_news = 0
    total_headlines = 0

    if name_map is None:
        name_map = load_company_names(stock_ai.supabase)
    print(f"[NEWS_ENGINE] Loaded company names for {len(name_map)} symbols")
    
    print(f"[NEWS_ENGINE] Processing news for {len(symbols)} symbols in {exchange}...")
    
    for symbol in symbols:
        try:
            clean_symbol = symbol.split(".")[0].upper()
            aliases = name_map.get(clean_symbol, [])
            # 1. Fetch news
            news = fetch_google_news(symbol, days_back=3, company_names=aliases)
            # 2. Analyze
            sentiment = analyze_sentiment(news)
            if sentiment["news_count"] > 0:
                symbols_with_news += 1
                total_headlines += sentiment["news_count"]

            # 2.5 Classify corporate actions from the SAME fetched news
            # (rights issues, splits, dividends, bonus shares, ...) — no
            # extra network calls, reuses the headlines already fetched.
            try:
                from api.corporate_actions_engine import process_news_list_for_corporate_actions
                clean_ca_sym = symbol.split(".")[0].upper()
                ca_saved = process_news_list_for_corporate_actions(
                    clean_ca_sym,
                    exchange,
                    news,
                    supabase=stock_ai.supabase,
                    company_name=", ".join(aliases),
                )
                if ca_saved:
                    print(f"[NEWS_ENGINE] Stored {ca_saved} corporate action(s) for {clean_ca_sym}")
            except Exception as ca_err:
                print(f"[NEWS_ENGINE] Corporate action classification skipped for {symbol}: {ca_err}")

            # 3. Save to Supabase (upsert based on symbol and date)
            payload = {
                "symbol": clean_symbol,
                "exchange": exchange,
                "date": today_str,
                "sentiment_score": sentiment["sentiment_score"],
                "news_count": sentiment["news_count"],
                "negative_flag": sentiment["negative_flag"],
                "positive_flag": sentiment["positive_flag"],
                "headlines": sentiment["headlines"],
                "sources": sentiment["sources"]
            }
            
            stock_ai.supabase.table("stock_news_sentiment").upsert(payload, on_conflict="symbol,date").execute()
            processed_count += 1
            
            # Throttling to prevent IP blocking from Google News
            time.sleep(0.3)
        except Exception as e:
            print(f"[NEWS_ENGINE] Error processing news for {symbol}: {e}")
            
    print(
        f"[NEWS_ENGINE] Saved {processed_count} rows for {exchange}; "
        f"{symbols_with_news} symbols had news ({total_headlines} headlines total)."
    )
    return symbols_with_news > 0, symbols_with_news
