"""
Corporate Actions Engine — free, keyless EGX corporate-action news pipeline.

Detects and stores corporate actions (حقوق الاكتتاب، التجزئة، توزيعات الأرباح،
الأسهم المجانية، زيادة/تخفيض رأس المال، إعادة الشراء، الاستحواذ، النتائج)
into the Supabase `corporate_actions` table so the chatbot can ground its
answers on them.

Sources (all free, no API key):
    - Google News RSS (reuses news_sentiment_engine.fetch_google_news)
    - Classification is rule-based (bilingual regex), mirroring the sentiment
      lexicon approach used for `stock_news_sentiment`.

Two entry points:
    1. `process_news_list_for_corporate_actions()` — classify an already-fetched
       news list (called from process_exchange_news; zero extra network calls).
    2. `process_exchange_corporate_actions()` — full standalone pass
       (fetch + classify + save), used by run_corporate_actions_update.py.
"""

import re
import hashlib
import datetime as dt
from typing import List, Dict, Any, Optional, Tuple

from api.news_sentiment_engine import fetch_google_news, analyze_sentiment

# ---------------------------------------------------------------------------
# Arabic normalization (same conventions as the rest of the codebase)
# ---------------------------------------------------------------------------

def _normalize_arabic(text: str) -> str:
    if not text:
        return ""
    return (
        text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
        .replace("ة", "ه").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
        .replace("\u0640", "")
        .lower()
    )


# ---------------------------------------------------------------------------
# Corporate-action taxonomy + bilingual patterns (ordered by specificity:
# first match wins so "حقوق اكتتاب" beats the generic "زيادة رأس المال"
# when both appear in one headline)
# ---------------------------------------------------------------------------

CORPORATE_ACTION_TYPES: List[Tuple[str, str, List[str], float]] = [
    (
        "rights_issue",
        "حقوق اكتتاب",
        [
            r"حقوق?\s*اكتتاب", r"اكتتاب\s*(?:في|فى)?\s*حق", r"حق\s*الاولويه",
            r"\brights?\s+(?:issue|offering|subscription)\b", r"\bsubscription\s+rights\b",
        ],
        0.9,
    ),
    (
        "dividend",
        "توزيعات أرباح",
        [
            r"توزيعات", r"توزيع\s*ارباح", r"كوبون", r"توزيع\s*نقدي",
            r"\bdividend", r"cash\s+distribution",
        ],
        0.85,
    ),
    (
        "bonus_shares",
        "أسهم مجانية (منحة)",
        [
            r"اسهم?\s*مجاني[هة]?", r"منح[هة]\s*(?:اسهم|حصص|سهم)", r"حصص\s*مجاني[هة]?",
            r"\bbonus\s+shares?\b", r"\bfree\s+shares?\b", r"\bstock\s+dividend\b",
        ],
        0.85,
    ),
    (
        "stock_split",
        "تجزئة السهم",
        [
            r"تجزئ[ةه]?\s*(?:ال)?سهم", r"سهم.{0,12}تجزئ", r"تجزئ[ةه]?.{0,12}الاسمي[هة]",
            r"تقسيم\s*(?:ال)?سهم", r"\bstock\s+split\b", r"\bshare\s+split\b",
        ],
        0.85,
    ),
    (
        "par_value_reduction",
        "تخفيض القيمة الاسمية",
        [
            r"تخفيض.{0,12}الاسمي[هة]", r"الاسمي[هة].{0,12}تخفيض",
            r"\bpar\s+value\s+reduction\b",
        ],
        0.8,
    ),
    (
        "capital_increase",
        "زيادة رأس المال",
        [
            r"زياده.{0,6}راس.{0,6}المال", r"زياده.{0,20}(?:المصدر|المدفوع)",
            r"رفع.{0,15}(?:راس|رأس).{0,6}المال", r"\bcapital\s+increase\b",
            r"rais\w*\s+capital\b", r"\bshare\s+issue\b",
        ],
        0.8,
    ),
    (
        "capital_reduction",
        "تخفيض رأس المال",
        [
            r"تخفيض.{0,6}راس.{0,6}المال", r"تخفيض.{0,20}(?:المصدر|غير\s*المدفوع)",
            r"\bcapital\s+reduction\b", r"reduc\w*\s+capital\b",
        ],
        0.8,
    ),
    (
        "buyback",
        "إعادة شراء الأسهم",
        [
            r"اعاده\s*شراء", r"برنامج\s*استرداد", r"استرداد\s*اسهم",
            r"\bbuy-?back\b", r"\brepurchas", r"\btreasury\s+shares?\b",
        ],
        0.8,
    ),
    (
        "merger_acquisition",
        "استحواذ / اندماج",
        [
            r"استحواذ", r"اندماج", r"صفقه\s*(?:شراء|استحواذ|دمج)",
            r"\bacquisition\b", r"\bmerger\b", r"\bacquir\w*\b",
        ],
        0.75,
    ),
    (
        "earnings",
        "نتائج أعمال",
        [
            r"نتائج\s*(?:الاعمال|الربع|اعمال|النصف)", r"ارباح.{0,15}(?:الربع|النصف|العام|السنه|9|تسعه)",
            r"بيانات?\s*مالي[هة]", r"قوائم?\s*مالي[هة]", r"\bearnings\b",
            r"\bquarterly\s+results?\b", r"\bresults?\s+announcement\b",
        ],
        0.6,
    ),
]

