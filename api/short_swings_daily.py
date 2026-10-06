"""
Daily Short Swings Automation & Telegram Dispatch Module
Coordinates EOD short swings computation and dual-channel Telegram publishing:
- VIP Channel: Complete, unmasked trade alerts with entry prices, -4% stop loss, breakeven lock, and EMA10 trailing stops.
- Free Channel: Masked teaser alerts highlighting institutional volume surges and sectors with PRO upgrade links.
"""
import os
import sys
import json
import datetime as dt
from typing import Dict, List, Any, Optional
from zoneinfo import ZoneInfo

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api.short_swings_engine import compute_short_swings
from api.web_origin import get_web_origin


def _get_supabase_client():
    try:
        from api.stock_ai import supabase, _init_supabase
        if not supabase:
            _init_supabase()
        return supabase
    except Exception:
        return None


def _get_sent_cache_state(sb, as_of_date: str) -> Dict[str, Any]:
    """Retrieve delivery history for short swings to avoid double-posting."""
    if not sb:
        return {"sent_entries": [], "sent_exits": []}
    try:
        res = (
            sb.table("market_cache")
            .select("payload")
            .eq("cache_key", f"short_swings_sent_{as_of_date}")
            .eq("country", "Egypt")
            .maybe_single()
            .execute()
        )
        row = getattr(res, "data", None)
        if row and isinstance(row.get("payload"), dict):
            return row["payload"]
    except Exception as e:
        print(f"[SHORT_SWINGS_DAILY] Failed to fetch sent cache: {e}")
    return {"sent_entries": [], "sent_exits": []}


def _save_sent_cache_state(sb, as_of_date: str, state: Dict[str, Any]):
    if not sb:
        return
    try:
        sb.table("market_cache").upsert({
            "cache_key": f"short_swings_sent_{as_of_date}",
            "country": "Egypt",
            "payload": state,
            "computed_at": dt.datetime.utcnow().isoformat()
        }).execute()
    except Exception as e:
        print(f"[SHORT_SWINGS_DAILY] Failed to save sent cache: {e}")


def build_vip_entry_message(trades: List[Dict[str, Any]], as_of_date: str, web_origin: str) -> str:
    """Format full, unmasked swing signals for the VIP channel ready for tomorrow's open."""
    lines = [
        "⚡ *إشارات مضاربة قصيرة جديدة (نظام الزخم ⚡ PRO)*",
        f"📅 رُصدت بنهاية جلسة: `{as_of_date}` | 🎯 *التنفيذ: مع افتتاح جلسة الغد*",
        "━━━━━━━━━━━━━━━━━━━━",
        "تم رصد اختراق قواعد سعرية مع انفجار سيولة مؤسسية (>140%) جاهزة للدخول غداً:",
        ""
    ]

    for t in trades:
        sym = t.get("symbol", "")
        name = t.get("name_ar", sym)
        close_ref = t.get("entry_price", 0.0)
        sl_price = t.get("trailing_stop", close_ref * 0.96)
        sig_type = t.get("trigger_type", "اختراق قمة 20 جلسة مع انفجار سيولة")
        sector = t.get("sector", "عام")

        lines.extend([
            f"🔹 *{name}* (`{sym}`) — قطاع {sector}",
            f"  • *سعر الإغلاق المرجعي:* `{close_ref:.2f}` ج.م",
            f"  • *نقطة الدخول المقترحة:* مع افتتاح جلسة الغد (شرط عدم الافتتاح بفجوة صاعدة > 2%)",
            f"  • *وقف الخسارة الصارم:* `{sl_price:.2f}` ج.م (-4.0% من الإغلاق)",
            f"  • *تأمين الصفقة (Breakeven):* عند وصول السعر إلى `+{close_ref * 1.045:.2f}` ج.م (+4.5%) يُرفع الوقف لنقطة الدخول فوراً.",
            f"  • *استراتيجية جني الأرباح:* الوقف يتبع متوسط `EMA10` يومياً لركوب كامل الموجة 🚀",
            f"  • *النموذج الفني:* {sig_type}",
            ""
        ])

    lines.extend([
        "━━━━━━━━━━━━━━━━━━━━",
        f"🔗 *متابعة الإشارات الحية ولوحة التقويم:*",
        f"{web_origin}/?tab=short_swings",
        "⚠️ *تنبيه إدارة مخاطر:* جهز أمر الشراء قبل افتتاح الجلسة ولا تخاطر بأكثر من 1-2% من رأس مال محفظتك."
    ])

    return "\n".join(lines)


