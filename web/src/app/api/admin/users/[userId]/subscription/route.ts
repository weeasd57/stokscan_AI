import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { requireAdmin } from "@/lib/admin-auth";
import { revokeProTelegramAccess } from "@/lib/telegramProInvite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminAction = "mark_payment_reviewed" | "cancel_subscription";

export async function POST(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const { userId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action as AdminAction;
  if (!action || !["mark_payment_reviewed", "cancel_subscription"].includes(action)) {
    return NextResponse.json({ detail: "Unsupported subscription action" }, { status: 400 });
  }

  try {
    const service = getSupabaseServiceClient();
    const now = new Date().toISOString();
    const reviewedBy = auth.user?.email || auth.user?.id || "admin";

    if (action === "mark_payment_reviewed") {
      const { data: order, error: orderError } = await service
        .from("local_payment_orders")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "approved")
        .eq("payment_review_status", "pending_review")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order?.id) return NextResponse.json({ detail: "No payment waiting for review" }, { status: 404 });
      const { error } = await service
        .from("local_payment_orders")
        .update({ payment_review_status: "reviewed", payment_reviewed_at: now, payment_reviewed_by: reviewedBy, updated_at: now })
        .eq("id", order.id);
      if (error) throw error;
      return NextResponse.json({ ok: true, payment_review_status: "reviewed" });
    }

    const [profileRes, inviteRes, orderRes] = await Promise.all([
      service.from("profiles").select("telegram_chat_id").eq("id", userId).maybeSingle(),
      service.from("pro_telegram_invites").select("invite_link,vip_telegram_user_id").eq("user_id", userId).maybeSingle(),
      service.from("local_payment_orders")
        .select("id,telegram_invite_link")
        .eq("user_id", userId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (profileRes.error || inviteRes.error || orderRes.error) throw profileRes.error || inviteRes.error || orderRes.error;

    const { error: subscriptionError } = await service
      .from("subscriptions")
      .update({ status: "canceled", current_period_end: now, updated_at: now })
      .eq("user_id", userId)
      .eq("plan_id", "pro")
      .eq("status", "active");
    if (subscriptionError) throw subscriptionError;

    const inviteLink = inviteRes.data?.invite_link || orderRes.data?.telegram_invite_link || "";
    const telegramUserId = inviteRes.data?.vip_telegram_user_id || profileRes.data?.telegram_chat_id || null;
    const revocation = await revokeProTelegramAccess({ inviteLink, telegramUserId });

    const [inviteClear, orderInviteClear, pendingOrderReject] = await Promise.all([
      service.from("pro_telegram_invites").update({ invite_link: "", invite_expires_at: now, updated_at: now }).eq("user_id", userId),
      service.from("local_payment_orders")
        .update({ telegram_invite_link: null, telegram_invite_expires_at: now, updated_at: now })
        .eq("user_id", userId)
        .eq("status", "approved"),
      service.from("local_payment_orders")
        .update({ payment_review_status: "rejected", payment_reviewed_at: now, payment_reviewed_by: reviewedBy, updated_at: now })
        .eq("user_id", userId)
        .eq("status", "approved")
        .eq("payment_review_status", "pending_review"),
    ]);
    if (inviteClear.error || orderInviteClear.error || pendingOrderReject.error) {
      throw inviteClear.error || orderInviteClear.error || pendingOrderReject.error;
    }
    return NextResponse.json({ ok: true, revoked: revocation });
  } catch (error: any) {
    console.error("[admin/users/subscription] action failed:", error?.message || error);
    return NextResponse.json({ detail: "Could not update subscription" }, { status: 500 });
  }
}
