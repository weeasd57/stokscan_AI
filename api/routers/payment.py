import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from api.stock_ai import _init_supabase, supabase

router = APIRouter(prefix="/payment", tags=["payment"])


class CheckoutRequest(BaseModel):
    plan_id: str
    user_id: str
    email: str
    first_name: str
    last_name: str
    phone_number: str


@router.post("/paymob/checkout")
def paymob_checkout(req: CheckoutRequest):
    # 1. Load Paymob environment variables
    api_key = os.getenv("PAYMOB_API_KEY")
    integration_id = os.getenv("PAYMOB_INTEGRATION_ID")
    iframe_id = os.getenv("PAYMOB_IFRAME_ID")

    if not api_key or not integration_id or not iframe_id:
        raise HTTPException(
            status_code=500,
            detail="Paymob configuration is incomplete on the server. Please check environment variables.",
        )

    # 2. Determine price in EGP cents
    # Default exchange rate: 1 USD = 50 EGP
    # Plan pricing: Pro = $29 (1450 EGP), Enterprise = $99 (4950 EGP)
    plan_clean = req.plan_id.strip().lower()
    if plan_clean == "pro":
        amount_egp = 1450
    elif plan_clean == "enterprise":
        amount_egp = 4950
    else:
        # Fallback/dynamic pricing lookup if needed, otherwise default to Pro price
        amount_egp = 1450

    amount_cents = int(amount_egp * 100)

    try:
        # Step 1: Paymob Authentication
        auth_url = "https://accept.paymob.com/api/auth/tokens"
        auth_res = requests.post(auth_url, json={"api_key": api_key}, timeout=15)
        auth_res.raise_for_status()
        auth_token = auth_res.json().get("token")

        if not auth_token:
            raise HTTPException(
                status_code=500,
                detail="Failed to retrieve Paymob authentication token.",
            )

        # Step 2: Order Registration
        # We encode user_id and plan_id in merchant_order_id so we can decode it in the webhook securely
        merchant_order_id = (
            f"sub_{req.user_id}_{req.plan_id}_{int(datetime.utcnow().timestamp())}"
        )

        order_url = "https://accept.paymob.com/api/ecommerce/orders"
        order_payload = {
            "auth_token": auth_token,
            "delivery_needed": "false",
            "amount_cents": amount_cents,
            "currency": "EGP",
            "merchant_order_id": merchant_order_id,
            "items": [],
        }
        order_res = requests.post(order_url, json=order_payload, timeout=15)
        order_res.raise_for_status()
        order_id = order_res.json().get("id")

        if not order_id:
            raise HTTPException(
                status_code=500, detail="Failed to register Paymob order."
            )

        # Step 3: Payment Key Generation
        billing_data = {
            "apartment": "NA",
            "floor": "NA",
            "street": "NA",
            "building": "NA",
            "shipping_method": "NA",
            "postal_code": "NA",
            "city": "Cairo",
            "country": "EG",
            "state": "Cairo",
            "email": req.email if req.email else "user@egxbots.com",
            "first_name": req.first_name if req.first_name else "Jane",
            "last_name": req.last_name if req.last_name else "Doe",
            "phone_number": req.phone_number if req.phone_number else "+201000000000",
        }

        key_url = "https://accept.paymob.com/api/acceptance/payment_keys"
        key_payload = {
            "auth_token": auth_token,
            "amount_cents": amount_cents,
            "expiration": 3600,
            "order_id": order_id,
            "billing_data": billing_data,
            "currency": "EGP",
            "integration_id": int(integration_id),
            "lock_order_when_paid": "true",
        }
        key_res = requests.post(key_url, json=key_payload, timeout=15)
        key_res.raise_for_status()
        payment_key = key_res.json().get("token")

        if not payment_key:
            raise HTTPException(
                status_code=500, detail="Failed to retrieve Paymob payment token."
            )

        # Step 4: Handle Card vs Mobile Wallet integration
        integration_type = os.getenv("PAYMOB_INTEGRATION_TYPE", "card").strip().lower()

        if integration_type in ("wallet", "mobile_wallet", "mobile wallet"):
            pay_url = "https://accept.paymob.com/api/acceptance/payments/pay"
            pay_payload = {
                "source": {
                    "identifier": req.phone_number
                    if req.phone_number
                    else "01010101010",
                    "subtype": "WALLET",
                },
                "payment_token": payment_key,
            }
            print(f"Sending request to Paymob wallet pay API: {pay_url}")
            print(f"Payload: {pay_payload}")

            pay_res = requests.post(pay_url, json=pay_payload, timeout=15)
            print(f"Response status: {pay_res.status_code}")
            print(f"Response text: {pay_res.text}")

            pay_res.raise_for_status()
            pay_data = pay_res.json()

            redirect_url = pay_data.get("redirect_url") or pay_data.get(
                "redirection_url"
            )
            if not redirect_url:
                # check nested data structure if any
                redirect_url = pay_data.get("data", {}).get("redirect_url")

            if not redirect_url:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to retrieve wallet redirection URL from Paymob. Response was: {pay_res.text[:200]}",
                )

            return {
                "success": True,
                "payment_key": payment_key,
                "url": redirect_url,
                "is_wallet": True,
            }
        else:
            # Construct standard Credit Card iframe redirect URL
            redirect_url = f"https://accept.paymob.com/api/acceptance/iframes/{iframe_id}?payment_token={payment_key}"
            return {
                "success": True,
                "payment_key": payment_key,
                "iframe_id": iframe_id,
                "url": redirect_url,
                "is_wallet": False,
            }

    except Exception as e:
        print(f"Error during Paymob checkout generation: {e}")
        raise HTTPException(
            status_code=500, detail=f"Checkout generation failed: {str(e)}"
        )