def build_free_entry_message(trades: List[Dict[str, Any]], as_of_date: str, web_origin: str) -> str:
    """Format masked teaser signals for the Free channel."""
    lines = [
        "⚡ *إشارات مضاربة قصيرة جديدة تم رصدها الآن! (نظام ⚡ PRO)*",
        f"📅 رُصدت بنهاية جلسة: `{as_of_date}` | 🎯 *جاهزة للتنفيذ في جلسة الغد*",
        "━━━━━━━━━━━━━━━━━━━━",
        f"رصد محرك الذكاء الاصطناعي `{len(trades)}` فرصة زخم وانفجار سيولة جديدة بالبورصة المصرية:",
        ""
    ]

    for idx, t in enumerate(trades, 1):
        sector = t.get("sector", "عام")
        sig_type = t.get("trigger_type", "اختراق فني قوي")
        lines.extend([
            f"📍 *فرصة مضاربة رقم {idx}:*",
            f"  • *القطاع:* {sector}",
            f"  • *النموذج:* {sig_type}",
            f"  • *موعد الدخول:* مع افتتاح جلسة الغد",
            f"  • *الرمز والسعر ووقف الخسارة:* متاح حصرياً لمشتركي VIP 🔒",
            ""
        ])

    lines.extend([
        "━━━━━━━━━━━━━━━━━━━━",
        "🔓 *فعّل اشتراك PRO الآن لإلغاء التشفير واستلام الإشارات كاملة:*",
        f"🔗 {web_origin}/pricing"
    ])

    return "\n".join(lines)


def build_vip_exit_message(exits: List[Dict[str, Any]], as_of_date: str, web_origin: str) -> str:
    """Format closed trades alerts for VIP."""
    lines = [
        "🏁 *إغلاق صفقات مضاربة قصيرة ⚡ PRO*",
        f"📅 جلسة: `{as_of_date}`",
        "━━━━━━━━━━━━━━━━━━━━"
    ]

    for e in exits:
        sym = e.get("symbol", "")
        name = e.get("name_ar", sym)
        ret = e.get("return_pct", 0.0)
        entry = e.get("entry_price", 0.0)
        exit_p = e.get("exit_price", 0.0)
        days = e.get("holding_days", 1)
        reason = e.get("exit_reason", "إغلاق حسب الخطة")
        sign = "+" if ret >= 0 else ""
        icon = "🟢" if ret > 0 else "🔴"

        lines.extend([
            f"{icon} *{name}* (`{sym}`):",
            f"  • *النتيجة:* `{sign}{ret:.2f}%`",
            f"  • *الدخول:* `{entry:.3f}` ج.م | *الخروج:* `{exit_p:.3f}` ج.م",
            f"  • *مدة الاحتفاظ:* `{days}` جلسات",
            f"  • *سبب الإغلاق:* {reason}",
            ""
        ])

    lines.extend([
        "━━━━━━━━━━━━━━━━━━━━",
        f"🔗 *سجل الصفقات والتقويم:* {web_origin}/?tab=short_swings"
    ])

    return "\n".join(lines)


def build_free_exit_message(exits: List[Dict[str, Any]], as_of_date: str, web_origin: str) -> str:
    """Format closed trade recap for the Free channel to build credibility."""
    winning_exits = [e for e in exits if e.get("return_pct", 0) > 0]
    if not winning_exits:
        return ""

    lines = [
        "🎯 *إغلاق صفقات مضاربة رابحة اليوم (نظام ⚡ PRO)*",
        f"📅 جلسة: `{as_of_date}`",
        "━━━━━━━━━━━━━━━━━━━━"
    ]

    for e in winning_exits[:3]:
        sym = e.get("symbol", "")
        name = e.get("name_ar", sym)
        ret = e.get("return_pct", 0.0)
        days = e.get("holding_days", 1)
        lines.append(f"✅ *{name}* (`{sym}`): حقق `+{ret:.1f}%` خلال `{days}` جلسات تداول فقط!")

    lines.extend([
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "تصل كافة التنبيهات لحظياً في الجلسة لمشتركي VIP لمواكبة طفرات الأسهم فور انطلاقها.",
        f"🔗 *انضم لقناة VIP:* {web_origin}/pricing"
    ])

    return "\n".join(lines)


