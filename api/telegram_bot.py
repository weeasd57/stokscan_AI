import os
import asyncio
import threading
import logging
import json
import time
import requests
from datetime import datetime
from typing import Optional
from collections import deque

# Configure logging
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)
logger = logging.getLogger(__name__)

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("telegram").setLevel(logging.WARNING)


class TelegramBot:
    """Telegram bot bridge — 100 % `requests`-based, zero httpx.

    Hugging Face Spaces intermittently blocks outbound TCP to Telegram IPs
    (`[Errno 1] Operation not permitted`).  This implementation:

    * Queues every outbound message and sends it from a background thread
      that retries with exponential back-off until the network opens.
    * The webhook can be set from the user's LOCAL machine via
      `POST /ai_bot/set_webhook` (one-time), or the bot will keep retrying.
    * Incoming webhook updates are parsed as plain JSON — no httpx needed.
    """

    # Use Cloudflare Worker relay if set, otherwise direct (fails on HF)
    API = os.getenv("TELEGRAM_RELAY_URL", "https://api.telegram.org").rstrip("/")

    def __init__(self, token: str, bot_instance=None):
        self.token = token
        self.bot_instance = bot_instance
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self.chat_id: Optional[int] = None
        self._ready = False
        self._queue: deque = deque(maxlen=200)     # outbound message queue
        self._net_ok = False                        # last-known network status
        self._load_chat_id()

    # ── helpers ──────────────────────────────────────────────────────

    def _load_chat_id(self):
        if self.bot_instance and getattr(self.bot_instance.config, "telegram_chat_id", None):
            self.chat_id = self.bot_instance.config.telegram_chat_id
            self._log(f"Loaded chat_id from bot config: {self.chat_id}")

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
        print(f"[TELEGRAM] {msg}")

    def _call_api(self, method: str, payload: dict = None) -> dict:
        """Single Telegram Bot API call — no retries, fast fail."""
        url = f"{self.API}/bot{self.token}/{method}"
        try:
            resp = requests.post(url, json=payload or {}, timeout=30)
            return resp.json()
        except Exception as e:
            return {"ok": False, "error": str(e)}

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
                    req = urllib.request.Request(api_url, headers={"Accept": "application/dns-json"})
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

    def send_notification(self, message: str):
        """Queue a message for delivery.  Returns immediately."""
        # 1. Global chat_id (admin channel)
        targets = set()
        if self.bot_instance and getattr(self.bot_instance.config, "telegram_chat_id", None):
            self.chat_id = self.bot_instance.config.telegram_chat_id
        if self.chat_id:
            targets.add(str(self.chat_id).strip())
            
        # 2. Subscribers chat IDs
        if self.bot_instance and hasattr(self.bot_instance, "bot_id"):
            bot_id = self.bot_instance.bot_id
            try:
                from api.stock_ai import supabase, _init_supabase
                _init_supabase()
                if supabase:
                    # Query bot_subscriptions where notifications_enabled is true
                    subs_res = supabase.table("bot_subscriptions").select("user_id, telegram_chat_id").eq("bot_id", bot_id).eq("notifications_enabled", True).execute()
                    if subs_res.data:
                        user_ids = [sub["user_id"] for sub in subs_res.data]
                        
                        # Query profiles to get default telegram_chat_id for these users
                        profiles_res = supabase.table("profiles").select("id, telegram_chat_id").in_("id", user_ids).execute()
                        profiles_map = {p["id"]: p.get("telegram_chat_id") for p in (profiles_res.data or []) if p.get("telegram_chat_id")}
                        
                        for sub in subs_res.data:
                            # Use custom sub telegram_chat_id if present, else fallback to profile telegram_chat_id
                            chat_id_val = sub.get("telegram_chat_id") or profiles_map.get(sub["user_id"])
                            if chat_id_val:
                                targets.add(str(chat_id_val).strip())
            except Exception as e:
                self._log(f"Error querying subscriber chat IDs for notification: {e}")
                
        # Send to all unique target chat IDs
        if not targets or not self.token:
            self._log("Cannot send: no targets or token.")
            return
            
        for target in targets:
            try:
                self._queue.append({"chat_id": int(target), "text": message, "parse_mode": "Markdown"})
            except ValueError:
                self._log(f"Invalid target chat ID: {target}")
        self._log(f"Queued notification to {len(targets)} targets ({len(self._queue)} in queue)")

    def _sender_loop(self):
        """Background loop: drain the queue whenever the network is up."""
        self._log("Sender thread started.")
        backoff = 5
        while True:
            if not self._queue:
                time.sleep(2)
                backoff = 5          # reset when idle
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
                self._net_ok = False
                self._log(f"Send failed ({backoff}s backoff): {result.get('error', result.get('description', '?'))}")
                time.sleep(backoff)
                backoff = min(backoff * 2, 120)   # max 2 min

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

            if text.startswith("/start") or text.startswith("/help"):
                self._handle_start(chat_id)
            elif text.startswith("/status"):
                self._handle_status(chat_id)
            elif text.startswith("/positions"):
                self._handle_positions(chat_id)
            elif text.startswith("/trades"):
                self._handle_trades(chat_id)

            self._log(f"Processed update: {uid}")
        except Exception as e:
            self._log(f"Webhook error: {e}")
            import traceback; traceback.print_exc()

    # ── command handlers ─────────────────────────────────────────────

    def _reply(self, chat_id, text):
        self._queue.appendleft({"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})

    def _is_admin(self, chat_id):
        admin_chat_id = None
        if self.bot_instance and getattr(self.bot_instance.config, "telegram_chat_id", None):
            admin_chat_id = self.bot_instance.config.telegram_chat_id
        if not admin_chat_id:
            admin_chat_id = self.chat_id
        return admin_chat_id and str(chat_id) == str(admin_chat_id)

    def _handle_start(self, chat_id):
        self._reply(chat_id,
            "🚀 *Artoro Trading Bot connected!*\n\n"
            f"Your Telegram Chat ID is: `{chat_id}`\n\n"
            "Please copy this ID and paste it in your settings on the website to receive trade notifications.\n\n"
            "*Commands:*\n"
            "/status - Bot status & balance (Admin only)\n"
            "/positions - Open positions (Admin only)\n"
            "/trades - Last 5 trades (Admin only)\n"
            "/help - Show this message"
        )

    def _handle_status(self, chat_id):
        if not self._is_admin(chat_id):
            self._reply(chat_id, "❌ Unauthorized: This command is only available for the bot administrator.")
            return
        if not self.bot_instance:
            self._reply(chat_id, "Bot not available."); return
        st = self.bot_instance.get_status()
        bal = "N/A"
        try:
            a = self.bot_instance.api.get_account()
            bal = f"${float(a.equity):.2f} (Cash: ${float(a.cash):.2f})"
        except Exception: pass
        self._reply(chat_id,
            f"🤖 *Status:* {st.get('status','?').upper()}\n"
            f"💰 *Equity:* {bal}\n"
            f"🕒 *Last Scan:* {st.get('last_scan') or 'Never'}\n"
            f"📈 *Coins:* {len(st.get('config',{}).get('coins',[]))}"
        )

    def _handle_positions(self, chat_id):
        if not self._is_admin(chat_id):
            self._reply(chat_id, "❌ Unauthorized: This command is only available for the bot administrator.")
            return
        if not self.bot_instance or not self.bot_instance.api:
            self._reply(chat_id, "Bot API not available."); return
        try:
            pos = self.bot_instance.api.list_positions()
            if not pos:
                self._reply(chat_id, "No open positions."); return
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
            self._reply(chat_id, "❌ Unauthorized: This command is only available for the bot administrator.")
            return
        if not self.bot_instance:
            self._reply(chat_id, "Bot not available."); return
        trades = list(self.bot_instance._trades)[-5:]
        if not trades:
            self._reply(chat_id, "No recent trades."); return
        msg = "📜 *Recent Trades:*\n\n"
        for t in reversed(trades):
            a = t.get("action"); s = t.get("symbol"); pr = t.get("price") or 0
            pnl = t.get("pnl", 0); ts = t.get("timestamp","").split("T")[0]
            icon = "🛒" if a == "BUY" else "💰"
            pnl_t = f" | PnL: ${pnl:.2f}" if a == "SELL" else ""
            msg += f"{icon} {a} {s} @ ${pr:.2f}{pnl_t} ({ts})\n"
        self._reply(chat_id, msg)

    # ── lifecycle ────────────────────────────────────────────────────

    def stop(self):
        self._ready = False

    def run(self):
        """Background thread: DNS fix → set webhook (retry forever) → idle."""
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
            self._log("Waiting 15s for network baseline...")
            time.sleep(15)

            # 4. Set webhook (retry with long back-off; succeeds when net opens)
            webhook_url = os.getenv("WEBHOOK_URL")
            if webhook_url:
                hook = f"{webhook_url.rstrip('/')}/tg-webhook/{self.token}"
                self._log(f"Setting webhook to: {hook}")
                backoff = 10
                for attempt in range(1, 100):     # effectively infinite
                    self._log(f"Webhook attempt {attempt}...")
                    r = self._call_api("setWebhook", {"url": hook})
                    if r.get("ok"):
                        self._log("SUCCESS: Webhook set! ✅")
                        # Register commands & verify
                        self._call_api("setMyCommands", {"commands": [
                            {"command": "start", "description": "Start the bot"},
                            {"command": "status", "description": "Bot status"},
                            {"command": "positions", "description": "Open positions"},
                            {"command": "trades", "description": "Recent trades"},
                            {"command": "help",  "description": "Help"},
                        ]})
                        me = self._call_api("getMe")
                        if me.get("ok"):
                            self._log(f"Bot is @{me['result'].get('username','?')}")
                        self._ready = True
                        self._net_ok = True
                        break
                    else:
                        self._log(f"Webhook failed: {r.get('error', r.get('description','?'))}  (next in {backoff}s)")
                        time.sleep(backoff)
                        backoff = min(backoff * 1.5, 300)  # max 5 min
            else:
                self._log("No WEBHOOK_URL — bridge idle.")
                self._ready = True

            # Keep thread alive
            self.loop.run_forever()
        except Exception as e:
            self._log(f"Fatal: {e}")
        finally:
            self._log("Thread exiting.")

    def start_in_thread(self):
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()


def start_telegram_bridge(token: str, bot_instance):
    bridge = TelegramBot(token, bot_instance)
    bridge.start_in_thread()
    return bridge
