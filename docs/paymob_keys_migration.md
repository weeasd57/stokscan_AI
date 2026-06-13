# Paymob Live Migration Guide & Environment Keys

This document tracks all the environment variables and secrets configured in your Hugging Face Space (`weeasdwee/AI_BOT`) for Paymob integration, listing what is currently configured, what is missing, and what needs to be changed when migrating to the production (Live) environment.

---

## 🚨 Critical: Missing Secrets (Not Configured Yet!)
These key credentials are **missing** from your Hugging Face variables/secrets list. You must add them as **New secret** (Private) in Hugging Face:

1. **`PAYMOB_API_KEY`**: (Private Secret)
   * *Sandbox Value:* `ZXlKaGJHY2lPaUpJVXp...` (Found in your local `.env`)
   * *Action:* Add as a **Secret** (Private). When going Live, replace with the live API key.
2. **`PAYMOB_SECRET_KEY`**: (Private Secret)
   * *Sandbox Value:* `egy_sk_test_7083f1a770c283f0d79445bb1e343f60d9794609b25efee58c9d0f217d7758dc`
   * *Action:* Add as a **Secret** (Private). When going Live, replace with the live secret key (starts with `egy_sk_live_`).
3. **`PAYMOB_PUBLIC_KEY`**: (Private Secret)
   * *Sandbox Value:* `egy_pk_test_sWYgxnGJNGpbs6FgPGaCwYudz74xN4Kz`
   * *Action:* Add as a **Secret** (Private). When going Live, replace with the live public key (starts with `egy_pk_live_`).

---

## 📋 Configured Variables on Hugging Face (Sandbox Status)

| Variable Name | Sandbox Value (Current) | Type on HF | Will it change for Live? |
| :--- | :--- | :--- | :--- |
| **`PAYMOB_MERCHANT_ID`** | `1058691` | Variable (Public) | **No** (Constant for your account) |
| **`PAYMOB_HMAC_SECRET`** | `1FCCD4AF971FFCA3AD1EDBDEB284DBB` | Variable (Public) | **No** (Unless regenerated or profile changes) |
| **`PAYMOB_INTEGRATION_ID`** | `5706593` | Variable (Public) | ⚠️ **Yes** (Must replace with the Live Wallet Integration ID) |
| **`PAYMOB_IFRAME_ID`** | `836873` | Variable (Public) | ⚠️ **Yes** (Only if card payment is used; not used for Wallets) |
| **`PAYMOB_INTEGRATION_TYPE`** | `wallet` | Variable (Public) | **No** (Always `wallet` for mobile cash payments) |
| **`WEB_ORIGIN`** | `https://egxbots.com` | Variable (Public) | **No** (Your production frontend URL) |
| **`WEBHOOK_URL`** | `https://weeasdwee-ai-bot.hf.space` | Variable (Public) | **No** (Your production backend URL) |

---

## ⚡ Live Migration Steps (When Approved for Production Payments)

Once Paymob approves your production/live account, update these values in your Hugging Face Space settings:

1. **Update API Credentials (Secrets):**
   * Change `PAYMOB_API_KEY` to your Live API Key.
   * Change `PAYMOB_SECRET_KEY` to your Live Secret Key (`egy_sk_live_...`).
   * Change `PAYMOB_PUBLIC_KEY` to your Live Public Key (`egy_pk_live_...`).

2. **Update Integration ID (Variable):**
   * Create a live integration for Mobile Wallets in the Paymob Dashboard.
   * Change `PAYMOB_INTEGRATION_ID` variable to the new live Integration ID.

3. **Configure Live Webhooks in Paymob Dashboard:**
   Set the processed and response callback URLs in your new live integration settings to:
   `https://weeasdwee-ai-bot.hf.space/payment/paymob/webhook`