def run_daily_short_swings(trigger: str = "manual", dry_run: bool = False) -> Dict[str, Any]:
    """
    Main entry point for EOD daily execution:
    1. Computes all active & closed short swings.
    2. Identifies new entries and exits for today's session.
    3. Sends Telegram alerts to VIP & Free channels.
    """
    print("\n[SHORT_SWINGS_DAILY] Calculating short swings for EGX market...")
    swings = compute_short_swings()
    active_trades = swings.get("active_trades", [])
    closed_trades = swings.get("closed_trades", [])
    as_of = swings.get("as_of") or dt.datetime.now(ZoneInfo("Africa/Cairo")).strftime("%Y-%m-%d")
    web_origin = get_web_origin()

    sb = _get_supabase_client()
    state = _get_sent_cache_state(sb, as_of)
    sent_entries = set(state.get("sent_entries", []))
    sent_exits = set(state.get("sent_exits", []))

    # 1. Identify newly triggered pending entries for TOMORROW'S session that haven't been alerted yet
    # These are high-priority pre-market swing signals generated at today's close.
    new_entries = [
        t for t in active_trades
        if t.get("is_pending_entry") and t.get("symbol") not in sent_entries
    ]

    # If no pending entry flag, fall back to today's entry_date
    if not new_entries:
        new_entries = [
            t for t in active_trades
            if t.get("entry_date") == as_of and t.get("symbol") not in sent_entries
        ]

    # If manual trigger test with no fresh alerts, pick latest 1-2 active unalerted
    if not new_entries and trigger == "manual":
        new_entries = [t for t in active_trades if t.get("symbol") not in sent_entries][:2]

    # 2. Identify exits closed today
    recent_exits = [
        e for e in closed_trades
        if e.get("exit_date") == as_of and f"{e.get('symbol')}_{e.get('exit_date')}" not in sent_exits
    ]

    delivery_report = {
        "as_of": as_of,
        "total_active": len(active_trades),
        "total_closed": len(closed_trades),
        "new_entries_count": len(new_entries),
        "recent_exits_count": len(recent_exits),
        "vip_entries_sent": False,
        "free_entries_sent": False,
        "vip_exits_sent": False,
        "free_exits_sent": False
    }

    print(f"[SHORT_SWINGS_DAILY] Found {len(new_entries)} new entries and {len(recent_exits)} new exits as of {as_of}.")

    if dry_run:
        print("[SHORT_SWINGS_DAILY] Dry run enabled; skipping Telegram notifications.")
        return {"success": True, "message": f"Dry run: {len(new_entries)} entries, {len(recent_exits)} exits", "report": delivery_report}

    from api.daily_bot_run import _notify_vip_telegram, _notify_free_telegram, _telegram_recommendation_writes_enabled

    if not _telegram_recommendation_writes_enabled():
        print("[SHORT_SWINGS_DAILY] Telegram recommendation writes are disabled.")
        return {"success": True, "message": "Telegram writes disabled", "report": delivery_report}

    # Dispatch New Entries
    if new_entries:
        vip_msg = build_vip_entry_message(new_entries, as_of, web_origin)
        free_msg = build_free_entry_message(new_entries, as_of, web_origin)

        try:
            vip_outcome = _notify_vip_telegram(vip_msg, "short_swings_vip_entry")
            delivery_report["vip_entries_sent"] = bool(vip_outcome)
            print(f"[SHORT_SWINGS_DAILY] VIP entry notification: {'Sent' if vip_outcome else 'Failed'}")
        except Exception as e:
            print(f"[SHORT_SWINGS_DAILY] Failed to send VIP entries: {e}")

        try:
            free_outcome = _notify_free_telegram(free_msg, "short_swings_free_teaser")
            delivery_report["free_entries_sent"] = bool(free_outcome)
            print(f"[SHORT_SWINGS_DAILY] Free teaser notification: {'Sent' if free_outcome else 'Failed'}")
        except Exception as e:
            print(f"[SHORT_SWINGS_DAILY] Failed to send Free entries teaser: {e}")

        # Update sent cache
        for t in new_entries:
            sent_entries.add(t.get("symbol"))

    # Dispatch Exits
    if recent_exits:
        vip_exit_msg = build_vip_exit_message(recent_exits, as_of, web_origin)
        free_exit_msg = build_free_exit_message(recent_exits, as_of, web_origin)

        try:
            vip_exit_outcome = _notify_vip_telegram(vip_exit_msg, "short_swings_vip_exit")
            delivery_report["vip_exits_sent"] = bool(vip_exit_outcome)
        except Exception as e:
            print(f"[SHORT_SWINGS_DAILY] Failed to send VIP exits: {e}")

        if free_exit_msg:
            try:
                free_exit_outcome = _notify_free_telegram(free_exit_msg, "short_swings_free_exit")
                delivery_report["free_exits_sent"] = bool(free_exit_outcome)
            except Exception as e:
                print(f"[SHORT_SWINGS_DAILY] Failed to send Free exits: {e}")

        for e in recent_exits:
            sent_exits.add(f"{e.get('symbol')}_{e.get('exit_date')}")

    # Persist updated sent state
    _save_sent_cache_state(sb, as_of, {
        "sent_entries": list(sent_entries),
        "sent_exits": list(sent_exits),
        "last_updated": dt.datetime.utcnow().isoformat()
    })

    return {
        "success": True,
        "message": f"Processed short swings: {len(new_entries)} new, {len(recent_exits)} exits",
        "count": len(new_entries) + len(recent_exits),
        "report": delivery_report
    }


if __name__ == "__main__":
    res = run_daily_short_swings(trigger="manual", dry_run=True)
    print("Execution result:", res)
