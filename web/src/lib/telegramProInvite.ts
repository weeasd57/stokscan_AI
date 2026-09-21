export async function createProTelegramInvite(userId: string, expiresAt: string): Promise<string> {
  const token = process.env.SUPPORT_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_PRO_CHAT_ID?.trim();
  if (!token || !chatId) return "";

  const relayUrl = (process.env.TELEGRAM_RELAY_URL || "https://api.telegram.org").replace(/\/$/, "");
  const expireDate = Math.floor(new Date(expiresAt).getTime() / 1000);
  const body = JSON.stringify({
    chat_id: chatId,
    name: `Pro ${userId.slice(0, 8)}`,
    expire_date: expireDate,
    member_limit: 1,
  });

  for (const base of [relayUrl, "https://api.telegram.org"]) {
    try {
      const response = await fetch(`${base}/bot${token}/createChatInviteLink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.ok) {
        return String(payload.result?.invite_link || "");
      }
      if (base === relayUrl) continue;
    } catch {
      if (base === relayUrl) continue;
    }
  }
  return "";
}
