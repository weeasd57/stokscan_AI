import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function POST(req: NextRequest) {
  const auth = createSupabaseServerClient(req);
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const planId = typeof body?.plan_id === "string" ? body.plan_id : "pro";
  const res = await fetch(`${BACKEND_URL}/payment/local/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: user.id, plan_id: planId }), cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
