#!/usr/bin/env python3
"""
Hugging Face Space batch job – تحديث كامل لجدول market_cache في Supabase.
يُست‑خدم لتقليل حمل API/Vercel على المستخدمين.
"""
import os
import time
from datetime import datetime, timezone, timedelta

from supabase import create_client, Client

# -------------------------------------------------
# إعدادات الاتصال بـ Supabase (مقروءة من .env)
# -------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing Supabase env vars")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------------------------------
# وظائف مساعدة
# -------------------------------------------------
def _upsert(key: str, payload: dict, ttl_seconds: int = 6 * 3600) -> None:
    """يدمج/يحدث سجلًّا في market_cache."""
    data = {
        "cache_key": key,
        "country": "Egypt",
        "payload": payload,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("market_cache").upsert(data).execute()


def _calc_sector_timeline(months: int = 6) -> dict:
    """محاكاة حساب إحصاءات القطاع على مدى `months` شهرًا.
    يمكن استبدالها بمنطق حقيقي إذا لزم الأمر.
    """
    from random import randint

    sector_names = [
        "Speculative Sector",
        "Financial Services",
        "Utilities",
        "Industrial Goods",
        "Health Care",
        "Telecom",
    ]
    data = {"months": [], "sectors": []}
    now = datetime.now()
    for i in range(months, 0, -1):
        month = (now - timedelta(days=30 * i)).strftime("%Y-%m")
        data["months"].append(month)

    for sec in sector_names:
        series = []
        for m in data["months"]:
            net = randint(-5_000_000, 5_000_000)
            flow = abs(net) + randint(0, 2_000_000)
            direction = "neutral"
            if net > 0:
                direction = "inflow"
            elif net < 0:
                direction = "outflow"
            series.append({"month": m, "net": net, "flow": flow, "direction": direction})
        data["sectors"].append({"sector": sec, "sector_ar": f"قطاع {sec}", "series": series})
    return data

# -------------------------------------------------
# الدالة الرئيسية
# -------------------------------------------------
def main() -> int:
    print("[🛠️] بدء تحديث market_cache …")
    start = time.time()

    payload = _calc_sector_timeline(months=6)
    _upsert("sector_timeline_6m", payload)

    # يمكن إضافة مفاتيح إضافية هنا بنفس الطريقة.
    elapsed = time.time() - start
    print(f"[✅] تم الانتهاء بعد {elapsed:.2f}s")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
