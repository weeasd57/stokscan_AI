import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { createProTelegramInvite } from "@/lib/telegramProInvite";

export const dynamic = "force-dynamic";

type InviteRow = {
  invite_link: string;
  invite_expires_at: string | null;
};

function isInviteValid(row: InviteRow | null | undefined): row is InviteRow {
  if (!row?.invite_link?.trim()) return false;
  const end = row.invite_expires_at ? new Date(row.invite_expires_at).getTime() : 0;
  return Number.isFinite(end) && end > Date.now();
}

async function loadSavedInvite(service: ReturnType<typeof getSupabaseServiceClient>, userId: string): Promise<InviteRow | null> {
  const { data: primary } = await service
    .from("pro_telegram_invites")
    .select("invite_link,invite_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (isInviteValid(primary)) return primary;

  const { data: orders } = await service
    .from("local_payment_orders")
    .select("telegram_invite_link,telegram_invite_expires_at")
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("telegram_invite_link", "is", null)
    .order("telegram_invite_expires_at", { ascending: false })
    .limit(1);
  const order = orders?.[0];
  if (!order?.telegram_invite_link) return primary;
  const legacy: InviteRow = {
    invite_link: order.telegram_invite_link,
    invite_expires_at: order.telegram_invite_expires_at,
  };
  return isInviteValid(legacy) ? legacy : primary;
}

async function persistInvite(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
  inviteLink: string,
  inviteExpiresAt: string,
) {
  const now = new Date().toISOString();
  const { error: inviteError } = await service.from("pro_telegram_invites").upsert(
    {
      user_id: userId,
      invite_link: inviteLink,
      invite_expires_at: inviteExpiresAt,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (inviteError) console.warn("[telegram-pro] Invite could not be saved to pro_telegram_invites:", inviteError.code || "database_error");

  const { data: orders } = await service
    .from("local_payment_orders")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);
  const orderId = orders?.[0]?.id;
  if (orderId) {
    const { error: orderError } = await service
      .from("local_payment_orders")
      .update({ telegram_invite_link: inviteLink, telegram_invite_expires_at: inviteExpiresAt })
      .eq("id", orderId);
    if (orderError) console.warn("[telegram-pro] Invite could not be saved to the approved order:", orderError.code || "database_error");
  }
}

// The payment service may have the Telegram bot credentials even when the web
// service does not. Reuse its existing, user-scoped approved-order recovery path.
async function recoverInviteFromPaymentService(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
): Promise<string> {
  const backendUrl = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "").replace(/\/$/, "");
  if (!backendUrl) return "";

  const { data: orders, error } = await service
    .from("local_payment_orders")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !orders?.[0]?.id) return "";

  try {
    const response = await fetch(
      `${backendUrl}/payment/local/status?order_id=${encodeURIComponent(orders[0].id)}&user_id=${encodeURIComponent(userId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return "";
    const order = await response.json();
    return typeof order.telegram_pro_url === "string" ? order.telegram_pro_url.trim() : "";
  } catch {
    return "";
  }
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = getSupabaseServiceClient();
  const { data: subscription, error: subscriptionError } = await service
    .from("subscriptions")
    .select("plan_id,status,current_period_end")
    .eq("user_id", user.id)
    .eq("plan_id", "pro")
    .eq("status", "active")
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) {
    console.warn("[telegram-pro] Subscription lookup failed:", subscriptionError.code || "database_error");
    return NextResponse.json({ error: "subscription_unavailable" }, { status: 503 });
  }
  const end = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : 0;
  if (!subscription || !Number.isFinite(end) || end <= Date.now()) {
    return NextResponse.json({ is_pro: false });
  }

  const subscriptionEnd = String(subscription.current_period_end);
  let saved = await loadSavedInvite(service, user.id);

  if (!isInviteValid(saved)) {
    const directInvite = await createProTelegramInvite(user.id, subscriptionEnd).catch(() => "");
    const inviteLink = directInvite || await recoverInviteFromPaymentService(service, user.id);
    if (inviteLink) {
      await persistInvite(service, user.id, inviteLink, subscriptionEnd);
      saved = { invite_link: inviteLink, invite_expires_at: subscriptionEnd };
    } else {
      console.warn("[telegram-pro] Could not issue a VIP invite for an active subscription; check bot channel permissions and Telegram configuration on the web and payment services.");
    }
  }

  const validInvite = isInviteValid(saved) ? saved : null;
  return NextResponse.json({
    is_pro: true,
    current_period_end: subscriptionEnd,
    invite_link: validInvite?.invite_link?.trim() || "",
    invite_expires_at: validInvite?.invite_expires_at || null,
    invite_status: validInvite ? "ready" : "unavailable",
  });
}
