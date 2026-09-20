import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.local_payments import is_local_payments_enabled, create_order, submit_order, get_order_status, price_egp

router = APIRouter(prefix="/payment/local", tags=["local-payment"])


class LocalPaymentRequest(BaseModel):
    user_id: str
    plan_id: str = "pro"


class LocalPaymentSubmit(BaseModel):
    user_id: str
    order_id: str
    note: str = ""


@router.get("/config")
def local_payment_config():
    return {"enabled": is_local_payments_enabled(), "provider": "vodafone_cash", "amount_egp": price_egp("pro"),
            "qr_url": os.getenv("VODAFONE_CASH_QR_URL", ""), "wallet_number": os.getenv("VODAFONE_CASH_NUMBER", "")}


@router.post("/create")
def local_payment_create(req: LocalPaymentRequest):
    if not is_local_payments_enabled():
        raise HTTPException(status_code=403, detail="Local payments are currently disabled")
    try:
        return create_order(req.user_id, req.plan_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/submit")
def local_payment_submit(req: LocalPaymentSubmit):
    if not is_local_payments_enabled():
        raise HTTPException(status_code=403, detail="Local payments are currently disabled")
    if not req.user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")
    try:
        return submit_order(req.order_id, req.user_id, req.note)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/status")
def local_payment_status(order_id: str, user_id: str):
    if not is_local_payments_enabled():
        raise HTTPException(status_code=403, detail="Local payments are currently disabled")
    try:
        return get_order_status(order_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
