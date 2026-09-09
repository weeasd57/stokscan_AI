import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { paymentsEnabled } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

// GET /api/payment/kashier/status?order_ref=...
// Auth-guarded proxy so a user can only poll their own payment status.
export async function GET(req: NextRequest) {
  try {
    if (!paymentsEnabled()) {
      return NextResponse.json({ payment: null, mode: "disabled" });
    }
    const orderRef = req.nextUrl.searchParams.get("order_ref") || "";
    if (!orderRef) {
      return NextResponse.json({ detail: "Missing order_ref" }, { status: 400 });
    }
    const authClient = createSupabaseServerClient(req);
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${BACKEND_URL}/payment/kashier/status?order_ref=${encodeURIComponent(orderRef)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    console.error("[api/payment/kashier/status] error:", e);
    return NextResponse.json({ detail: e?.message || "Internal error" }, { status: 500 });
  }
}
