import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await createSupabaseServerClient(req);
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  const orderId = req.nextUrl.searchParams.get("order_id") || "";
  if (!orderId) return NextResponse.json({ detail: "Missing order_id" }, { status: 400 });

  try {
    const service = getSupabaseServiceClient();
    const { data: order, error } = await service
      .from("local_payment_orders")
      .select("id,plan_id,amount_egp,status,provider,telegram_invite_link,telegram_invite_expires_at")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !order) {
      // Fallback to python backend if not found in direct query
      const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
      const { data: { session } } = await auth.auth.getSession();
      if (session?.access_token) {
        const response = await fetch(
          `${BACKEND_URL}/payment/easykash/status?order_id=${encodeURIComponent(orderId)}&user_id=${encodeURIComponent(user.id)}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: "no-store",
            signal: AbortSignal.timeout(6000),
          }
        );
        if (response.ok) return NextResponse.json(await response.json());
      }
      return NextResponse.json({ detail: "Payment order not found" }, { status: 404 });
    }

    let end: string | null = null;
    let inviteLink = order.telegram_invite_link || "";

    if (order.status === "approved") {
      const { data: sub } = await service
        .from("subscriptions")
        .select("current_period_end")
        .eq("user_id", user.id)
        .in("plan_id", ["pro", "lifetime", "pro_lifetime"])
        .eq("status", "active")
        .order("current_period_end", { ascending: false })
        .limit(1)
        .maybeSingle();

      end = sub?.current_period_end || null;

      if (!inviteLink) {
        const { data: invite } = await service
          .from("pro_telegram_invites")
          .select("invite_link")
          .eq("user_id", user.id)
          .maybeSingle();
        inviteLink = invite?.invite_link || "";
      }
    }

    return NextResponse.json({
      ...order,
      subscription: end ? { current_period_end: end } : null,
      telegram_pro_url: inviteLink,
    });
  } catch (err: any) {
    console.error("[api/payment/easykash/status] error:", err);
    return NextResponse.json({ detail: "Payment status is unavailable" }, { status: 503 });
  }
}

