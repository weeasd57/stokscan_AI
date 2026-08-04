import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { getAdminChatId, sendTelegramMessage } from "@/lib/supportTelegram";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const authClient = createSupabaseServerClient(req as any);
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id || "");
    const content = String(body.content || "").trim();
    const userName = String(user.user_metadata?.full_name || user.email || "User").slice(0, 120);
    if (!sessionId || !content) return NextResponse.json({ ok: false }, { status: 400 });
    if (content.length > 5000 || sessionId.length > 128) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    if (sessionId !== user.id) return NextResponse.json({ error: "Invalid support session" }, { status: 403 });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("support_messages")
      .insert({ session_id: sessionId, user_id: user.id, sender: "user", content, user_name: userName })
      .select("*")
      .single();

    if (error) return NextResponse.json({ ok: false }, { status: 200 });

    // Forward to admin on Telegram
    try {
      const adminChatId = await getAdminChatId();
      if (adminChatId) {
        const tgText = `💬 <b>[Support Chat Request]</b>\n` +
          `<b>Session:</b> <code>${sessionId}</code>\n` +
          `<b>User Name:</b> ${userName}\n` +
          `---------------------------------\n` +
          `${content}`;
        await sendTelegramMessage(adminChatId, tgText);
      }
    } catch (tgErr) {
      console.error("Failed to forward support message to Telegram:", tgErr);
    }

    return NextResponse.json({ ok: true, message: data });
  } catch (error) {
    console.error("support message route error:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
