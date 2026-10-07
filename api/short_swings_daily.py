"""
Daily Short Swings Automation & Telegram Dispatch Module
Coordinates EOD short swings computation and dual-channel Telegram publishing:
- VIP Channel: Complete, unmasked trade alerts with entry prices, -4% stop loss, breakeven lock, and EMA10 trailing stops.
- Free Channel: Masked teaser alerts highlighting institutional volume surges and sectors with PRO upgrade links.
- Verified Outbox Receipts: Atomic, per-channel receipt tracking ensuring failed notifications can be retried without duplicate broadcasts.
"""
import os
import sys
import json
import datetime as dt
from typing import Dict, List, Any, Optional, Set
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
    """Retrieve verified delivery history for short swings to avoid double-posting."""
    empty_state = {"sent_entries": {}, "sent_exits": {}, "last_updated": None}
    if not sb:
        return empty_state
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
            payload = row["payload"]
            # Backwards compatibility: convert legacy lists to dictionaries
            entries = payload.get("sent_entries", {})
            if isinstance(entries, list):
                entries = {sym: {"vip": True, "free": True} for sym in entries}
            exits = payload.get("sent_exits", {})
            if isinstance(exits, list):
                exits = {k: {"vip": True, "free": True} for k in exits}
            return {
                "sent_entries": entries,
                "sent_exits": exits,
                "last_updated": payload.get("last_updated")
            }
    except Exception as e:
        print(f"[SHORT_SWINGS_DAILY] Failed to fetch sent cache: {e}")
    return empty_state


