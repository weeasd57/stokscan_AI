import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function POST(req: NextRequest) {
  const auth = createSupabaseServerClient(req);
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const { data: { session } } = await auth.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const mobile = String(body?.mobile || "").replace(/[\s-]/g, "");
  if (!/^01[0125]\d{8}$/.test(mobile)) {
    return NextResponse.json({ detail: "أدخل رقم موبايل مصري صحيح من أي شبكة" }, { status: 400 });
  }
  try {
    const response = await fetch(`${BACKEND_URL}/payment/easykash/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        user_id: user.id,
        plan_id: typeof body?.plan_id === "string" ? body.plan_id : "pro",
        email: user.email || "",
        name: String(user.user_metadata?.full_name || user.user_metadata?.name || "EGX Bots user").slice(0, 100),
        mobile,
      }),
      cache: "no-store",
    });
    return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
  } catch {
    return NextResponse.json({ detail: "تعذر الاتصال بخدمة الدفع" }, { status: 503 });
  }
}
