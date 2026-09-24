import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = (process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/payment/easykash/config`, { cache: "no-store" });
    return NextResponse.json(await response.json().catch(() => ({ enabled: false })), { status: response.status });
  } catch {
    return NextResponse.json({ enabled: false, mode: "disabled", provider: "easykash" }, { status: 503 });
  }
}