_COMPILED_PATTERNS = [
    (action_type, label_ar, [re.compile(p) for p in patterns], base_conf)
    for action_type, label_ar, patterns, base_conf in CORPORATE_ACTION_TYPES
]


# ---------------------------------------------------------------------------
# Detail extraction (amounts / percentages / ratios inside the headline)
# ---------------------------------------------------------------------------

def _extract_details(title: str) -> Dict[str, Any]:
    details: Dict[str, Any] = {}
    pct = re.search(r"(\d+(?:\.\d+)?)\s*%", title)
    if pct:
        details["percentage"] = float(pct.group(1))
    amount = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:جنيه|ج\.?م\.?|le|egp)\b",
        _normalize_arabic(title),
    )
    if amount:
        details["amount_egp"] = float(amount.group(1))
    per_shares = re.search(r"(\d+(?:\.\d+)?)\s*(?:جنيه|ج\.?م\.?|le|egp)\s*(?:لكل|لـ|ا?ل?|لل)?\s*سهم", _normalize_arabic(title))
    if per_shares:
        details["amount_per_share_egp"] = float(per_shares.group(1))
    ratio = re.search(r"لكل\s*(?:سهم|اسهم)\s*(\d+(?:\.\d+)?\s*(?:سهم|اسهم))", _normalize_arabic(title))
    if ratio:
        details["ratio_per_share"] = ratio.group(1)
    return details


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify_corporate_action(title: str) -> Optional[Dict[str, Any]]:
    """
    Classify a headline as a corporate action.
    Returns None when the headline is not a corporate action.
    """
    if not title:
        return None
    normalized = _normalize_arabic(title)
    for action_type, label_ar, patterns, base_conf in _COMPILED_PATTERNS:
        for pattern in patterns:
            if pattern.search(normalized) or pattern.search(title.lower()):
                details = _extract_details(title)
                return {
                    "action_type": action_type,
                    "action_type_ar": label_ar,
                    "confidence": round(base_conf + (0.1 if details else 0.0), 2),
                    "details": details or None,
                }
    return None


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _dedupe_key(exchange: str, symbol: str, action_type: str, url: str, title: str) -> str:
    if url:
        identity = url.strip().lower()
    else:
        identity = hashlib.md5(_normalize_arabic(title).encode("utf-8")).hexdigest()[:20]
    return f"{exchange}|{symbol}|{action_type}|{identity}"


def _save_corporate_action(
    supabase,
    symbol: str,
    exchange: str,
    item: Dict[str, Any],
    classification: Dict[str, Any],
    origin: str,
) -> bool:
    title = item.get("title", "")
    url = item.get("link") or item.get("url")
    source = item.get("source") or "Google News"
    published = item.get("published") or item.get("publishedAt") or item.get("date")

    payload = {
        "symbol": symbol.split(".")[0].upper(),
        "exchange": exchange,
        "action_type": classification["action_type"],
        "title": title,
        "published_at": f"{published}T00:00:00Z" if published and len(str(published)) == 10 else published,
        "url": url,
        "source": source,
        "details": classification.get("details"),
        "confidence": classification.get("confidence", 0.5),
        "origin": origin,
        "dedupe_key": _dedupe_key(exchange, symbol, classification["action_type"], url or "", title),
        "updated_at": dt.datetime.utcnow().isoformat(),
    }

    sentiment = analyze_sentiment([item])
    payload["sentiment_score"] = sentiment.get("sentiment_score", 0.0)
    score = float(sentiment.get("sentiment_score", 0.0))
    payload["sentiment_label"] = "positive" if score > 0.15 else "negative" if score < -0.15 else "neutral"

    supabase.table("corporate_actions").upsert(payload, on_conflict="dedupe_key").execute()
    return True


