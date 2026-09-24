import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const auth = createSupabaseServerClient(req);
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const { data: { session } } = await auth.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const orderId = req.nextUrl.searchParams.get("order_id") || "";
  try {
    const response = await fetch(`${BACKEND_URL}/payment/easykash/status?order_id=${encodeURIComponent(orderId)}&user_id=${encodeURIComponent(user.id)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Payment status is unavailable" }, { status: 503 });
  }
}
