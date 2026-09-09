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
    mode: (process.env.KASHIER_MODE || "test") as string,
    currency: "EGP",
    payment_methods: (process.env.KASHIER_ALLOWED_METHODS || "card,wallet")
      .split(",")
      .map((m: string) => m.trim())
      .filter(Boolean),
    free: planLimits("free"),
    pro: planLimits("pro"),
  });
}
