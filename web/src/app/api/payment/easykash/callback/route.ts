import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

// EasyKash calls this public Vercel URL. Signature verification and payment
// activation happen in the private application API, never in the browser.
export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const response = await fetch(`${BACKEND_URL}/payment/easykash/callback`, {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
      body,
      cache: "no-store",
    });
    return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Callback processor is unavailable" }, { status: 503 });
  }
}
