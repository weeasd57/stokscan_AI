import { getSupabaseClient } from "@/lib/supabase/route-data";

export async function getAdminChatId(): Promise<number> {
  const envChatId = process.env.SUPPORT_ADMIN_CHAT_ID;
  if (envChatId) {
    return parseInt(envChatId, 10);
  }

  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("model_metadata")
      .select("metadata")
      .eq("name", "support_config")
      .maybeSingle();

    if (data?.metadata && typeof data.metadata === "object") {
      const meta = data.metadata as Record<string, any>;
      if (meta.admin_chat_id) {
        return parseInt(meta.admin_chat_id, 10);
      }
    }
  } catch (err) {
    console.error("[SUPPORT_TELEGRAM] Error reading admin chat ID from Supabase:", err);
  }

  // Fallback default admin chat ID
  return 5149631436;
}

export async function saveAdminChatId(chatId: number): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("model_metadata")
      .upsert({
        name: "support_config",
        metadata: { admin_chat_id: chatId },
        updated_at: new Date().toISOString()
      }, { onConflict: "name" });

    if (error) {
      console.error("[SUPPORT_TELEGRAM] Supabase upsert error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[SUPPORT_TELEGRAM] Error saving admin chat ID to Supabase:", err);
    return false;
  }
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  const token = process.env.SUPPORT_BOT_TOKEN;
  if (!token) {
    console.warn("[SUPPORT_TELEGRAM] SUPPORT_BOT_TOKEN is not defined");
    return false;
  }

  const relayUrl = (process.env.TELEGRAM_RELAY_URL || "https://api.telegram.org").replace(/\/$/, "");
  const url = `${relayUrl}/bot${token}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json();
    return !!data.ok;
  } catch (err) {
    console.error("[SUPPORT_TELEGRAM] Error sending Telegram message:", err);
    return false;
  }
}
