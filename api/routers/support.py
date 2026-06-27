from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from api.stock_ai import _init_supabase, supabase as _supabase
from api.support_chat import handle_customer_message, handle_telegram_update, get_token

router = APIRouter()

class CustomerMessageRequest(BaseModel):
    session_id: str
    content: str
    user_name: Optional[str] = None

class AdminReplyRequest(BaseModel):
    session_id: str
    content: str

@router.post("/support/message")
async def send_customer_message(req: CustomerMessageRequest):
    msg = handle_customer_message(req.session_id, req.content, req.user_name)
    if not msg:
        raise HTTPException(status_code=500, detail="Failed to save message")
    return {"ok": True, "message": msg}

@router.get("/support/messages")
async def get_customer_messages(session_id: str):
    _init_supabase()
    if not _supabase:
        raise HTTPException(status_code=500, detail="Supabase not initialized")
    try:
        res = _supabase.table("support_messages").select("*").eq("session_id", session_id).order("created_at", desc=False).execute()
        return {"messages": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/support-tg-webhook/{token}")
async def support_telegram_webhook(token: str, request: Request):
    if token != get_token():
        raise HTTPException(status_code=403, detail="Unauthorized token")
    data = await request.json()
    handle_telegram_update(data)
    return {"ok": True}

@router.get("/admin/support/chats")
async def admin_get_chats():
    _init_supabase()
    if not _supabase:
        raise HTTPException(status_code=500, detail="Supabase not initialized")
    try:
        res = _supabase.table("support_messages").select("*").order("created_at", desc=True).limit(1000).execute()
        messages = res.data or []
        
        sessions = {}
        for msg in messages:
            sess_id = msg["session_id"]
            if sess_id not in sessions:
                sessions[sess_id] = {
                    "session_id": sess_id,
                    "user_name": msg.get("user_name") or "Guest",
                    "last_message": msg["content"],
                    "last_message_time": msg["created_at"]
                }
        return {"chats": list(sessions.values())}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/support/messages")
async def admin_get_session_messages(session_id: str):
    _init_supabase()
    if not _supabase:
        raise HTTPException(status_code=500, detail="Supabase not initialized")
    try:
        res = _supabase.table("support_messages").select("*").eq("session_id", session_id).order("created_at", desc=False).execute()
        return {"messages": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/admin/support/reply")
async def admin_send_reply(req: AdminReplyRequest):
    _init_supabase()
    if not _supabase:
        raise HTTPException(status_code=500, detail="Supabase not initialized")
        
    reply_data = {
        "session_id": req.session_id,
        "sender": "admin",
        "content": req.content,
        "user_name": "Admin"
    }
    
    try:
        res = _supabase.table("support_messages").insert(reply_data).execute()
        saved_msg = res.data[0] if res.data else None
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    # Send confirmation / update to Admin's Telegram
    from api.support_chat import load_admin_chat_id, send_telegram_message
    admin_chat_id = load_admin_chat_id()
    if admin_chat_id:
        tg_text = (
            f"✍️ <b>[Support Chat Reply]</b> (Replied via Admin Panel)\n"
            f"<b>Session:</b> <code>{req.session_id}</code>\n"
            f"---------------------------------\n"
            f"{req.content}"
        )
        send_telegram_message(admin_chat_id, tg_text)
        
    return {"ok": True, "message": saved_msg}
