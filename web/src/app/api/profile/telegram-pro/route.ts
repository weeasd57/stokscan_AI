import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";

export const dynamic = "force-dynamic";

async function createVipInvite(userId: string, expiresAt: string): Promise<string> {
  const token = process.env.SUPPORT_BOT_TOKEN || process.env.ARTORO_AI_BOT;
  const chatId = process.env.TELEGRAM_PRO_CHAT_ID;
  if (!token || !chatId) return "";
  const response = await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      name: `Pro ${userId.slice(0, 8)}`,
      expire_date: Math.floor(new Date(expiresAt).getTime() / 1000),
      member_limit: 10,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return response.ok && payload?.ok ? String(payload.result?.invite_link || "") : "";
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = getSupabaseServiceClient();
  const { data: subscription } = await service
    .from("subscriptions")
    .select("plan_id,status,current_period_end")
    .eq("user_id", user.id)
    .eq("plan_id", "pro")
    .eq("status", "active")
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  const end = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : 0;
  if (!subscription || !Number.isFinite(end) || end <= Date.now()) return NextResponse.json({ is_pro: false });

  const { data: orders } = await service
    .from("local_payment_orders")
    .select("id,telegram_invite_link,telegram_invite_expires_at")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("telegram_invite_expires_at", { ascending: false })
    .limit(1);
  let order = orders?.[0] || null;
  // A renewed subscription can have several approved orders. Prefer any
  // still-valid saved invite before attempting to create another one.
  if (!order?.telegram_invite_link) {
    const { data: savedInvites } = await service
      .from("local_payment_orders")
      .select("id,telegram_invite_link,telegram_invite_expires_at")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .not("telegram_invite_link", "is", null)
      .order("telegram_invite_expires_at", { ascending: false })
      .limit(1);
    order = savedInvites?.[0] || order;
  }
  const subscriptionEnd = String(subscription.current_period_end);
  const inviteEnd = order?.telegram_invite_expires_at ? new Date(order.telegram_invite_expires_at).getTime() : 0;
  if (!order?.telegram_invite_link || !Number.isFinite(inviteEnd) || inviteEnd <= Date.now()) {
    const invite = await createVipInvite(user.id, subscriptionEnd).catch(() => "");
    if (invite) {
      const patch = { telegram_invite_link: invite, telegram_invite_expires_at: subscriptionEnd };
      if (order?.id) {
        const { data } = await service.from("local_payment_orders").update(patch).eq("id", order.id).select("telegram_invite_link,telegram_invite_expires_at").maybeSingle();
        order = { ...order, ...(data || patch) };
      }
    }
  }
  return NextResponse.json({ is_pro: true, current_period_end: subscriptionEnd, invite_link: order?.telegram_invite_link || "", invite_expires_at: order?.telegram_invite_expires_at || null });
}
