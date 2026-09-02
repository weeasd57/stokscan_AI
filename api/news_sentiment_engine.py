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


def is_relevant_news(title: str, symbol: str, company_name: str = "") -> bool:
    if not title or not symbol:
        return False
    t = title.lower()
    sym = symbol.split(".")[0].upper().strip()
    terms = get_symbol_search_terms(sym)
    for term in terms:
        if len(term) >= 3 and term.lower() in t:
            return True
    name = (company_name or "").lower()
    name_tokens = [token for token in name.split() if len(token) > 3]
    if name_tokens and any(token in t for token in name_tokens):
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


def _is_arabic(text: str) -> bool:
    """Check if a term contains Arabic characters."""
    return any('\u0600' <= ch <= '\u06FF' for ch in text)


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

def fetch_google_news(symbol: str, days_back: int = 3) -> List[Dict[str, Any]]:
    """
    Fetches news from Google News RSS using both Arabic and English queries.
    Uses standard xml.etree.ElementTree and urllib.
    Returns only headlines relevant to the requested symbol/company.
    """
    clean_sym = symbol.split(".")[0].upper()
    
    # We combine Arabic and English search queries for maximum local market coverage
    queries = [
        f"{clean_sym} البورصة المصرية",
        f"{clean_sym} stock EGX"
    ]
    
    news_items = {}
    cutoff_date = dt.date.today() - dt.timedelta(days=days_back)
    
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
                
                try:
                    pub_dt = email.utils.parsedate_to_datetime(pub_str)
                    if pub_dt < cutoff_date:
                        continue
                        
                    # Deduplicate by link
                    if link not in news_items:
                        news_items[link] = {
                            "title": title,
                            "link": link,
                            "published": pub_dt.date().isoformat(),
                            "source": source
                        }
                except Exception:
                    continue
        except Exception as e:
            print(f"[NEWS_ENGINE] Error fetching news query '{query}': {e}")
            
    # Keep only headlines that are relevant to the requested symbol
    relevant_items = [
        item for item in news_items.values()
        if is_relevant_news(item["title"], clean_sym) and not is_unrelated_news(item["title"])
    ]
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

def process_exchange_news(exchange: str, symbols: List[str]) -> Tuple[bool, int]:
    """
    Fetches, analyzes, and saves news sentiment for symbols to Supabase.
    """
    import api.stock_ai as stock_ai
    stock_ai._init_supabase()
    
    if not stock_ai.supabase:
        print("[NEWS_ENGINE] Supabase not initialized. Skipping save.")
        return False, 0
        
    today_str = dt.date.today().isoformat()
    processed_count = 0
    
    print(f"[NEWS_ENGINE] Processing news for {len(symbols)} symbols in {exchange}...")
    
    for symbol in symbols:
        try:
            # 1. Fetch news
            news = fetch_google_news(symbol, days_back=3)
            # 2. Analyze
            sentiment = analyze_sentiment(news)

            # 2.5 Classify corporate actions from the SAME fetched news
            # (rights issues, splits, dividends, bonus shares, ...) — no
            # extra network calls, reuses the headlines already fetched.
            try:
                from api.corporate_actions_engine import process_news_list_for_corporate_actions
                clean_ca_sym = symbol.split(".")[0].upper()
                ca_saved = process_news_list_for_corporate_actions(
                    clean_ca_sym, exchange, news, supabase=stock_ai.supabase
                )
                if ca_saved:
                    print(f"[NEWS_ENGINE] Stored {ca_saved} corporate action(s) for {clean_ca_sym}")
            except Exception as ca_err:
                print(f"[NEWS_ENGINE] Corporate action classification skipped for {symbol}: {ca_err}")

            # 3. Save to Supabase (upsert based on symbol and date)
            payload = {
                "symbol": symbol.split(".")[0].upper(),
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
            
    print(f"[NEWS_ENGINE] Successfully processed and stored news sentiment for {processed_count} symbols.")
    return True, processed_count
