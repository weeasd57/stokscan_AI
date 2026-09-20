import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasActiveProSubscription, planLimits } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Fetch user active subscriptions
    const { data: subRows, error: subErr } = await supabase
      .from("subscriptions")
      .select("id, plan_id, status, current_period_end, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("current_period_end", { ascending: false })
      .limit(5);

    if (subErr) {
      console.warn("[api/user/quota] subscriptions query error:", subErr);
    }

    const pro = hasActiveProSubscription(subRows || []);
    const activeSub = subRows?.[0];
    const planName = pro ? "pro" : "free";
    const limits = { ...planLimits(planName), signal_delay_days: pro ? 0 : 15 };

    // 2. Chatbot messages used this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data: chatRows, error: chatErr } = await supabase
      .from("ai_chat_messages")
      .select("id, client_message_id")
      .eq("user_id", user.id)
      .eq("role", "user")
      .gte("created_at", monthStart.toISOString());

    if (chatErr) {
      console.warn("[api/user/quota] chat count error:", chatErr);
    }

    // 3. Portfolio stocks currently open
    const { data: positionRows, error: posErr } = await supabase
      .from("positions")
      .select("symbol")
      .eq("user_id", user.id)
      .eq("status", "open");

    if (posErr) {
      console.warn("[api/user/quota] positions query error:", posErr);
    }

    const uniqueSymbols = new Set(
      (positionRows || []).map((p: any) => String(p.symbol || "").toUpperCase().trim())
    );
    const portfolioStocksCount = uniqueSymbols.size;

    const chatLimit = limits.chat_messages_per_month;
    const chatUsed = new Set((chatRows || []).map((row: any) => row.client_message_id || row.id)).size;
    const portfolioLimit = limits.portfolio_stocks;

    return NextResponse.json({
      ok: true,
      plan: {
        id: planName,
        label: pro ? "Pro" : "مجاني",
        is_pro: pro,
        status: activeSub?.status || "active",
        current_period_end: activeSub?.current_period_end || null,
        created_at: activeSub?.created_at || null,
      },
      quota: {
        chat_messages: {
          used: chatUsed,
          limit: chatLimit,
          remaining: Math.max(0, chatLimit - chatUsed),
          percent: Math.min(100, Math.round((chatUsed / Math.max(1, chatLimit)) * 100)),
        },
        portfolio_stocks: {
          used: portfolioStocksCount,
          limit: portfolioLimit,
          remaining: Math.max(0, portfolioLimit - portfolioStocksCount),
          percent: Math.min(100, Math.round((portfolioStocksCount / Math.max(1, portfolioLimit)) * 100)),
        },
        signals: {
          delay_days: limits.signal_delay_days,
          is_instant: limits.signal_delay_days === 0,
        },
      },
    });
  } catch (err: any) {
    console.error("[api/user/quota] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
