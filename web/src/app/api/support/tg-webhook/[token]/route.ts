import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { saveAdminChatId, sendTelegramMessage } from "@/lib/supportTelegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const token = params.token;
    const supportToken = process.env.SUPPORT_BOT_TOKEN;
    if (!supportToken || token !== supportToken) {
      return NextResponse.json({ error: "Unauthorized token" }, { status: 403 });
    }

    const data = await req.json().catch(() => ({}));
    const message = data.message || {};
    const chat = message.chat || {};
    const chatId = chat.id;
    const text = String(message.text || "").trim();

    if (!chatId || !text) {
      return NextResponse.json({ ok: true });
    }

    // Handle /start command to register admin
    if (text.startsWith("/start")) {
      await saveAdminChatId(chatId);
      const welcomeText = `✅ <b>Support Bot Activated!</b>\n\nYou will now receive customer chat messages here. Reply directly to any message to send a response back to the customer on the website.`;
      await sendTelegramMessage(chatId, welcomeText);
      return NextResponse.json({ ok: true });
    }

    // Handle reply to a forwarded message
    const replyTo = message.reply_to_message;
    if (replyTo) {
      const replyText = replyTo.text || "";
      const match = replyText.match(/Session:\s*([a-zA-Z0-9\-]+)/);
      if (match) {
        const sessionId = match[1];
        const supabase = getSupabaseClient();
        await supabase.from("support_messages").insert({
          session_id: sessionId,
          sender: "admin",
          content: text,
          user_name: "Admin"
        });
        console.log(`[SUPPORT_CHAT] Saved admin reply from Telegram for session ${sessionId}`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[SUPPORT_CHAT_WEBHOOK] Webhook handler error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
