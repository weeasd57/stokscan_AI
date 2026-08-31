"""
EGX Bots - Professional Accumulation & Distribution Scanner
============================================================
يعمل يومياً بعد إغلاق الجلسة لحساب إشارات التجميع والتصريف الاحترافية
لكل أسهم البورصة المصرية بناءً على:
  - OBV (On Balance Volume) - 5 أيام
  - حجم التداول النسبي مقارنة بالمتوسط 20 يوم (Volume Ratio)
  - عدد أيام التجميع المتتالية (Consecutive Days)
  - درجة التجميع الشاملة 0-100 (Accumulation Score)
  - تصنيف Wyckoff مبسط (Accumulation / Distribution / Neutral / Markup / Markdown)

يحفظ النتائج في جدول Supabase: stock_scans_summary
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from datetime import datetime, date, timedelta
from supabase import create_client, Client

# ─── Config ──────────────────────────────────────────────────────────────────
SUPABASE_URL = (
    os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or os.environ.get("SUPABASE_URL")
)
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
    or os.environ.get("SUPABASE_SERVICE_KEY")
)

VOL_RATIO_THRESHOLD   = 1.2   # حجم تداول يتخطى المتوسط ب 20% فأكثر
STRONG_THRESHOLD      = 2.0   # حجم تداول يتخطى المتوسط ب 100% فأكثر (تجميع قوي)
LOOKBACK_DAYS         = 30    # نطاق جلب البيانات للتحليل
MIN_ROWS_REQUIRED     = 5     # أقل عدد أيام بيانات مطلوب لتحليل السهم

def get_supabase() -> Client:
    if SUPABASE_URL and SUPABASE_KEY:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    # Fallback: reuse the API's already-initialized client (e.g. inside the daily job)
    try:
        _root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
        if _root not in sys.path:
            sys.path.insert(0, _root)
        import api.stock_ai as _stock_ai
        _stock_ai._init_supabase()
        _client = _stock_ai.supabase
        if _client is not None:
            return _client
    except Exception as e:
        print(f"  ⚠️  Could not reuse API Supabase client: {e}")
    raise RuntimeError("Missing Supabase credentials: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")


def fetch_all_symbols(sb: Client) -> list[str]:
    """جلب جميع رموز الأسهم المصرية من جدول stocks"""
    res = sb.table("stocks").select("symbol").eq("country", "Egypt").execute()
    syms = [r["symbol"] for r in (res.data or [])]
    # Fallback: if no results with 'Egypt', get all
    if not syms:
        res2 = sb.table("stocks").select("symbol").execute()
        syms = [r["symbol"] for r in (res2.data or [])]
    return syms


def fetch_recent_technicals(sb: Client, symbols: list[str], lookback_days: int) -> dict[str, list[dict]]:
    """جلب آخر N يوم من المؤشرات الفنية لكل سهم"""
    since = (date.today() - timedelta(days=lookback_days)).isoformat()
    BATCH = 50
    all_data: dict[str, list[dict]] = {}

    for i in range(0, len(symbols), BATCH):
        batch = symbols[i:i+BATCH]
        res = sb.table("stock_technical_indicators") \
                .select("symbol, date, change_pct, volume, vol_sma20, rsi_14, macd_signal, close, vwap_20") \
                .in_("symbol", batch) \
                .gte("date", since) \
                .order("date", desc=False) \
                .execute()

        for row in (res.data or []):
            sym = row["symbol"]
            if sym not in all_data:
                all_data[sym] = []
            all_data[sym].append(row)

    return all_data


def calc_obv_change(rows: list[dict]) -> float:
    """
    On Balance Volume (OBV) - يحسب اتجاه OBV آخر 5 أيام
    OBV يزيد عند صعود السعر، يقل عند هبوطه
    returns: نسبة تغير OBV (양수 = تجميع، سالب = تصريف)
    """
    if len(rows) < 2:
        return 0.0

    obv = 0.0
    obvs = []
    prev_close = None
    for row in rows[-10:]:  # آخر 10 أيام كافية
        close = float(row.get("close") or 0)
        vol   = float(row.get("volume") or 0)
        if prev_close is None:
            prev_close = close
            obvs.append(0.0)
            continue
        if close > prev_close:
            obv += vol
        elif close < prev_close:
            obv -= vol
        prev_close = close
        obvs.append(obv)

    if len(obvs) < 5:
        return 0.0

    early = obvs[0] if obvs[0] != 0 else 1.0
    recent = obvs[-1]
    if early == 0:
        return 0.0
    return (recent - early) / abs(early) * 100


def calc_consecutive_accumulation_days(rows: list[dict]) -> int:
    """
    عدد الأيام المتتالية على تجميع (من آخر يوم للخلف)
    يوم تجميع = سعر صاعد + حجم يتخطى المتوسط 1.2x
    """
    streak = 0
    for row in reversed(rows):
        vol    = float(row.get("volume") or 0)
        sma20  = float(row.get("vol_sma20") or 0)
        change = float(row.get("change_pct") or 0)
        if sma20 > 0 and (vol / sma20) >= VOL_RATIO_THRESHOLD and change > 0:
            streak += 1
        else:
            break
    return streak


def calc_consecutive_distribution_days(rows: list[dict]) -> int:
    """عدد الأيام المتتالية على تصريف"""
    streak = 0
    for row in reversed(rows):
        vol    = float(row.get("volume") or 0)
        sma20  = float(row.get("vol_sma20") or 0)
        change = float(row.get("change_pct") or 0)
        if sma20 > 0 and (vol / sma20) >= VOL_RATIO_THRESHOLD and change < 0:
            streak += 1
        else:
            break
    return streak


def classify_wyckoff(acc_score: float, dist_score: float, consecutive_acc: int, consecutive_dist: int) -> str:
    """
    تصنيف Wyckoff مبسط بناءً على درجات التجميع والتصريف
    """
    if acc_score >= 70 and consecutive_acc >= 3:
        return "strong_accumulation"
    elif acc_score >= 50:
        return "accumulation"
    elif dist_score >= 70 and consecutive_dist >= 3:
        return "strong_distribution"
    elif dist_score >= 50:
        return "distribution"
    elif acc_score >= 35:
        return "weak_accumulation"
    elif dist_score >= 35:
        return "weak_distribution"
    else:
        return "neutral"


def analyze_symbol(rows: list[dict]) -> dict | None:
    """
    تحليل سهم واحد وإرجاع dictionary بكل المؤشرات
    """
    if not rows or len(rows) < MIN_ROWS_REQUIRED:
        return None

    # أحدث يوم
    latest = rows[-1]
    scan_date = latest.get("date", date.today().isoformat())
    vol    = float(latest.get("volume") or 0)
    sma20  = float(latest.get("vol_sma20") or 0)
    change = float(latest.get("change_pct") or 0)
    rsi    = float(latest.get("rsi_14") or 50)
    macd   = float(latest.get("macd_signal") or 0)

    if sma20 <= 0 or vol <= 0:
        return None

    vol_ratio = vol / sma20

    # ─── حساب الدرجات ─────────────────────────────────────────────────────
    # 1) درجة نسبة الحجم (0-40 نقطة)
    vol_score = min(40.0, (vol_ratio - 1.0) * 20.0) if vol_ratio > 1.0 else 0.0

    # 2) درجة الـ OBV (0-30 نقطة)
    obv_change = calc_obv_change(rows)
    obv_score = min(30.0, max(0.0, obv_change / 2.0)) if obv_change > 0 else 0.0
    obv_dist_score = min(30.0, max(0.0, abs(obv_change) / 2.0)) if obv_change < 0 else 0.0

    # 3) درجة الأيام المتتالية (0-20 نقطة)
    consec_acc  = calc_consecutive_accumulation_days(rows)
    consec_dist = calc_consecutive_distribution_days(rows)
    consec_score     = min(20.0, consec_acc * 5.0)
    consec_dist_score = min(20.0, consec_dist * 5.0)

    # 4) درجة RSI (0-10 نقطة) - RSI 30-50 يدل على تجميع محتمل
    rsi_score = 10.0 if 30 <= rsi <= 55 else (5.0 if 55 < rsi <= 65 else 0.0)

    # ─── الدرجة الإجمالية ─────────────────────────────────────────────────
    if change > 0:
        acc_score  = round(vol_score + obv_score + consec_score + rsi_score, 1)
        dist_score = 0.0
    elif change < 0:
        dist_score = round(vol_score + obv_dist_score + consec_dist_score, 1)
        acc_score  = 0.0
    else:
        acc_score  = 0.0
        dist_score = 0.0

    wyckoff = classify_wyckoff(acc_score, dist_score, consec_acc, consec_dist)

    # ─── الإشارة النهائية ─────────────────────────────────────────────────
    if wyckoff in ("strong_accumulation", "accumulation"):
        signal = "accumulation"
    elif wyckoff in ("strong_distribution", "distribution"):
        signal = "distribution"
    elif wyckoff == "weak_accumulation":
        signal = "weak_accumulation"
    elif wyckoff == "weak_distribution":
        signal = "weak_distribution"
    else:
        signal = "neutral"

    return {
        "scan_date":           scan_date,
        "vol_ratio":           round(vol_ratio, 3),
        "vol_ratio_5d":        round(vol_ratio, 3),  # نستخدم نفس الرقم لليوم الحالي
        "obv_change_pct":      round(max(-99999.99, min(99999.99, obv_change)), 2),
        "consecutive_acc_days":  consec_acc,
        "consecutive_dist_days": consec_dist,
        "acc_score":           round(acc_score, 1),
        "dist_score":          round(dist_score, 1),
        "wyckoff_phase":       wyckoff,
        "signal":              signal,
        "rsi_14":              round(rsi, 2),
        "macd_signal":         round(macd, 4),
        "change_pct":          round(change, 4),
        "volume":              int(vol),
        "vol_sma20":           int(sma20),
    }


def upsert_results(sb: Client, records: list[dict]) -> int:
    """حفظ النتائج في جدول stock_scans_summary"""
    if not records:
        return 0

    BATCH = 200
    saved = 0
    for i in range(0, len(records), BATCH):
        batch = records[i:i+BATCH]
        try:
            sb.table("stock_scans_summary") \
              .upsert(batch, on_conflict="symbol,scan_date") \
              .execute()
            saved += len(batch)
        except Exception as e:
            print(f"  ⚠️  Error upserting batch {i//BATCH + 1}: {e}")

    return saved


def run():
    print(f"\n{'='*60}")
    print(f"  EGX Accumulation Scanner — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    sb = get_supabase()

    # 1. جلب الرموز
    print("📋 Fetching all EGX symbols...")
    symbols = fetch_all_symbols(sb)
    print(f"   → Found {len(symbols)} symbols\n")

    # 2. جلب بيانات المؤشرات الفنية
    print(f"📊 Fetching last {LOOKBACK_DAYS} days of technical data...")
    tech_data = fetch_recent_technicals(sb, symbols, LOOKBACK_DAYS)
    print(f"   → Data fetched for {len(tech_data)} symbols\n")

    # 3. تحليل كل سهم
    print("🔬 Analyzing accumulation & distribution signals...")
    results = []
    stats   = {"accumulation": 0, "distribution": 0, "neutral": 0, "weak": 0, "skipped": 0}

    for sym, rows in tech_data.items():
        analysis = analyze_symbol(rows)
        if analysis is None:
            stats["skipped"] += 1
            continue

        analysis["symbol"] = sym
        results.append(analysis)

        sig = analysis["signal"]
        if sig == "accumulation":
            stats["accumulation"] += 1
        elif sig == "distribution":
            stats["distribution"] += 1
        elif sig in ("weak_accumulation", "weak_distribution"):
            stats["weak"] += 1
        else:
            stats["neutral"] += 1

    print(f"   → Accumulation:  {stats['accumulation']}")
    print(f"   → Distribution:  {stats['distribution']}")
    print(f"   → Weak signals:  {stats['weak']}")
    print(f"   → Neutral:       {stats['neutral']}")
    print(f"   → Skipped:       {stats['skipped']}\n")

    # 4. حفظ في Supabase
    print("💾 Saving results to Supabase (stock_scans_summary)...")
    saved = upsert_results(sb, results)
    print(f"   → {saved} records saved ✅\n")

    # 5. طباعة أعلى 10 تجميع
    top_acc = sorted(
        [r for r in results if r["signal"] in ("accumulation",)],
        key=lambda x: x["acc_score"],
        reverse=True
    )[:10]

    if top_acc:
        print("🏆 Top 10 Accumulation Stocks (by Score):")
        print(f"  {'#':<3} {'Symbol':<8} {'Score':<8} {'VolRatio':<10} {'Consec':<8} {'Change%'}")
        print(f"  {'-'*55}")
        for i, r in enumerate(top_acc, 1):
            print(f"  {i:<3} {r['symbol']:<8} {r['acc_score']:<8} {r['vol_ratio']:<10} {r['consecutive_acc_days']:<8} {r['change_pct']:+.2f}%")
    print()

    print("✅ Scan complete!")
    return 0


if __name__ == "__main__":
    sys.exit(run())
