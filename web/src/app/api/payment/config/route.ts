import { NextResponse } from "next/server";
import { paymentsEnabled, planLimits } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/payment/config
// Public config so the UI knows whether to show purchase flow and the limits.
export async function GET() {
  const enabled = paymentsEnabled();
  if (!enabled) {
    return NextResponse.json({ enabled: false, mode: "disabled", free: planLimits("free") });
  }
  return NextResponse.json({
    enabled: true,
    mode: "local",
    provider: "vodafone_cash",
    currency: "EGP",
    payment_methods: ["wallet"],
    free: planLimits("free"),
    pro: planLimits("pro"),
  });
}
