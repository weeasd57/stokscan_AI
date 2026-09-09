"""
Kashier payment router (TEST-first). All endpoints honor the PAYMENTS_ENABLED
feature flag: when false the create/status endpoints return 403 and the config
reports billing=disabled so the frontend stays in free mode.
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from api.kashier_payments import (
    is_payments_enabled,
    current_mode,
    create_payment_session,
    process_webhook_event,
    get_payment_status,
    get_mid,
    get_mode,
)
from api.plan_limits import effective_limits, free_limits, pro_limits

router = APIRouter(prefix="/payment", tags=["kashier"])


class CreatePaymentRequest(BaseModel):
    user_id: str
    plan_id: str = "pro"
    email: str = ""
    customer_ref: str = ""
    quantity: int = 1


class WebhookBody(BaseModel):
    pass  # raw body handled via Request


@router.get("/config")
def payment_config():
    """Public config so the frontend knows whether to show purchase UI and the
    current plan limits/prices. Never exposes any secret."""
    enabled = is_payments_enabled()
    if not enabled:
        return {
            "mode": "disabled",
            "enabled": False,
            "free": effective_limits("free"),
        }
    import os
    methods = os.getenv("KASHIER_ALLOWED_METHODS", "card,wallet").strip()
    return {
        "mode": get_mode(),
        "enabled": True,
        "currency": "EGP",
        "mid": get_mid(),
        "payment_methods": methods.split(","),
        "free": {
            **free_limits(),
            "billing": "enabled",
        },
        "pro": {
            **pro_limits(),
            "billing": "enabled",
        },
    }


@router.post("/kashier/create")
def create_payment(req: CreatePaymentRequest):
    if not is_payments_enabled():
        raise HTTPException(status_code=403, detail="Payments are currently disabled")
    if not req.user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")
    try:
        result = create_payment_session(
            user_id=req.user_id,
            plan_id=req.plan_id,
            email=req.email,
            customer_ref=req.customer_ref,
            quantity=req.quantity,
        )
        return result
    except Exception as e:
        print(f"[KASHIER] create_payment failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/kashier/webhook")
async def kashier_webhook(
    request: Request,
    x_kashier_signature: Optional[str] = Header(default=None, alias="x-kashier-signature"),
):
    if not is_payments_enabled():
        # Let the processor ack so it stops retrying; we simply ignore in free mode.
        return {"ok": True, "code": "IGNORED_DISABLED"}
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    result = process_webhook_event(body, x_kashier_signature)
    if not result.get("ok"):
        # 409 also counts as acknowledged by Kashier; return it for events we
        # already processed so the sender stops retrying.
        if result.get("code") == "ALREADY_PROCESSED":
            raise HTTPException(status_code=409, detail=result.get("code"))
        raise HTTPException(status_code=result.get("status", 400), detail=result.get("code"))
    return {"ok": True, "code": result.get("code", "PROCESSED")}


@router.get("/kashier/status")
def payment_status(order_ref: str):
    if not is_payments_enabled():
        return {"ok": True, "payment": None, "mode": "disabled"}
    if not order_ref:
        raise HTTPException(status_code=400, detail="Missing order_ref")
    return get_payment_status(order_ref)
