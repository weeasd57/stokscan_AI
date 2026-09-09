import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { paymentsEnabled } from "@/lib/ai/plan-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

// POST /api/payment/kashier/create
// Server-side: verify the authenticated user, then forward to the backend.
// We never trust a client-supplied user_id — the server derives it from the
// Supabase SSR session.
export async function POST(req: NextRequest) {
  try {
    if (!paymentsEnabled()) {
      return NextResponse.json({ detail: "Payments are currently disabled" }, { status: 403 });
    }
    const authClient = createSupabaseServerClient(req);
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id || "pro");
    const email = typeof body.email === "string" ? body.email : user.email || "";

    const res = await fetch(`${BACKEND_URL}/payment/kashier/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, plan_id: planId, email }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    console.error("[api/payment/kashier/create] error:", e);
    return NextResponse.json({ detail: e?.message || "Internal error" }, { status: 500 });
  }
}
