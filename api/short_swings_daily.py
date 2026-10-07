"""
Daily Short Swings Automation & Telegram Dispatch Module
Coordinates EOD short swings computation and dual-channel Telegram publishing:
- VIP Channel: Complete, unmasked trade alerts with entry prices, -4% initial stop, breakeven lock, and EMA10 trailing stops.
- Free Channel: Masked teaser alerts highlighting institutional volume surges and sectors with PRO upgrade links.
- Durable per-signal/channel claims: confirmed failures retry; uncertain delivery remains held for review.
"""
import os
import sys
import json
import threading
import datetime as dt
from typing import Dict, List, Any, Optional, Set
from zoneinfo import ZoneInfo

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api.short_swings_engine import compute_short_swings
from api.web_origin import get_web_origin


# A daily run must have one publisher in this process.  Without a guard, two
# scheduler retries can both read an empty sent-cache and broadcast duplicates.
_DELIVERY_LOCK = threading.Lock()
_RECOVERY_DONE = set()


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
        raise RuntimeError("Cannot read legacy short-swings delivery history") from e
    return empty_state


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
        # For an active trade, trailing_stop is the current executable level;
        # stop_loss remains the original -4% risk reference.
        sl_price = float(t.get("trailing_stop") or t.get("stop_loss") or (close_ref * 0.96))
        sl_pct = ((sl_price / close_ref) - 1.0) * 100.0 if close_ref > 0 else -4.0
        sig_type = t.get("trigger_type", "اختراق قمة 20 جلسة مع انفجار سيولة")
        sector = t.get("sector", "عام")

        lines.extend([
            f"🔹 *{name}* (`{sym}`) — قطاع {sector}",
            f"  • *سعر الإغلاق المرجعي:* `{close_ref:.2f}` ج.م",
            f"  • *نقطة الدخول المقترحة:* مع افتتاح جلسة الغد (شرط عدم الافتتاح بفجوة صاعدة > 2.0%)",
            f"  • *الوقف الحالي:* `{sl_price:.2f}` ج.م (`{sl_pct:.1f}%` من الإغلاق) | الوقف المبدئي -4%",
            f"  • *تأمين الصفقة (Breakeven):* عند وصول السعر إلى `+{close_ref * 1.045:.2f}` ج.م (+4.5%) يُرفع الوقف لنقطة الدخول بدءاً من الجلسة التالية.",
            f"  • *استراتيجية جني الأرباح:* الوقف يتبع متوسط `EMA10` يومياً لركوب كامل الموجة 🚀",
            f"  • *النموذج الفني:* {sig_type}",
            ""
        ])

    lines.extend([
        "━━━━━━━━━━━━━━━━━━━━",
        f"🔗 *متابعة الإشارات الحية ولوحة التقويم:*",
        f"{web_origin}/scanner/backtests?tab=short_swings",
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
        f"🔗 *سجل الصفقات والتقويم:* {web_origin}/scanner/backtests?tab=short_swings"
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


def build_vip_update_message(trades, as_of_date, web_origin):
    lines = ["📊 *متابعة الصفقات القصيرة ⚡ PRO*", f"📅 بيانات جلسة: `{as_of_date}`", "━━━━━━━━━━━━━━━━━━━━"]
    for trade in trades:
        lines.extend([f"🔹 *{trade.get('name_ar') or trade.get('symbol')}* (`{trade.get('symbol')}`)",
                      f"• السعر المسجل: `{float(trade.get('current_price') or 0):.3f}` ج.م",
                      f"• دخول النموذج: `{float(trade.get('entry_price') or 0):.3f}` ج.م",
                      f"• الوقف الحالي: `{float(trade.get('trailing_stop') or trade.get('stop_loss') or 0):.3f}` ج.م",
                      f"• الحالة: {trade.get('status') or 'قيد المتابعة'}", ""])
    lines.extend([f"🔗 {web_origin}/scanner/backtests?tab=short_swings",
                  "⚠️ متابعة نموذجية بآخر بيانات متاحة، وليست تأكيد تنفيذ فعلي. التزم بالوقف وإدارة المخاطر."])
    return "\n".join(lines)


def _delivery_key(as_of, kind, trade, channel, phase="close"):
    import hashlib
    identity = (f"{trade.get('symbol')}_{trade.get('entry_date')}_{trade.get('exit_date')}"
                if kind == "exit" else trade.get("signal_id") or f"{trade.get('symbol')}_{as_of}")
    if kind == "update":
        identity = f"{identity}:{phase}"
    digest = hashlib.sha256(f"{as_of}:{kind}:{identity}:{channel}".encode()).hexdigest()
    return f"short_swing_delivery_{digest}"


def _dispatch_trade(sb, trade, kind, channel, as_of, legacy_state, phase="close"):
    """One durable claim, one signal, one channel. Uncertain sends never retry."""
    from api.daily_recovery_state import read_checkpoint, replace_checkpoint, utc_now
    from api.daily_bot_run import _notify_vip_telegram, _notify_free_telegram
    sent_bucket = legacy_state.get("sent_exits" if kind == "exit" else "sent_entries", {})
    legacy_key = f"{trade.get('symbol')}_{trade.get('exit_date')}" if kind == "exit" else trade.get("symbol")
    if kind != "update" and sent_bucket.get(legacy_key, {}).get(channel):
        return "sent"  # Legacy history suppresses resends; it is not a new receipt.
    key = _delivery_key(as_of, kind, trade, channel, phase)
    old = read_checkpoint(sb, key)
    previous = (old or {}).get("payload") or {}
    status = previous.get("status")
    if status in {"sent", "skipped", "ambiguous", "dispatching"}:
        return "ambiguous" if status == "dispatching" else status
    if previous.get("attempts", 0) >= 4:
        return "failed"
    builders = {("entry", "vip"): build_vip_entry_message, ("entry", "free"): build_free_entry_message,
                ("exit", "vip"): build_vip_exit_message, ("exit", "free"): build_free_exit_message,
                ("update", "vip"): build_vip_update_message}
    message = previous.get("message") or builders[(kind, channel)]([trade], as_of, get_web_origin())
    payload = {**previous, "status": "dispatching", "message": message,
               "attempts": previous.get("attempts", 0) + 1, "as_of": as_of,
               "channel": channel, "kind": kind, "started_at": utc_now().isoformat()}
    if not message:
        payload["status"] = "skipped"
    claimed = replace_checkpoint(sb, key, payload, old)
    if not claimed:
        return "ambiguous"  # Lost claim/response means no send permission.
    if not message:
        return "skipped"
    service = {("entry", "vip"): "short_swings_vip_entry", ("entry", "free"): "short_swings_free_teaser",
               ("exit", "vip"): "short_swings_vip_exit", ("exit", "free"): "short_swings_free_exit",
               ("update", "vip"): "short_swings_vip_update"}[(kind, channel)]
    try:
        sender = _notify_vip_telegram if channel == "vip" else _notify_free_telegram
        outcome = sender(message, service, managed_delivery=True)
        receipts = getattr(outcome, "receipts", [])
        error = getattr(outcome, "error", None) or {}
        if bool(outcome) and receipts:
            status = "sent"
            if kind == 'entry':
                from api.short_swing_published import record_published_signal
                record_published_signal(sb, trade, {'channel': channel, 'receipts': receipts, 'as_of': as_of})
        elif not receipts and error.get("error_code") in {400, 401, 403, 404, 429}:
            status = "failed"  # An explicit rejected API request is safe to retry.
        else:
            status = "ambiguous"  # Timeout, transport, partial delivery or missing receipt.
        payload.update(status=status, receipts=receipts, error=error)
    except Exception as error:
        status = "ambiguous"
        payload.update(status=status, error={"description": type(error).__name__})
    if not replace_checkpoint(sb, key, payload, claimed):
        return "ambiguous"
    return status


def _run_daily_short_swings(trigger="manual", dry_run=False, phase="close", job_run_id=None):
    from api.daily_recovery_state import read_checkpoint, replace_checkpoint, utc_now, parse_timestamp
    from api.daily_bot_run import _telegram_recommendation_writes_enabled
    if phase not in {"midday", "close"}:
        raise ValueError("Invalid short-swings phase")
    as_of = dt.datetime.now(ZoneInfo("Africa/Cairo")).date().isoformat()
    sb = _get_supabase_client()
    if not sb and not dry_run:
        return {"success": False, "status": "checkpoint_unavailable", "message": "Delivery checkpoint unavailable"}
    key = f"short_swings_run_{as_of}_{phase}"
    claimed = None
    payload = {}
    if not dry_run:
        old = read_checkpoint(sb, key)
        payload = (old or {}).get("payload") or {}
        if payload.get("status") == "completed":
            _RECOVERY_DONE.add(key)
            return {"success": True, "status": "noop", "message": "This short-swings phase already completed", "count": 0}
        _RECOVERY_DONE.discard(key)
        now = utc_now()
        last_start = parse_timestamp(payload.get("started_at"))
        retry_at = parse_timestamp(payload.get("retry_at"))
        if ((payload.get("status") == "running" and last_start and now - last_start < dt.timedelta(minutes=45))
                or (retry_at and now < retry_at) or payload.get("attempts", 0) >= 4):
            return {"success": False, "status": "waiting", "message": "Short-swings attempt running, backing off or exhausted"}
        payload = {**payload, "status": "running", "attempts": payload.get("attempts", 0) + 1,
                   "started_at": now.isoformat(), "phase": phase, "as_of": as_of,
                   "job_run_id": payload.get("job_run_id") or job_run_id}
        claimed = replace_checkpoint(sb, key, payload, old)
        if not claimed:
            return {"success": False, "status": "already_running", "message": "Another short-swings worker owns the attempt"}
    try:
        swings = payload.get("swings") or compute_short_swings(phase=phase)
        if swings.get("status") != "ok" or swings.get("as_of") != as_of or swings.get("phase") != phase:
            raise ValueError("Current-session short-swings snapshot is not ready")
        entries = [trade for trade in swings.get("active_trades", [])
                   if phase == "close" and trade.get("is_pending_entry") and trade.get("signal_date") == as_of]
        updates = [trade for trade in swings.get("active_trades", [])
                   if not trade.get("is_pending_entry") and trade.get("price_date") == as_of
                   and trade.get("current_price") is not None]
        exits = [trade for trade in swings.get("closed_trades", []) if trade.get("exit_date") == as_of]
        if dry_run:
            return {"success": True, "status": "dry_run", "message": "Dry run; no delivery", "count": len(entries) + len(exits)}
        # Store the exact calculation once. Retries deliver this snapshot rather
        # than regenerating a different message or running the whole daily job.
        payload["swings"] = swings
        saved = replace_checkpoint(sb, key, payload, claimed)
        if not saved:
            return {"success": False, "status": "checkpoint_unavailable", "message": "Cannot persist short-swings snapshot"}
        claimed = saved
        # Persist the complete display snapshot independently of Telegram
        # delivery. HF rebuilds can restore it without replaying history.
        display_row = read_checkpoint(sb, "short_swings_latest")
        display = ((display_row or {}).get("payload") or {}).get("swings") or {}
        display_version = (display.get("as_of") or "", display.get("computed_at") or "")
        version = (swings.get("as_of") or "", swings.get("computed_at") or "")
        if version >= display_version:
            if not replace_checkpoint(sb, "short_swings_latest", {"swings": swings}, display_row):
                raise RuntimeError("Cannot persist shared short-swings display snapshot")
            from api.cache_invalidation import invalidate_cache_tags, TAG_SHORT_SWINGS
            invalidated = invalidate_cache_tags([TAG_SHORT_SWINGS])
            if invalidated.get("error"):
                raise RuntimeError("Short-swings display cache invalidation failed")
        if not _telegram_recommendation_writes_enabled() and (entries or exits or updates):
            raise RuntimeError("Telegram recommendation writes are disabled")
        legacy_state = _get_sent_cache_state(sb, as_of)
        states = []
        delivery_report = {"as_of": as_of, "failures": [], "vip_entries_sent": False,
                           "free_entries_sent": False, "vip_exits_sent": False, "free_exits_sent": False}
        receipt_groups = {}
        for kind, trades in (("entry", entries), ("exit", exits), ("update", updates)):
            for trade in trades:
                for channel in (("vip",) if kind == "update" else ("vip", "free")):
                    delivery_state = _dispatch_trade(sb, trade, kind, channel, as_of, legacy_state, phase)
                    states.append(delivery_state)
                    if kind != "update":
                        report_key = f"{channel}_{'entries' if kind == 'entry' else 'exits'}_sent"
                        receipt_groups.setdefault(report_key, []).append(delivery_state)
        delivery_report.update({name: all(state == "sent" for state in group)
                                for name, group in receipt_groups.items()})
        failures = [state for state in states if state not in {"sent", "skipped"}]
        payload.update(status="partial" if failures else "completed", delivery_states=states,
                       retry_at=(utc_now() + dt.timedelta(minutes=15)).isoformat(),
                       completed_at=utc_now().isoformat(), error=", ".join(failures) or None)
        if not replace_checkpoint(sb, key, payload, claimed):
            raise RuntimeError("Cannot confirm short-swings completion checkpoint")
        if not failures:
            _RECOVERY_DONE.add(key)
        return {"success": not failures, "status": payload["status"],
                "message": f"Short swings {phase}: {len(entries)} entries, {len(exits)} exits, {len(updates)} updates; " + (", ".join(failures) or "completed"),
                "count": len(entries) + len(exits), "report": {**delivery_report, "failures": failures}}
    except Exception as error:
        if claimed:
            payload.update(status="failed", error=str(error)[:400],
                           retry_at=(utc_now() + dt.timedelta(minutes=15)).isoformat())
            replace_checkpoint(sb, key, payload, claimed)
        return {"success": False, "status": "failed", "message": str(error)[:400], "report": {"failures": [str(error)[:400]]}}


def run_daily_short_swings(trigger="manual", dry_run=False, phase="close", job_run_id=None):
    """A phase must complete durably; known failures resume on bounded retries."""
    if not _DELIVERY_LOCK.acquire(blocking=False):
        return {"success": False, "status": "already_running", "message": "Short swings already running"}
    try:
        return _run_daily_short_swings(trigger=trigger, dry_run=dry_run, phase=phase, job_run_id=job_run_id)
    except Exception as error:
        return {"success": False, "status": "checkpoint_unavailable", "message": type(error).__name__}
    finally:
        _DELIVERY_LOCK.release()


def retry_incomplete_short_swings(phase):
    """Only an existing current-session attempt is eligible, never an old date."""
    from api.daily_recovery_state import read_checkpoint
    as_of = dt.datetime.now(ZoneInfo("Africa/Cairo")).date().isoformat()
    key = f"short_swings_run_{as_of}_{phase}"
    if key in _RECOVERY_DONE:
        return None
    sb = _get_supabase_client()
    row = read_checkpoint(sb, key)
    job_id = (row or {}).get("payload", {}).get("job_run_id")
    if row and row.get("payload", {}).get("status") == "completed":
        _RECOVERY_DONE.add(key)
        return None
    if not row:
        # Upgrade recovery: today's older daily job may have failed before this
        # ledger existed. Resume only a recorded short failure with good prices.
        start = dt.datetime.fromisoformat(as_of).replace(tzinfo=ZoneInfo("Africa/Cairo"))
        jobs = (sb.table("daily_job_runs").select("id,status,steps")
                .eq("job_type", "daily_midday" if phase == "midday" else "daily_bot")
                .gte("started_at", start.astimezone(dt.timezone.utc).isoformat())
                .lt("started_at", (start + dt.timedelta(days=1)).astimezone(dt.timezone.utc).isoformat())
                .order("started_at", desc=True).limit(1).execute())
        record = (jobs.data or [None])[0]
        steps = (record or {}).get("steps") or []
        if isinstance(steps, str):
            steps = json.loads(steps)
        latest = {step.get("step"): step.get("status") for step in steps}
        if (not record or record.get("status") == "running" or latest.get("sync_prices") != "success"
                or latest.get("short_swings_daily") not in {"failed", "started"}):
            # Stop checking a terminal healthy/not-eligible phase in this process.
            if not record or record.get("status") != "running":
                _RECOVERY_DONE.add(key)
            return None
        job_id = record["id"]
    result = run_daily_short_swings(trigger="retry", phase=phase, job_run_id=job_id)
    if result.get("success") and job_id:
        sb = _get_supabase_client()
        saved = sb.table("daily_job_runs").select("steps,status").eq("id", job_id).limit(1).execute()
        if saved.data and saved.data[0].get("status") != "running":
            from api.daily_job_outcome import summarise_daily_steps
            steps = saved.data[0].get("steps") or []
            if isinstance(steps, str):
                steps = json.loads(steps)
            steps.append({"step": "short_swings_daily", "status": "success", "count": result.get("count", 0),
                          "details": "Recovered by bounded short-only retry", "sequence": len(steps) + 1,
                          "timestamp": dt.datetime.now(dt.timezone.utc).isoformat()})
            sb.table("daily_job_runs").update({"steps": json.dumps(steps),
                "error": summarise_daily_steps(steps)["error"]}).eq("id", job_id).eq("status", saved.data[0]["status"]).execute()
    return result
