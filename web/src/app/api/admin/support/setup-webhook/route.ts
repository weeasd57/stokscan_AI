import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Python service owns both support messages and VIP membership updates.
// This endpoint must never point the bot at the Vercel-only message handler.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const token = process.env.SUPPORT_BOT_TOKEN?.trim();
    const backend = process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL;
    if (!token || !backend) {
      return NextResponse.json({ ok: false, error: "Telegram bot or Python backend is not configured" }, { status: 503 });
    }

    const backendUrl = new URL(backend);
    if (backendUrl.protocol !== "https:" && backendUrl.hostname !== "localhost" && backendUrl.hostname !== "127.0.0.1") {
      return NextResponse.json({ ok: false, error: "Python backend must use HTTPS" }, { status: 503 });
    }
    const webhookUrl = new URL(`/support-tg-webhook/${encodeURIComponent(token)}`, backendUrl);

    const relayUrl = (process.env.TELEGRAM_RELAY_URL || "https://api.telegram.org").replace(/\/$/, "");
    const tgUrl = `${relayUrl}/bot${token}/setWebhook`;

    const res = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl.toString(),
        allowed_updates: ["message", "chat_member", "my_chat_member"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      return NextResponse.json({ ok: false, error: "Telegram rejected the webhook update" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, webhook_host: backendUrl.hostname });
  } catch {
    return NextResponse.json({ ok: false, error: "Telegram webhook update failed" }, { status: 502 });
  }
}
