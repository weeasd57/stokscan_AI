import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { getAdminChatId, sendTelegramMessage } from "@/lib/supportTelegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id || "");
    const content = String(body.content || "").trim();

    if (!sessionId || !content) {
      return NextResponse.json({ ok: false, error: "Missing session_id or content" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("support_messages")
      .insert({
        session_id: sessionId,
        sender: "admin",
        content,
        user_name: "Admin"
      })
      .select("*")
      .single();

    if (error) {
      console.error("admin support reply database error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Send confirmation / update to Admin's Telegram
    try {
      const adminChatId = await getAdminChatId();
      if (adminChatId) {
        const tgText = `✍️ <b>[Support Chat Reply]</b> (Replied via Admin Panel)\n` +
          `<b>Session:</b> <code>${sessionId}</code>\n` +
          `---------------------------------\n` +
          `${content}`;
        await sendTelegramMessage(adminChatId, tgText);
      }
    } catch (tgErr) {
      console.error("Failed to send admin reply confirmation to Telegram:", tgErr);
    }

    return NextResponse.json({ ok: true, message: data });
  } catch (err: any) {
    console.error("admin support reply route error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
