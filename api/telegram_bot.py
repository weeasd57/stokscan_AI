import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
from datetime import datetime
from typing import Any, Optional

import requests

# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("telegram").setLevel(logging.WARNING)


class TelegramBot:
    """Telegram bot bridge — 100 % `requests`-based, zero httpx.

    Supports two modes:
    1. Webhook mode  — when WEBHOOK_URL env var is set (production / HF Spaces)
    2. Long-Polling  — when WEBHOOK_URL is NOT set (local development)
    """

    # Telegram API — use TELEGRAM_RELAY_URL (Supabase Edge Function) when available
    # to bypass HF Spaces network restrictions that block api.telegram.org outbound
    _DIRECT_API = "https://api.telegram.org"
    DEFAULT_CHANNEL_ID = "-1002083067817"
    DEFAULT_THREAD_ID = 153
    LEGACY_BAD_CHAT_IDS = {"-1003699330518"}

    @property
    def API(self) -> str:
        relay = os.getenv("TELEGRAM_RELAY_URL", "").strip().rstrip("/")
        # Only use relay if it points to an external non-Telegram service
        if relay and "telegram.org" not in relay:
            return relay
        return self._DIRECT_API

    def __init__(self, token: str, bot_instance=None):
        self.token = token
        self.bot_instance = bot_instance
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self.chat_id: Optional[Any] = None
        self.bot_username: Optional[str] = None
        self._ready = False
        self._queue: deque = deque(maxlen=200)  # outbound message queue
        self._net_ok = False  # last-known network status
        self._polling = False  # True when using long-polling
        self._poll_offset = 0  # getUpdates offset
        self._load_chat_id()

    # ── helpers ──────────────────────────────────────────────────────

    def _load_chat_id(self):
        if self.bot_instance and getattr(
            self.bot_instance.config, "telegram_chat_id", None
        ):
            self.chat_id = self.bot_instance.config.telegram_chat_id
            self._log(f"Loaded chat_id from bot config: {self.chat_id}")
        else:
            env_chat_id = os.getenv("TELEGRAM_CHAT_ID")
            if env_chat_id:
                try:
                    self.chat_id = self._normalize_chat_target(env_chat_id)
                    self._log(f"Loaded chat_id from environment: {self.chat_id}")
                except Exception:
                    pass
            if not self.chat_id:
                self.chat_id = self.DEFAULT_CHANNEL_ID
                self._log(f"Loaded default fallback chat_id: {self.chat_id}")

        if str(self.chat_id).strip() in self.LEGACY_BAD_CHAT_IDS:
            self.chat_id = self.DEFAULT_CHANNEL_ID
            self._log(f"Replaced legacy bad chat_id with default channel: {self.chat_id}")

    def _normalize_chat_target(self, target: Any) -> Any:
        target_str = str(target).strip()
        if not target_str or target_str.startswith("@") or "_" in target_str:
            return target_str
        return int(float(target_str))

    def _build_send_payload(self, text: str, chat_id: Any, message_thread_id: Optional[int] = None) -> Optional[dict]:
        target_str = str(chat_id).strip()
        local_thread_id = message_thread_id

        if target_str in self.LEGACY_BAD_CHAT_IDS:
            target_str = self.DEFAULT_CHANNEL_ID

        if not target_str.startswith("@") and "_" in target_str:
            chat_part, thread_part = target_str.split("_", 1)
            target_str = chat_part
            try:
                local_thread_id = int(float(thread_part))
            except ValueError:
                pass

        if target_str == self.DEFAULT_CHANNEL_ID and local_thread_id is None:
            local_thread_id = self.DEFAULT_THREAD_ID

        payload = {"text": text}
        if local_thread_id is not None:
            payload["message_thread_id"] = local_thread_id

        if target_str.startswith("@"):
            payload["chat_id"] = target_str
            return payload

        try:
            payload["chat_id"] = int(float(target_str))
            return payload
        except ValueError:
            self._log(f"Invalid target chat ID: {chat_id}")
            return None

    def _save_chat_id(self, chat_id: int):
        self.chat_id = chat_id
        if self.bot_instance:
            self.bot_instance.config.telegram_chat_id = chat_id
            try:
                from api.live_bot import bot_manager

                bot_manager.save_bots()
            except Exception:
                pass
            self._log(f"Saved chat_id: {chat_id}")

    def _log(self, msg: str):
        try:
            print(f"[TELEGRAM] {msg}")
        except UnicodeEncodeError:
            try:
                print(
                    f"[TELEGRAM] {msg.encode('utf-8', errors='replace').decode('ascii', errors='ignore')}"
                )
            except Exception:
                pass

    def _call_api(self, method: str, payload: dict = None, timeout: int = 30) -> dict:
        """Single Telegram Bot API call — via relay or direct. No retries, fast fail."""
        api_base = self.API
        is_relay = "telegram.org" not in api_base

        try:
            if is_relay:
                # Supabase Edge Function relay: wrap token + method into body
                url = api_base
                wrapped = {"token": self.token, "method": method, **(payload or {})}
                resp = requests.post(url, json=wrapped, timeout=timeout)
            else:
                # Direct Telegram API
                url = f"{api_base}/bot{self.token}/{method}"
                resp = requests.post(url, json=payload or {}, timeout=timeout)

            data = resp.json()
            if not data.get("ok") and "description" not in data:
                data["description"] = f"HTTP {resp.status_code} — empty response"
            return data
        except requests.exceptions.Timeout:
            return {"ok": False, "description": f"Timeout after {timeout}s"}
        except requests.exceptions.ConnectionError as e:
            return {"ok": False, "description": f"ConnectionError: {e}"}
        except json.JSONDecodeError:
            return {"ok": False, "description": "Non-JSON response"}
        except Exception as e:
            return {"ok": False, "description": str(e)}

    # ── DNS fix ──────────────────────────────────────────────────────

    def _fix_telegram_dns(self):
        import socket
        import urllib.request

        def _doh(hostname):
            for api_url in [
                f"https://cloudflare-dns.com/dns-query?name={hostname}&type=A",
                f"https://dns.google/resolve?name={hostname}&type=A",
            ]:
                try:
                    req = urllib.request.Request(
                        api_url, headers={"Accept": "application/dns-json"}
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        data = json.loads(resp.read().decode())
                        for ans in data.get("Answer", []):
                            if ans.get("type") == 1:
                                return ans["data"]
                except Exception:
                    pass
            return None

        try:
            socket.gethostbyname("api.telegram.org")
            self._log("DNS OK for api.telegram.org")
        except Exception:
            self._log("Local DNS failed — trying DoH...")
            ip = _doh("api.telegram.org")
            if ip:
                self._log(f"DoH resolved -> {ip}")
                try:
                    with open("/etc/hosts", "r") as f:
                        if "api.telegram.org" not in f.read():
                            with open("/etc/hosts", "a") as fw:
                                fw.write(f"\n{ip} api.telegram.org\n")
                            self._log(f"Wrote to /etc/hosts: {ip} api.telegram.org")
                except Exception as e:
                    self._log(f"/etc/hosts write failed: {e}")

    # ── outbound messaging (queued) ──────────────────────────────────

    def send_notification(self, message: str, chat_id: Optional[Any] = None, message_thread_id: Optional[int] = None):
        """Queue a message for delivery.  Returns immediately."""
        targets = set()
        if chat_id:
            targets.add(str(chat_id).strip())
        else:
            # 1. Global chat_id (admin channel)
            if self.bot_instance and getattr(
                self.bot_instance.config, "telegram_chat_id", None
            ):
                self.chat_id = self.bot_instance.config.telegram_chat_id
            if self.chat_id:
                targets.add(str(self.chat_id).strip())

        # 2. Subscribers chat IDs (Now handled dynamically with custom TP/SL inside live_bot.py)
        # We only send the central admin-formatted logs/notifications to the admin chat
        pass

        # Send to all unique target chat IDs
        if not targets or not self.token:
            self._log("Cannot send: no targets or token.")
            return

        queued = 0
        for target in targets:
            payload = self._build_send_payload(message, target, message_thread_id)
            if payload:
                self._queue.append(payload)
                queued += 1
        self._log(
            f"Queued notification to {queued} targets ({len(self._queue)} in queue)"
        )

    def send_message_with_keyboard(
        self,
        text: str,
        chat_id: Any,
        buttons: list[list[dict]],
        parse_mode: str = None,  # Changed default to None to avoid formatting issues
        message_thread_id: Optional[int] = None
    ):
        """Queue a message with an inline keyboard markup for delivery.

        Args:
            text: The message content.
            chat_id: Telegram chat ID (integer) or channel username (e.g. '@egxbots_channel').
                     Can also be a composite ID like '-1002083067817_153' representing chat_id and message_thread_id.
            buttons: A list of rows, where each row is a list of button dicts.
                     Example: [[{"text": "Open Web", "url": "https://egxbots.com"}]]
            parse_mode: Markdown or HTML parsing mode (None for plain text).
            message_thread_id: Optional message thread/topic ID for forum/supergroups.
        """
        payload = self._build_send_payload(text, chat_id, message_thread_id)
        if not payload:
            return
        payload["reply_markup"] = {"inline_keyboard": buttons}
        if parse_mode:
            payload["parse_mode"] = parse_mode

        self._queue.append(payload)
        self._log(f"Queued keyboard message to {payload['chat_id']} (thread: {payload.get('message_thread_id')})")

    def _sender_loop(self):
        """Background loop: drain the queue whenever the network is up."""
        self._log("Sender thread started.")
        backoff = 5
        while True:
            if not self._queue:
                time.sleep(2)
                backoff = 5  # reset when idle
                continue
            # Try to send the oldest message
            payload = self._queue[0]
            result = self._call_api("sendMessage", payload)
            if result.get("ok"):
                self._queue.popleft()
                self._net_ok = True
                backoff = 5
                self._log(f"Sent to {payload['chat_id']} ({len(self._queue)} left)")
            else:
                desc = result.get('description', '')
                # If it's a Bad Request (like invalid chat_id or bad markdown format), do not retry forever!
                if "bad request" in desc.lower() or "chat not found" in desc.lower() or "can't parse entities" in desc.lower():
                    self._log(f"Permanent send failure (discarding message): {desc}")
                    # If it failed due to formatting, try as plain text
                    if ("can't parse entities" in desc.lower() or "parse_mode" in desc.lower()) and payload.get("parse_mode"):
                        self._log("Retrying message as plain text fallback...")
                        payload_plain = payload.copy()
                        payload_plain.pop("parse_mode", None)
                        # Clean up basic markdown markers
                        if "text" in payload_plain:
                            payload_plain["text"] = payload_plain["text"].replace("*", "").replace("`", "").replace("_", "").replace("[", "").replace("]", "")
                        result_plain = self._call_api("sendMessage", payload_plain)
                        if result_plain.get("ok"):
                            self._queue.popleft()
                            self._net_ok = True
                            self._log(f"Sent plain text fallback to {payload['chat_id']}")
                            continue
                    
                    self._queue.popleft()
                    backoff = 5
                else:
                    self._net_ok = False
                    self._log(
                        f"Send failed ({backoff}s backoff): {result.get('error', result.get('description', '?'))}"
                    )
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 120)  # max 2 min

    # ── long-polling loop ────────────────────────────────────────────

    def _polling_loop(self):
        """Background loop: poll getUpdates when no webhook is configured."""
        self._log("Long-polling started.")
        consecutive_errors = 0
        while self._polling:
            try:
                # Client timeout MUST be longer than the long-poll timeout
                # to avoid racing: Telegram waits up to 30s, we wait up to 35s
                result = self._call_api(
                    "getUpdates",
                    {
                        "offset": self._poll_offset,
                        "timeout": 30,
                        "allowed_updates": ["message"],
                    },
                    timeout=35,
                )
                if result.get("ok"):
                    consecutive_errors = 0
                    updates = result.get("result", [])
                    for update in updates:
                        self._poll_offset = update["update_id"] + 1
                        msg = update.get("message", {})
                        text = msg.get("text", "")
                        chat_id = msg.get("chat", {}).get("id")
                        if chat_id and text:
                            self._dispatch_command(chat_id, text, msg)
                else:
                    consecutive_errors += 1
                    err = result.get("description", result.get("error", "unknown"))
                    self._log(f"Polling error ({consecutive_errors}): {err}")
                    time.sleep(min(consecutive_errors * 2, 30))
            except Exception as e:
                consecutive_errors += 1
                self._log(f"Polling exception ({consecutive_errors}): {e}")
                time.sleep(min(consecutive_errors * 2, 30))

    # ── webhook update handling ──────────────────────────────────────

    async def handle_webhook_update(self, data: dict):
        """Process incoming update — parse JSON manually, reply via queue."""
        try:
            uid = data.get("update_id", "?")
            self._log(f"Processing update: {uid}")
            msg = data.get("message", {})
            text = msg.get("text", "")
            chat_id = msg.get("chat", {}).get("id")
            if not chat_id:
                return

            self._dispatch_command(chat_id, text, msg)
            self._log(f"Processed update: {uid}")
        except Exception as e:
            self._log(f"Webhook error: {e}")
            import traceback

            traceback.print_exc()

    def _dispatch_command(self, chat_id: int, text: str, msg: dict = None):
        """Route text commands to the correct handler."""
        if text.startswith("/start"):
            parts = text.split()
            if len(parts) > 1:
                user_id_param = parts[1].strip()
                self._handle_start_with_user_id(chat_id, user_id_param, msg)
            else:
                self._handle_start(chat_id)
        elif text.startswith("/status"):
            self._handle_status(chat_id)
        elif text.startswith("/positions"):
            self._handle_positions(chat_id)
        elif text.startswith("/trades"):
            self._handle_trades(chat_id)
        elif text.startswith("/weekly"):
            self._handle_weekly(chat_id)
        elif text.startswith("/daily"):
            self._handle_daily(chat_id)
        elif text.startswith("/help"):
            self._handle_help(chat_id)

    # ── command handlers ─────────────────────────────────────────────

    def _reply(self, chat_id, text):
        self._queue.appendleft(
            {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
        )

    def _is_admin(self, chat_id):
        # 1. Check environment variable TELEGRAM_ADMIN_CHAT_ID
        env_admin = os.getenv("TELEGRAM_ADMIN_CHAT_ID")
        if env_admin and str(chat_id) == str(self._normalize_chat_target(env_admin)):
            return True

        # 2. Check support system registered admin ID
        try:
            from api.support_chat import load_admin_chat_id
            support_admin = load_admin_chat_id()
            if support_admin and str(chat_id) == str(support_admin):
                return True
        except Exception:
            pass

        # 3. Fallback to telegram_chat_id (cleaned of thread suffix)
        admin_chat_id = None
        if self.bot_instance and getattr(
            self.bot_instance.config, "telegram_chat_id", None
        ):
            admin_chat_id = self.bot_instance.config.telegram_chat_id
        if not admin_chat_id:
            admin_chat_id = self.chat_id

        if admin_chat_id:
            admin_chat_str = str(admin_chat_id).strip()
            # Clean of thread suffix if present (e.g. -1002083067817_153 -> -1002083067817)
            if "_" in admin_chat_str:
                admin_chat_str = admin_chat_str.split("_")[0]
            if str(chat_id) == admin_chat_str:
                return True

        return False

    def _is_private_chat(self, msg: dict = None):
        chat = (msg or {}).get("chat", {})
        return chat.get("type") == "private"

    def _handle_start_with_user_id(self, chat_id, user_id_param, msg: dict = None):
        import uuid

        try:
            if not self._is_private_chat(msg):
                self._reply(
                    chat_id,
                    "❌ *لا يمكن ربط الحساب من جروب*\n\n"
                    "افتح محادثة خاصة مع البوت واضغط رابط الربط مرة أخرى\\.\n\n"
                    "❌ *Account linking must be done in a private chat*\n\n"
                    "Please open a direct chat with the bot and use the link again\\.",
                )
                return

            # Validate UUID format
            uid = str(uuid.UUID(user_id_param))
            from api.stock_ai import supabase

            if supabase:
                # Fetch user profile to get display name
                profile_res = (
                    supabase.table("profiles")
                    .select("display_name, username")
                    .eq("id", uid)
                    .maybe_single()
                    .execute()
                )
                profile = profile_res.data if (profile_res and profile_res.data) else {}
                display_name = (
                    profile.get("display_name") or profile.get("username") or "المستثمر"
                )

                # Update profiles table with telegram_chat_id
                res = (
                    supabase.table("profiles")
                    .update({"telegram_chat_id": str(chat_id)})
                    .eq("id", uid)
                    .execute()
                )
                if res.data:
                    try:
                        supabase.table("bot_subscriptions").update(
                            {"telegram_chat_id": str(chat_id)}
                        ).eq("user_id", uid).is_("telegram_chat_id", "null").execute()
                    except Exception as e:
                        self._log(f"Could not sync subscription telegram_chat_id: {e}")

                    self._reply(
                        chat_id,
                        f"🎉 *أهلاً وسهلاً، {display_name}\\!*\n\n"
                        "✅ *تم ربط حساب تليجرام بنجاح\\!*\n\n"
                        "━━━━━━━━━━━━━━━━━━━━\n"
                        "🤖 *EGX Bots* جاهز لإرسال إشارات التداول إليك فور حدوثها\\!\n\n"
                        "📊 *ستتلقى تنبيهات عن:*\n"
                        "• 🟢 إشارات الشراء الجديدة\n"
                        "• 🎯 الوصول للأهداف السعرية\n"
                        "• 🛡️ تفعيل وقف الخسارة\n\n"
                        "━━━━━━━━━━━━━━━━━━━━\n\n"
                        f"🎉 *Welcome, {display_name}\\!*\n\n"
                        "✅ *Telegram successfully linked\\!*\n\n"
                        "Your account is now connected to *EGX Bots*\\. "
                        "You'll receive real\\-time buy signals and risk alerts directly here\\.\n\n"
                        "📌 Use /help to see available commands\\.",
                    )
                else:
                    self._reply(
                        chat_id,
                        "❌ *لم يتم العثور على الحساب*\n\n"
                        "تأكد من استخدام رابط الربط الصحيح من صفحة الإعدادات في الموقع\\.\n\n"
                        "❌ *Account not found*\n\n"
                        "Please use the connection link from your profile settings page\\.",
                    )
            else:
                self._reply(
                    chat_id,
                    "❌ *خطأ في الاتصال بقاعدة البيانات*\n\n"
                    "حاول مرة أخرى بعد قليل\\.\n\n"
                    "❌ *Database connection error*\n\n"
                    "Please try again later\\.",
                )
        except ValueError:
            self._reply(
                chat_id,
                "❌ *رابط التفعيل غير صالح*\n\n"
                "يرجى الضغط على زر *CONNECT TELEGRAM BOT* في صفحة الإعدادات على الموقع\\.\n\n"
                "❌ *Invalid activation link*\n\n"
                "Please click *CONNECT TELEGRAM BOT* from your profile settings\\.",
            )
        except Exception as e:
            self._log(f"Error handling start parameter: {e}")
            self._reply(
                chat_id,
                "❌ *حدث خطأ غير متوقع*\n\n"
                "حاول مرة أخرى\\. إذا استمرت المشكلة، تواصل مع الدعم\\.\n\n"
                "❌ *Unexpected error*\n\n"
                "Please try again\\.",
            )

    def _handle_start(self, chat_id):
        self._reply(
            chat_id,
            "👋 *أهلاً بك في EGX Bots\\!*\n\n"
            "🤖 هذا البوت يرسل إشارات تداول ذكية للبورصة المصرية \\(EGX\\) مدعومة بالذكاء الاصطناعي\\.\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "🔗 *لربط حسابك:*\n"
            "اذهب إلى صفحة الإعدادات في الموقع واضغط على زر *CONNECT TELEGRAM BOT*\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            "👋 *Welcome to EGX Bots\\!*\n\n"
            "🤖 This bot delivers AI\\-powered trading signals for the Egyptian Exchange \\(EGX\\)\\.\n\n"
            "🔗 *To link your account:*\n"
            "Go to your profile settings on the website and click *CONNECT TELEGRAM BOT*\n\n"
            f"💬 *Your Chat ID:* `{chat_id}`\n"
            "_You can also enter this ID manually in your profile settings\\._",
        )

    def _handle_status(self, chat_id):
        if not self._is_admin(chat_id):
            self._reply(
                chat_id,
                "❌ Unauthorized: This command is only available for the bot administrator.",
            )
            return
        if not self.bot_instance:
            self._reply(chat_id, "Bot not available.")
            return
        st = self.bot_instance.get_status()
        bal = "N/A"
        try:
            a = self.bot_instance.api.get_account()
            bal = f"${float(a.equity):.2f} (Cash: ${float(a.cash):.2f})"
        except Exception:
            pass

        # Count Telegram subscribers from profiles
        sub_count = 0
        try:
            from api.stock_ai import supabase
            res = supabase.table("profiles").select("id", count="exact").not_.is_("telegram_chat_id", "null").neq("telegram_chat_id", "").execute()
            sub_count = res.count if hasattr(res, "count") else len(res.data or [])
        except Exception as e:
            self._log(f"Error counting subscribers: {e}")

        self._reply(
            chat_id,
            f"🤖 *Status:* {st.get('status', '?').upper()}\n"
            f"💰 *Equity:* {bal}\n"
            f"🕒 *Last Scan:* {st.get('last_scan') or 'Never'}\n"
            f"📈 *Coins:* {len(st.get('config', {}).get('coins', []))}\n"
            f"👥 *Subscribers:* `{sub_count}` users",
        )

    def _handle_positions(self, chat_id):
        if not self._is_admin(chat_id):
            self._reply(
                chat_id,
                "❌ Unauthorized: This command is only available for the bot administrator.",
            )
            return
        if not self.bot_instance or not self.bot_instance.api:
            self._reply(chat_id, "Bot API not available.")
            return
        try:
            pos = self.bot_instance.api.list_positions()
            if not pos:
                self._reply(chat_id, "No open positions.")
                return
            msg = "📊 *Open Positions:*\n\n"
            for p in pos:
                pnl = float(p.unrealized_pl)
                e = "🟢" if pnl > 0 else "🔴"
                msg += f"{e} *{p.symbol}*  Entry ${float(p.avg_entry_price):.2f}  Now ${float(p.current_price):.2f}  PnL ${pnl:.2f}\n"
            self._reply(chat_id, msg)
        except Exception as e:
            self._reply(chat_id, f"Error: {e}")

    def _handle_trades(self, chat_id):
        if not self._is_admin(chat_id):
            self._reply(
                chat_id,
                "❌ Unauthorized: This command is only available for the bot administrator.",
            )
            return
        if not self.bot_instance:
            self._reply(chat_id, "Bot not available.")
            return
        trades = list(self.bot_instance._trades)[-5:]
        if not trades:
            self._reply(chat_id, "No recent trades.")
            return
        msg = "📜 *Recent Trades:*\n\n"
        for t in reversed(trades):
            a = t.get("action")
            s = t.get("symbol")
            pr = t.get("price") or 0
            pnl = t.get("pnl", 0)
            ts = t.get("timestamp", "").split("T")[0]
            icon = "🛒" if a == "BUY" else "💰"
            pnl_t = f" | PnL: ${pnl:.2f}" if a == "SELL" else ""
            msg += f"{icon} {a} {s} @ ${pr:.2f}{pnl_t} ({ts})\n"
        self._reply(chat_id, msg)

    def _handle_weekly(self, chat_id):
        # Allow admins or registered profiles
        is_admin = self._is_admin(chat_id)
        is_subscriber = False
        
        from api.stock_ai import supabase
        if supabase:
            try:
                # Check if chat_id matches any registered profile
                res = (
                    supabase.table("profiles")
                    .select("id")
                    .eq("telegram_chat_id", str(chat_id))
                    .execute()
                )
                if res.data:
                    is_subscriber = True
            except Exception as e:
                self._log(f"Error checking subscriber profiles: {e}")
                
        if not is_admin and not is_subscriber:
            self._reply(
                chat_id,
                "❌ *غير مصرح:* هذا الأمر متاح فقط للمشتركين المسجلين في المنصة.\n"
                "يرجى ربط حساب التليجرام الخاص بك أولاً عبر صفحة الإعدادات في الموقع باستخدام /start.\n\n"
                "❌ *Unauthorized:* This command is only available to registered platform users.\n"
                "Please link your Telegram account in the settings page first.",
            )
            return

        self._reply(chat_id, "⏳ جاري إعداد التقرير الأسبوعي... / Generating weekly report...")
        
        try:
            from api.daily_bot_run import generate_weekly_performance_report
            generate_weekly_performance_report(trigger="manual", chat_id=chat_id)
        except Exception as e:
            self._reply(chat_id, f"❌ حدث خطأ أثناء توليد التقرير: {e}")

    def _handle_daily(self, chat_id):
        # Allow admins or registered profiles
        is_admin = self._is_admin(chat_id)
        is_subscriber = False
        
        from api.stock_ai import supabase
        if supabase:
            try:
                # Check if chat_id matches any registered profile
                res = (
                    supabase.table("profiles")
                    .select("id")
                    .eq("telegram_chat_id", str(chat_id))
                    .execute()
                )
                if res.data:
                    is_subscriber = True
            except Exception as e:
                self._log(f"Error checking subscriber profiles: {e}")
                
        if not is_admin and not is_subscriber:
            self._reply(
                chat_id,
                "❌ *غير مصرح:* هذا الأمر متاح فقط للمشتركين المسجلين في المنصة.\n"
                "يرجى ربط حساب التليجرام الخاص بك أولاً عبر صفحة الإعدادات في الموقع باستخدام /start.\n\n"
                "❌ *Unauthorized:* This command is only available to registered platform users.\n"
                "Please link your Telegram account in the settings page first.",
            )
            return

        self._reply(chat_id, "⏳ جاري إعداد التوصيات اليومية... / Generating daily recommendations...")
        
        try:
            import asyncio
            from api.daily_bot_run import generate_daily_recommendations
            
            # Run the async function
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If we're already in an event loop, create a new thread
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(asyncio.run, generate_daily_recommendations())
                        count = future.result()
                else:
                    count = asyncio.run(generate_daily_recommendations())
            except RuntimeError:
                # Fallback: create new event loop in thread
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, generate_daily_recommendations())
                    count = future.result()
            
            if count and count > 0:
                self._reply(chat_id, f"✅ تم إرسال {count} توصية يومية جديدة بنجاح! / Successfully sent {count} daily recommendations!")
            else:
                self._reply(chat_id, "ℹ️ لا توجد توصيات جديدة اليوم / No new recommendations today")
        except Exception as e:
            self._reply(chat_id, f"❌ حدث خطأ أثناء توليد التوصيات اليومية: {e}")

    def _handle_help(self, chat_id):
        self._reply(
            chat_id,
            "📋 *الأوامر المتاحة / Available Commands:*\n\n"
            "🔗 /start — ربط حسابك بالمنصة\n"
            "📊 /daily — التوصيات اليومية الجديدة\n"
            "📊 /weekly — تقرير الأداء الأسبوعي للمنصة\n"
            "📊 /status — حالة البوت *(للمشرف)*\n"
            "📈 /positions — المراكز المفتوحة *(للمشرف)*\n"
            "📜 /trades — آخر الصفقات *(للمشرف)*\n"
            "❓ /help — عرض هذه القائمة\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            "🔗 /start — Link your account\n"
            "📊 /daily — Daily AI recommendations\n"
            "📊 /weekly — Weekly platform performance report\n"
            "📊 /status — Bot status *(Admin)*\n"
            "📈 /positions — Open positions *(Admin)*\n"
            "📜 /trades — Recent trades *(Admin)*\n"
            "❓ /help — Show this menu",
        )

    # ── bot menu setup ───────────────────────────────────────────────

    def _setup_bot_menu(self):
        """Register bot commands and set the menu button (web_app or commands)."""
        commands = [
            {"command": "start", "description": "🔗 ربط الحساب / Link account"},
            {"command": "daily", "description": "🚀 التوصيات اليومية / Daily recommendations"},
            {"command": "weekly", "description": "📊 تقرير الأداء الأسبوعي / Weekly report"},
            {"command": "status", "description": "📊 حالة البوت / Bot status"},
            {
                "command": "positions",
                "description": "📈 المراكز المفتوحة / Open positions",
            },
            {"command": "trades", "description": "📜 آخر الصفقات / Recent trades"},
            {"command": "help", "description": "❓ مساعدة / Help"},
        ]
        self._call_api("setMyCommands", {"commands": commands})
        self._log(f"Commands registered: {[c['command'] for c in commands]}")

        # Set menu button — use WebApp if WEB_ORIGIN is set, otherwise default to commands
        web_origin = os.getenv("WEB_ORIGIN", "").strip().rstrip("/")
        if web_origin and web_origin.startswith("http"):
            result = self._call_api(
                "setChatMenuButton",
                {
                    "menu_button": {
                        "type": "web_app",
                        "text": "🚀 فتح المنصة",
                        "web_app": {"url": web_origin},
                    }
                },
            )
            if result.get("ok"):
                self._log(f"Menu button set to WebApp: {web_origin} ✅")
            else:
                self._log(
                    f"WebApp menu button failed: {result.get('description', '?')} — falling back to commands"
                )
                self._call_api(
                    "setChatMenuButton", {"menu_button": {"type": "commands"}}
                )
        else:
            # Show the commands list as the menu button (default Telegram behaviour)
            self._call_api("setChatMenuButton", {"menu_button": {"type": "commands"}})
            self._log("Menu button set to commands list (no WEB_ORIGIN configured)")

    # ── lifecycle ────────────────────────────────────────────────────

    def stop(self):
        self._ready = False
        self._polling = False

    def run(self):
        """Background thread: DNS fix → webhook OR polling → idle."""
        try:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
            self._log("Starting Telegram Bot bridge...")
            self._log(f"API endpoint: {self.API}")

            # 1. DNS
            self._fix_telegram_dns()

            # 2. Start the sender thread (drains queue in background)
            sender = threading.Thread(target=self._sender_loop, daemon=True)
            sender.start()

            # 3. Wait for network to stabilise
            self._log("Waiting 5s for network baseline...")
            time.sleep(5)

            # 4. Resolve bot username (retry up to 5 times)
            for _get_me_attempt in range(1, 6):
                me = self._call_api("getMe")
                if me.get("ok") and isinstance(me.get("result"), dict):
                    self.bot_username = me["result"].get("username", "")
                    self._log(f"Bot is @{self.bot_username}")
                    break
                else:
                    err = me.get("description", "no result key")
                    self._log(f"getMe attempt {_get_me_attempt}/5 failed: {err}")
                    time.sleep(5 * _get_me_attempt)
            else:
                self._log("getMe failed after 5 attempts — continuing without bot username")

            webhook_url = os.getenv("WEBHOOK_URL")
            if webhook_url:
                # ── WEBHOOK MODE (production) ──
                hook = f"{webhook_url.rstrip('/')}/tg-webhook/{self.token}"
                self._log(f"Setting webhook to: {hook}")
                backoff = 10
                # Cap at 10 attempts — if HF blocks Telegram, run in outbound-only mode
                for attempt in range(1, 11):
                    self._log(f"Webhook attempt {attempt}...")
                    r = self._call_api("setWebhook", {"url": hook})
                    if r.get("ok"):
                        self._log("SUCCESS: Webhook set! ✅")
                        self._setup_bot_menu()
                        self._ready = True
                        self._net_ok = True
                        break
                    else:
                        err_desc = r.get("description", r.get("error", "?"))
                        self._log(f"Webhook failed: {err_desc}  (next in {backoff}s)")
                        time.sleep(backoff)
                        backoff = min(backoff * 1.5, 120)
                else:
                    self._log("Webhook setup failed after 10 attempts — outbound-only mode (sender still active). ✅")
                    self._ready = True
                    self._net_ok = True
            else:
                # ── LONG-POLLING MODE (local development) ──
                self._log(
                    "No WEBHOOK_URL — starting Long-Polling mode for local dev ✅"
                )
                # Delete any existing webhook first
                self._call_api("deleteWebhook", {"drop_pending_updates": False})
                self._setup_bot_menu()
                self._ready = True
                self._net_ok = True
                self._polling = True
                # Run polling in this thread (blocks)
                self._polling_loop()
                return  # polling_loop runs forever

            # Keep thread alive (webhook mode)
            self.loop.run_forever()
        except Exception as e:
            self._log(f"Fatal: {e}")
        finally:
            self._log("Thread exiting.")

    def start_in_thread(self):
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()


# ── Global bot reference ─────────────────────────────────────────────
_telegram_bot_instance: Optional[TelegramBot] = None


def get_telegram_bot() -> Optional[TelegramBot]:
    """Get the global TelegramBot instance (if initialized)."""
    return _telegram_bot_instance


def start_telegram_bridge(token: str, bot_instance):
    global _telegram_bot_instance
    bridge = TelegramBot(token, bot_instance)
    bridge.start_in_thread()
    _telegram_bot_instance = bridge
    return bridge