def _save_sent_cache_state(sb, as_of_date: str, state: Dict[str, Any]):
    if not sb:
        return
    try:
        sb.table("market_cache").upsert({
            "cache_key": f"short_swings_sent_{as_of_date}",
            "country": "Egypt",
            "payload": state,
            "computed_at": dt.datetime.now(dt.timezone.utc).isoformat()
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
        close_ref = float(t.get("reference_close") or t.get("entry_price") or t.get("current_price") or 0.0)
        sl_price = float(t.get("stop_loss") or t.get("trailing_stop") or (close_ref * 0.96))
        sl_pct = ((sl_price / close_ref) - 1.0) * 100.0 if close_ref > 0 else -4.0
        sig_type = t.get("trigger_type", "اختراق قمة 20 جلسة مع انفجار سيولة")
        sector = t.get("sector", "عام")

        lines.extend([
            f"🔹 *{name}* (`{sym}`) — قطاع {sector}",
            f"  • *سعر الإغلاق المرجعي:* `{close_ref:.2f}` ج.م",
            f"  • *نقطة الدخول المقترحة:* مع افتتاح جلسة الغد (شرط عدم الافتتاح بفجوة صاعدة > 2.0%)",
            f"  • *وقف الخسارة الصارم:* `{sl_price:.2f}` ج.م (`{sl_pct:.1f}%` من الإغلاق)",
            f"  • *تأمين الصفقة (Breakeven):* عند وصول السعر إلى `+{close_ref * 1.045:.2f}` ج.م (+4.5%) يُرفع الوقف لنقطة الدخول بدءاً من الجلسة التالية.",
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
        days = e.get("sessions") or e.get("holding_days") or 1
        reason = e.get("exit_reason") or e.get("reason") or "إغلاق حسب الخطة"
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
        days = e.get("sessions") or e.get("holding_days") or 1
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
    3. Sends Telegram alerts to VIP & Free channels with verified receipt tracking.
    """
    print("\n[SHORT_SWINGS_DAILY] Calculating short swings for EGX market...")
    swings = compute_short_swings()
    active_trades = swings.get("active_trades", [])
    closed_trades = swings.get("closed_trades", [])
    as_of = swings.get("as_of") or dt.datetime.now(ZoneInfo("Africa/Cairo")).strftime("%Y-%m-%d")
    web_origin = get_web_origin()

    sb = _get_supabase_client()
    state = _get_sent_cache_state(sb, as_of)
    sent_entries = dict(state.get("sent_entries", {}))
    sent_exits = dict(state.get("sent_exits", {}))

    # Identify pending entries for tomorrow
    candidate_entries = [
        t for t in active_trades
        if t.get("is_pending_entry")
    ]
    if not candidate_entries:
        candidate_entries = [
            t for t in active_trades
            if t.get("entry_date") == as_of
        ]
    if not candidate_entries and trigger == "manual":
        candidate_entries = active_trades[:2]

    # Partition entries by channel necessity
    vip_entries_to_send = [
        t for t in candidate_entries
        if not sent_entries.get(t.get("symbol", ""), {}).get("vip", False)
    ]
    free_entries_to_send = [
        t for t in candidate_entries
        if not sent_entries.get(t.get("symbol", ""), {}).get("free", False)
    ]

    # Exits closed today
    candidate_exits = [
        e for e in closed_trades
        if e.get("exit_date") == as_of
    ]
    vip_exits_to_send = [
        e for e in candidate_exits
        if not sent_exits.get(f"{e.get('symbol')}_{e.get('exit_date')}", {}).get("vip", False)
    ]
    free_exits_to_send = [
        e for e in candidate_exits
        if not sent_exits.get(f"{e.get('symbol')}_{e.get('exit_date')}", {}).get("free", False)
    ]

    delivery_report = {
        "as_of": as_of,
        "total_active": len(active_trades),
        "total_closed": len(closed_trades),
        "vip_entries_count": len(vip_entries_to_send),
        "free_entries_count": len(free_entries_to_send),
        "vip_exits_count": len(vip_exits_to_send),
        "free_exits_count": len(free_exits_to_send),
        "vip_entries_sent": False,
        "free_entries_sent": False,
        "vip_exits_sent": False,
        "free_exits_sent": False,
        "failures": []
    }

    print(f"[SHORT_SWINGS_DAILY] Actionable: VIP entries={len(vip_entries_to_send)}, Free entries={len(free_entries_to_send)}, VIP exits={len(vip_exits_to_send)}, Free exits={len(free_exits_to_send)} as of {as_of}.")

    if dry_run:
        print("[SHORT_SWINGS_DAILY] Dry run enabled; skipping Telegram notifications.")
        return {
            "success": True,
            "status": "dry_run",
            "message": f"Dry run: {len(vip_entries_to_send)} VIP entries, {len(vip_exits_to_send)} VIP exits",
            "report": delivery_report
        }

    from api.daily_bot_run import _notify_vip_telegram, _notify_free_telegram, _telegram_recommendation_writes_enabled

    if not _telegram_recommendation_writes_enabled():
        print("[SHORT_SWINGS_DAILY] Telegram recommendation writes are disabled.")
        return {
            "success": True,
            "status": "disabled",
            "message": "Telegram writes disabled",
            "report": delivery_report
        }

    has_attempted_sends = False
    all_sends_succeeded = True
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    # 1. Dispatch VIP Entries
    if vip_entries_to_send:
        has_attempted_sends = True
        vip_msg = build_vip_entry_message(vip_entries_to_send, as_of, web_origin)
        try:
            vip_outcome = bool(_notify_vip_telegram(vip_msg, "short_swings_vip_entry"))
            delivery_report["vip_entries_sent"] = vip_outcome
            if vip_outcome:
                for t in vip_entries_to_send:
                    sym = t.get("symbol", "")
                    entry_rec = sent_entries.setdefault(sym, {"vip": False, "free": False, "date": as_of})
                    entry_rec["vip"] = True
                    entry_rec["vip_sent_at"] = now_iso
                print(f"[SHORT_SWINGS_DAILY] VIP entries successfully broadcasted ({len(vip_entries_to_send)}).")
            else:
                all_sends_succeeded = False
                delivery_report["failures"].append("vip_entries")
                print("[SHORT_SWINGS_DAILY] VIP entries delivery failed.")
        except Exception as e:
            all_sends_succeeded = False
            delivery_report["failures"].append(f"vip_entries_exc: {e}")
            print(f"[SHORT_SWINGS_DAILY] Exception broadcasting VIP entries: {e}")

    # 2. Dispatch Free Entries Teaser
    if free_entries_to_send:
        has_attempted_sends = True
        free_msg = build_free_entry_message(free_entries_to_send, as_of, web_origin)
        try:
            free_outcome = bool(_notify_free_telegram(free_msg, "short_swings_free_teaser"))
            delivery_report["free_entries_sent"] = free_outcome
            if free_outcome:
                for t in free_entries_to_send:
                    sym = t.get("symbol", "")
                    entry_rec = sent_entries.setdefault(sym, {"vip": False, "free": False, "date": as_of})
                    entry_rec["free"] = True
                    entry_rec["free_sent_at"] = now_iso
                print(f"[SHORT_SWINGS_DAILY] Free entries teaser successfully broadcasted ({len(free_entries_to_send)}).")
            else:
                all_sends_succeeded = False
                delivery_report["failures"].append("free_entries")
                print("[SHORT_SWINGS_DAILY] Free entries teaser delivery failed.")
        except Exception as e:
            all_sends_succeeded = False
            delivery_report["failures"].append(f"free_entries_exc: {e}")
            print(f"[SHORT_SWINGS_DAILY] Exception broadcasting Free entries: {e}")

    # 3. Dispatch VIP Exits
    if vip_exits_to_send:
        has_attempted_sends = True
        vip_exit_msg = build_vip_exit_message(vip_exits_to_send, as_of, web_origin)
        try:
            vip_exit_outcome = bool(_notify_vip_telegram(vip_exit_msg, "short_swings_vip_exit"))
            delivery_report["vip_exits_sent"] = vip_exit_outcome
            if vip_exit_outcome:
                for e in vip_exits_to_send:
                    k = f"{e.get('symbol')}_{e.get('exit_date')}"
                    exit_rec = sent_exits.setdefault(k, {"vip": False, "free": False, "date": as_of})
                    exit_rec["vip"] = True
                    exit_rec["vip_sent_at"] = now_iso
                print(f"[SHORT_SWINGS_DAILY] VIP exits successfully broadcasted ({len(vip_exits_to_send)}).")
            else:
                all_sends_succeeded = False
                delivery_report["failures"].append("vip_exits")
                print("[SHORT_SWINGS_DAILY] VIP exits delivery failed.")
        except Exception as e:
            all_sends_succeeded = False
            delivery_report["failures"].append(f"vip_exits_exc: {e}")
            print(f"[SHORT_SWINGS_DAILY] Exception broadcasting VIP exits: {e}")

    # 4. Dispatch Free Exits Recap
    if free_exits_to_send:
        free_exit_msg = build_free_exit_message(free_exits_to_send, as_of, web_origin)
        if free_exit_msg:
            has_attempted_sends = True
            try:
                free_exit_outcome = bool(_notify_free_telegram(free_exit_msg, "short_swings_free_exit"))
                delivery_report["free_exits_sent"] = free_exit_outcome
                if free_exit_outcome:
                    for e in free_exits_to_send:
                        k = f"{e.get('symbol')}_{e.get('exit_date')}"
                        exit_rec = sent_exits.setdefault(k, {"vip": False, "free": False, "date": as_of})
                        exit_rec["free"] = True
                        exit_rec["free_sent_at"] = now_iso
                    print(f"[SHORT_SWINGS_DAILY] Free exits recap successfully broadcasted.")
                else:
                    all_sends_succeeded = False
                    delivery_report["failures"].append("free_exits")
                    print("[SHORT_SWINGS_DAILY] Free exits delivery failed.")
            except Exception as e:
                all_sends_succeeded = False
                delivery_report["failures"].append(f"free_exits_exc: {e}")
                print(f"[SHORT_SWINGS_DAILY] Exception broadcasting Free exits: {e}")

    # Persist updated sent state ONLY with verified receipts
    _save_sent_cache_state(sb, as_of, {
        "sent_entries": sent_entries,
        "sent_exits": sent_exits,
        "last_updated": dt.datetime.now(dt.timezone.utc).isoformat()
    })

    overall_success = all_sends_succeeded if has_attempted_sends else True
    status = "completed" if (has_attempted_sends and all_sends_succeeded) else ("partial" if (has_attempted_sends and not all_sends_succeeded) else "noop")

    return {
        "success": overall_success,
        "status": status,
        "message": f"Processed short swings (status={status}): {len(vip_entries_to_send)} VIP entries, {len(vip_exits_to_send)} VIP exits",
        "count": len(vip_entries_to_send) + len(vip_exits_to_send),
        "report": delivery_report
    }


if __name__ == "__main__":
    res = run_daily_short_swings(trigger="manual", dry_run=True)
    print("Execution result:", res)
