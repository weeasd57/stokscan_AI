# Paymob Live Migration Guide & Environment Keys

This document tracks the environment variables and secrets needed for Paymob integration. User-facing payment callbacks should be handled through Vercel API routes, not Hugging Face.

---

## 🚨 Critical: Missing Secrets (Not Configured Yet!)
These key credentials must be configured as private environment variables on the service handling Paymob callbacks:

1. **`PAYMOB_API_KEY`**: (Private Secret)
   * *Sandbox Value:* `ZXlKaGJHY2lPaUpJVXp...` (Found in your local `.env`)
   * *Action:* Add as a private environment variable. When going Live, replace with the live API key.
2. **`PAYMOB_SECRET_KEY`**: (Private Secret)
   * *Sandbox Value:* `egy_sk_test_7083f1a770c283f0d79445bb1e343f60d9794609b25efee58c9d0f217d7758dc`
   * *Action:* Add as a private environment variable. When going Live, replace with the live secret key (starts with `egy_sk_live_`).
3. **`PAYMOB_PUBLIC_KEY`**: (Private Secret)
   * *Sandbox Value:* `egy_pk_test_sWYgxnGJNGpbs6FgPGaCwYudz74xN4Kz`
   * *Action:* Add as a private environment variable. When going Live, replace with the live public key (starts with `egy_pk_live_`).

---

## 📋 Configured Variables (Sandbox Status)

| Variable Name | Sandbox Value (Current) | Type | Will it change for Live? |
| :--- | :--- | :--- | :--- |
| **`PAYMOB_MERCHANT_ID`** | `1058691` | Variable | **No** (Constant for your account) |
| **`PAYMOB_HMAC_SECRET`** | `1FCCD4AF971FFCA3AD1EDBDEB284DBB` | Secret | **No** (Unless regenerated or profile changes) |
| **`PAYMOB_INTEGRATION_ID`** | `5706593` | Variable | ⚠️ **Yes** (Must replace with the Live Wallet Integration ID) |
| **`PAYMOB_IFRAME_ID`** | `836873` | Variable | ⚠️ **Yes** (Only if card payment is used; not used for Wallets) |
| **`PAYMOB_INTEGRATION_TYPE`** | `wallet` | Variable | **No** (Always `wallet` for mobile cash payments) |
| **`WEB_ORIGIN`** | `https://egxbots.com` | Variable (Public) | **No** (Your production frontend URL) |
| **`WEBHOOK_URL`** | `https://egxbots.com/api/paymob/webhook` | Variable (Public) | **No** (Your Vercel callback URL) |

---

## ⚡ Live Migration Steps (When Approved for Production Payments)

Once Paymob approves your production/live account, update these values in your production environment:

1. **Update API Credentials (Secrets):**
   * Change `PAYMOB_API_KEY` to your Live API Key.
   * Change `PAYMOB_SECRET_KEY` to your Live Secret Key (`egy_sk_live_...`).
   * Change `PAYMOB_PUBLIC_KEY` to your Live Public Key (`egy_pk_live_...`).

2. **Update Integration ID (Variable):**
   * Create a live integration for Mobile Wallets in the Paymob Dashboard.
   * Change `PAYMOB_INTEGRATION_ID` variable to the new live Integration ID.

3. **Configure Live Webhooks in Paymob Dashboard:**
   Set the processed and response callback URLs in your new live integration settings to:
   `https://egxbots.com/api/paymob/webhook`
