import os
import re
import requests
import threading
import time
from typing import Optional, List, Dict
from api.stock_ai import _init_supabase, supabase as _supabase

def get_token() -> str:
    return os.getenv("SUPPORT_BOT_TOKEN", "").strip()

def __getattr__(name: str):
    if name == "SUPPORT_BOT_TOKEN":
        token = get_token()
        preview = f"{token[:4]}...{token[-4:]}" if len(token) > 8 else "empty/too_short"
        print(f"[SUPPORT_CHAT] Dynamic lookup of SUPPORT_BOT_TOKEN: length={len(token)}, preview={preview}")
        return token
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
CHAT_ID_FILE = os.path.join(os.path.dirname(__file__), "support_admin_chat_id.txt")
TELEGRAM_RELAY_URL = os.getenv("TELEGRAM_RELAY_URL", "https://api.telegram.org").rstrip("/")

def load_admin_chat_id() -> Optional[int]:
    if os.path.exists(CHAT_ID_FILE):
        try:
            with open(CHAT_ID_FILE, "r") as f:
                return int(f.read().strip())
        except Exception:
            pass
    # Default fallback admin chat ID
    return 5149631436

def save_admin_chat_id(chat_id: int):
    try:
        with open(CHAT_ID_FILE, "w") as f:
            f.write(str(chat_id))
        print(f"[SUPPORT_CHAT] Saved admin chat ID: {chat_id}")
    except Exception as e:
        print(f"[SUPPORT_CHAT] Error saving admin chat ID: {e}")

def send_telegram_message(chat_id: int, text: str) -> bool:
    url = f"{TELEGRAM_RELAY_URL}/bot{get_token()}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        resp = requests.post(url, json=payload, timeout=10)
        return resp.json().get("ok", False)
    except Exception as e:
        print(f"[SUPPORT_CHAT] Telegram send error: {e}")
        return False

def handle_customer_message(session_id: str, content: str, user_name: Optional[str] = None):
    _init_supabase()
    if not _supabase:
        print("[SUPPORT_CHAT] Supabase client not initialized")
        return None
        
    msg_data = {
        "session_id": session_id,
        "sender": "user",
        "content": content,
        "user_name": user_name or "Guest"
    }
    
    try:
        res = _supabase.table("support_messages").insert(msg_data).execute()
        saved_msg = res.data[0] if res.data else None
    except Exception as e:
        print(f"[SUPPORT_CHAT] DB insert error: {e}")
        saved_msg = None
        
    # Forward to admin on Telegram
    admin_chat_id = load_admin_chat_id()
    if admin_chat_id:
        tg_text = (
            f"💬 <b>[Support Chat Request]</b>\n"
            f"<b>Session:</b> <code>{session_id}</code>\n"
            f"<b>User Name:</b> {user_name or 'Guest'}\n"
            f"---------------------------------\n"
            f"{content}"
        )
        send_telegram_message(admin_chat_id, tg_text)
        
    return saved_msg

def handle_telegram_update(data: dict):
    message = data.get("message", {})
    if not message:
        return
        
    chat = message.get("chat", {})
    chat_id = chat.get("id")
    text = message.get("text", "")
    
    if not chat_id or not text:
        return
        
    # Handle /start command to register admin
    if text.strip().startswith("/start"):
        save_admin_chat_id(chat_id)
        send_telegram_message(chat_id, "✅ <b>Support Bot Activated!</b>\n\nYou will now receive customer chat messages here. Reply directly to any message to send a response back to the customer on the website.")
        return
        
    # Handle reply to a forwarded message
    reply_to = message.get("reply_to_message", {})
    if reply_to:
        reply_text = reply_to.get("text", "")
        # Extract session ID using regex
        match = re.search(r'Session:\s*([a-zA-Z0-9\-]+)', reply_text)
        if match:
            session_id = match.group(1)
            
            _init_supabase()
            if _supabase:
                reply_data = {
                    "session_id": session_id,
                    "sender": "admin",
                    "content": text,
                    "user_name": "Admin"
                }
                try:
                    _supabase.table("support_messages").insert(reply_data).execute()
                    print(f"[SUPPORT_CHAT] Saved admin reply for session {session_id}")
                except Exception as e:
                    print(f"[SUPPORT_CHAT] Error saving admin reply: {e}")


