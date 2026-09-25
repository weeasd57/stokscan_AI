from typing import Any, Dict

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from api.easykash_payments import create_checkout, is_payments_enabled, order_status, payment_config, process_callback
from api import stock_ai
from api.stock_ai import _init_supabase

router = APIRouter(prefix="/payment/easykash", tags=["easykash"])


class CheckoutRequest(BaseModel):
    user_id: str
    plan_id: str = "pro"
    email: str = ""
    name: str = ""
    mobile: str


def _authenticated_user_id(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        _init_supabase()
        user_result = stock_ai.supabase.auth.get_user(token)
        user = getattr(user_result, "user", None)
        if user and getattr(user, "id", None):
            return str(user.id)
    except Exception:
        pass
    raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/config")
def config():
    return payment_config()


@router.post("/create")
def create(req: CheckoutRequest, authorization: str | None = Header(default=None)):
    if not is_payments_enabled():
        raise HTTPException(status_code=403, detail="Payments are currently disabled")
    authenticated_user_id = _authenticated_user_id(authorization)
    if req.user_id != authenticated_user_id:
        raise HTTPException(status_code=403, detail="User identity mismatch")
    if not req.user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")
    try:
        return create_checkout(req.user_id, req.plan_id, req.email, req.name, req.mobile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        print(f"[EASYKASH] checkout creation failed: {type(exc).__name__}")
        raise HTTPException(status_code=502, detail="Could not start EasyKash checkout")


@router.post("/callback")
async def callback(request: Request):
    try:
        payload: Dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid callback payload")
    try:
        result = process_callback(payload)
    except RuntimeError as exc:
        # Includes missing callback secret; never acknowledge a payment that
        # has not passed signature validation.
        raise HTTPException(status_code=503, detail=str(exc))
    if not result.get("ok"):
        raise HTTPException(status_code=int(result.get("status_code", 400)), detail=result.get("code", "callback_rejected"))
    return {"ok": True, "code": result.get("code", "processed")}


@router.get("/status")
def status(order_id: str, user_id: str, authorization: str | None = Header(default=None)):
    if not is_payments_enabled():
        raise HTTPException(status_code=403, detail="Payments are currently disabled")
    authenticated_user_id = _authenticated_user_id(authorization)
    if user_id != authenticated_user_id:
        raise HTTPException(status_code=403, detail="User identity mismatch")
    try:
        return order_status(order_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=503, detail="Payment status is unavailable")
