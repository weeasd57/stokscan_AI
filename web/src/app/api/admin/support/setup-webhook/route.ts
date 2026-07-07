import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = process.env.SUPPORT_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ ok: false, error: "SUPPORT_BOT_TOKEN is not configured in Vercel environment variables" }, { status: 400 });
    }

    const url = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const webhookUrl = `${protocol}://${host}/api/support/tg-webhook/${token}`;

    const relayUrl = (process.env.TELEGRAM_RELAY_URL || "https://api.telegram.org").replace(/\/$/, "");
    const tgUrl = `${relayUrl}/bot${token}/setWebhook`;

    const res = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json();
    return NextResponse.json({
      ok: data.ok || false,
      webhook_url: webhookUrl,
      telegram_response: data
    });
  } catch (err: any) {
    console.error("[SUPPORT_SETUP_WEBHOOK] Error setting Telegram webhook:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