def process_news_list_for_corporate_actions(
    symbol: str,
    exchange: str,
    news_items: List[Dict[str, Any]],
    supabase=None,
    origin: str = "scheduler",
) -> int:
    """
    Classify an already-fetched news list and store corporate actions.
    Returns the number of stored actions (0 when nothing matched or on failure).
    """
    try:
        if supabase is None:
            import api.stock_ai as stock_ai
            stock_ai._init_supabase()
            supabase = stock_ai.supabase
        if not supabase or not news_items:
            return 0

        saved = 0
        for item in news_items:
            classification = classify_corporate_action(item.get("title", ""))
            if not classification:
                continue
            try:
                _save_corporate_action(supabase, symbol, exchange, item, classification, origin)
                saved += 1
            except Exception as e:
                print(f"[CA-ENGINE] Failed saving action for {symbol}: {e}")
        return saved
    except Exception as e:
        print(f"[CA-ENGINE] process_news_list error for {symbol}: {e}")
        return 0


def fetch_corporate_action_news(symbol: str, company_name: str = "", days_back: int = 30) -> List[Dict[str, Any]]:
    """
    Fetch news likely to contain corporate actions for a symbol using
    keyless Google News RSS with targeted bilingual queries.
    """
    import urllib.parse
    import urllib.request
    import xml.etree.ElementTree as ET
    import email.utils

    clean_sym = symbol.split(".")[0].upper()
    subject = company_name or clean_sym
    queries = [
        f'{subject} (اكتتاب OR توزيعات OR تجزئة OR منحة OR "رأس المال")',
        f'{clean_sym} (dividend OR split OR "rights issue" OR bonus) EGX',
    ]

    items: Dict[str, Dict[str, Any]] = {}
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days_back)

    for query in queries:
        try:
            hl = "ar" if any("\u0600" <= ch <= "\u06FF" for ch in query) else "en"
            url = (
                "https://news.google.com/rss/search?q="
                + urllib.parse.quote(query) + f"&hl={hl}&gl=EG&ceid=EG:{hl}"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as response:
                root = ET.fromstring(response.read())

            for item_el in root.findall(".//item"):
                title_el = item_el.find("title")
                link_el = item_el.find("link")
                pub_el = item_el.find("pubDate")
                source_el = item_el.find("source")
                if title_el is None or link_el is None:
                    continue
                title = title_el.text or ""
                link = link_el.text or ""
                pub_str = pub_el.text if pub_el is not None else None
                try:
                    published = email.utils.parsedate_to_datetime(pub_str)
                    if published < cutoff:
                        continue
                except Exception:
                    published = None
                if link not in items:
                    items[link] = {
                        "title": title,
                        "link": link,
                        "published": published.date().isoformat() if published else None,
                        "source": source_el.text if source_el is not None else "Google News",
                    }
        except Exception as e:
            print(f"[CA-ENGINE] Query '{query}' failed: {e}")

    return list(items.values())


def process_exchange_corporate_actions(exchange: str, symbols: List[str], days_back: int = 30) -> Tuple[bool, int]:
    """
    Full standalone pass: fetch targeted CA news per symbol, classify, save.
    """
    import time

    try:
        import api.stock_ai as stock_ai
        stock_ai._init_supabase()
        if not stock_ai.supabase:
            print("[CA-ENGINE] Supabase not initialized. Skipping.")
            return False, 0
        supabase = stock_ai.supabase
    except Exception as e:
        print(f"[CA-ENGINE] Supabase init error: {e}")
        return False, 0

    # Company names improve recall (many headlines use the Arabic company name)
    name_map: Dict[str, str] = {}
    try:
        clean_symbols = [s.split(".")[0].upper() for s in symbols]
        res = (
            supabase.table("stocks")
            .select("symbol, name, name_ar")
            .in_("symbol", clean_symbols)
            .execute()
        )
        for row in res.data or []:
            name_map[row["symbol"].upper()] = row.get("name_ar") or row.get("name") or ""
    except Exception:
        pass

    saved_total = 0
    print(f"[CA-ENGINE] Processing corporate actions for {len(symbols)} symbols...")
    for symbol in symbols:
        try:
            clean_sym = symbol.split(".")[0].upper()
            news = fetch_corporate_action_news(
                symbol, name_map.get(clean_sym, ""), days_back=days_back
            )
            saved_total += process_news_list_for_corporate_actions(
                clean_sym, exchange, news, supabase=supabase
            )
            time.sleep(0.3)
        except Exception as e:
            print(f"[CA-ENGINE] Error processing {symbol}: {e}")

    print(f"[CA-ENGINE] Done — {saved_total} corporate actions stored/refreshed.")
    return True, saved_total
