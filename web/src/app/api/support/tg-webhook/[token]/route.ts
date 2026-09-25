import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = process.env.SUPPORT_BOT_TOKEN?.trim();
  if (!token || params.token !== token) {
    return NextResponse.json({ error: "Unauthorized token" }, { status: 403 });
  }
  const backend = process.env.PYTHON_BACKEND_URL || process.env.TRADING_SIGNALS_API_URL;
  if (!backend) return NextResponse.json({ error: "Backend unavailable" }, { status: 503 });
  try {
    const backendUrl = new URL(backend);
    if (backendUrl.protocol !== "https:" && backendUrl.hostname !== "localhost" && backendUrl.hostname !== "127.0.0.1") {
      return NextResponse.json({ error: "Backend URL is not secure" }, { status: 503 });
    }
    const target = new URL(`/support-tg-webhook/${encodeURIComponent(token)}`, backendUrl);
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await req.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return NextResponse.json({ error: "Backend rejected update" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 });
  }
}
