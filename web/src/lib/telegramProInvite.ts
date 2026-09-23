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

type RevokeProTelegramAccessInput = {
  inviteLink?: string | null;
  telegramUserId?: string | number | null;
};

/** Revoke a user-scoped invite and remove its joined member, when known. */
export async function revokeProTelegramAccess({ inviteLink, telegramUserId }: RevokeProTelegramAccessInput): Promise<{ inviteRevoked: boolean; memberRemoved: boolean }> {
  const token = process.env.SUPPORT_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_PRO_CHAT_ID?.trim();
  if (!token || !chatId) return { inviteRevoked: false, memberRemoved: false };

  const relayUrl = (process.env.TELEGRAM_RELAY_URL || "https://api.telegram.org").replace(/\/$/, "");
  const call = async (method: string, payload: Record<string, unknown>) => {
    for (const base of [relayUrl, "https://api.telegram.org"]) {
      try {
        const response = await fetch(`${base}/bot${token}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.ok) return true;
      } catch {
        // Try Telegram's official endpoint after an unavailable relay.
      }
    }
    return false;
  };

  const inviteRevoked = inviteLink?.trim()
    ? await call("revokeChatInviteLink", { chat_id: chatId, invite_link: inviteLink.trim() })
    : false;
  const rawUserId = String(telegramUserId ?? "").trim();
  if (!/^-?\d+$/.test(rawUserId)) return { inviteRevoked, memberRemoved: false };

  const until = Math.floor(Date.now() / 1000) + 60;
  const banned = await call("banChatMember", { chat_id: chatId, user_id: Number(rawUserId), until_date: until });
  const unbanned = banned && await call("unbanChatMember", { chat_id: chatId, user_id: Number(rawUserId), only_if_banned: true });
  return { inviteRevoked, memberRemoved: Boolean(unbanned) };
}