@router.post("/paymob/webhook")
async def paymob_webhook(request: Request):
    hmac_secret = os.getenv("PAYMOB_HMAC_SECRET")
    if not hmac_secret:
        raise HTTPException(
            status_code=500, detail="HMAC secret not configured on server"
        )

    # Get raw body and query parameters for HMAC validation
    body = await request.json()
    print("INCOMING WEBHOOK BODY:", json.dumps(body))

    query_params = dict(request.query_params)
    hmac_signature = query_params.get("hmac")
    print("INCOMING WEBHOOK QUERY HMAC:", hmac_signature)

    if not hmac_signature:
        raise HTTPException(status_code=400, detail="Missing HMAC signature")

    obj = body.get("obj", {})
    if not obj:
        raise HTTPException(status_code=400, detail="Missing transaction object")

    # 1. Verification of HMAC signature
    try:
        # Extract values in Paymob's strict concatenation order
        amount_cents = obj.get("amount_cents")
        created_at = obj.get("created_at")
        currency = obj.get("currency")
        error_occured = str(obj.get("error_occured")).lower()
        has_parent_transaction = str(obj.get("has_parent_transaction")).lower()
        obj_id = obj.get("id")
        integration_id = obj.get("integration_id")
        is_3d_secure = str(obj.get("is_3d_secure")).lower()
        is_auth = str(obj.get("is_auth")).lower()
        is_capture = str(obj.get("is_capture")).lower()
        is_refunded = str(obj.get("is_refunded")).lower()
        is_standalone_payment = str(obj.get("is_standalone_payment")).lower()
        pending = str(obj.get("pending")).lower()

        source_data = obj.get("source_data", {})
        source_pan = source_data.get("pan", "")
        source_sub_type = source_data.get("sub_type", "")
        source_type = source_data.get("type", "")
        success = str(obj.get("success")).lower()

        concat_str = (
            f"{amount_cents}{created_at}{currency}{error_occured}{has_parent_transaction}"
            f"{obj_id}{integration_id}{is_3d_secure}{is_auth}{is_capture}{is_refunded}"
            f"{is_standalone_payment}{pending}{source_pan}{source_sub_type}{source_type}{success}"
        )
        print("CONCATENATED STRING FOR HMAC:", concat_str)

        calculated_hmac = hmac.new(
            hmac_secret.encode("utf-8"), concat_str.encode("utf-8"), hashlib.sha512
        ).hexdigest()
        print("CALCULATED HMAC:", calculated_hmac)

        if not hmac.compare_digest(calculated_hmac, hmac_signature):
            print("Paymob HMAC signature mismatch — rejecting webhook.")
            raise HTTPException(status_code=401, detail="Invalid HMAC signature")

    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        print(f"Error validating HMAC: {e}")
        raise HTTPException(status_code=400, detail="HMAC validation error")

    # 2. Process Successful Transaction
    success_status = obj.get("success")
    if success_status is True or str(success_status).lower() == "true":
        order = obj.get("order", {})
        merchant_order_id = order.get("merchant_order_id") if order else None

        if merchant_order_id and merchant_order_id.startswith("sub_"):
            # Decode merchant_order_id: sub_{user_id}_{plan_id}_{timestamp}
            parts = merchant_order_id.split("_")
            if len(parts) >= 3:
                user_id = parts[1]
                plan_id = parts[2]

                # Update user subscription in Supabase
                try:
                    _init_supabase()
                    if supabase:
                        # 1. Upsert pricing plan if not exists (to satisfy FK constraint)
                        # Pro plan price is 29 USD, Enterprise is 99 USD
                        plan_cents = 2900 if plan_id.lower() == "pro" else 9900
                        supabase.table("pricing_plans").upsert(
                            {
                                "id": plan_id,
                                "name": plan_id,
                                "price_monthly_cents": plan_cents,
                                "is_active": True,
                            }
                        ).execute()

                        # 2. Upsert user subscription
                        now = datetime.utcnow()
                        end_date = now + timedelta(days=30)

                        sub_payload = {
                            "user_id": user_id,
                            "plan_id": plan_id,
                            "status": "active",
                            "current_period_start": now.isoformat(),
                            "current_period_end": end_date.isoformat(),
                            "updated_at": now.isoformat(),
                        }

                        supabase.table("subscriptions").upsert(sub_payload).execute()
                        print(
                            f"Successfully activated subscription for User: {user_id}, Plan: {plan_id}"
                        )
                except Exception as db_err:
                    print(f"Database error updating subscription: {db_err}")
                    raise HTTPException(
                        status_code=500, detail="Failed to record subscription"
                    )
    return {"status": "processed"}


@router.get("/paymob/webhook")
def paymob_webhook_get(request: Request):
    query_params = dict(request.query_params)
    success = query_params.get("success") == "true"

    # Redirect back to the frontend pro page with status query parameters
    web_origin = os.getenv("WEB_ORIGIN", "http://localhost:3000")
    if success:
        return RedirectResponse(url=f"{web_origin}/pro?payment=success")
    else:
        return RedirectResponse(url=f"{web_origin}/pro?payment=failed")


class CancelSubscriptionRequest(BaseModel):
    user_id: str


@router.post("/paymob/cancel")
def cancel_subscription(req: CancelSubscriptionRequest):
    try:
        _init_supabase()
        if not supabase:
            raise HTTPException(status_code=503, detail="Supabase not configured")

        from datetime import datetime

        # Mark as cancelled rather than deleting — preserves audit trail
        supabase.table("subscriptions").update(
            {
                "status": "cancelled",
                "updated_at": datetime.utcnow().isoformat(),
            }
        ).eq("user_id", req.user_id).execute()
        return {"success": True, "message": "Subscription cancelled successfully."}
    except Exception as e:
        print(f"Error cancelling subscription: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to cancel subscription: {str(e)}"
        )
