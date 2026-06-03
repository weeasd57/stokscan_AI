import { NextResponse } from "next/server";

export const runtime = "nodejs";

function withTimeout(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, id };
}

export async function POST(req: Request) {
  const base =
    process.env.PYTHON_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    (process.env.VERCEL
      ? "https://weeasdwee-ai-bot.hf.space"
      : "http://127.0.0.1:8000");

  const targetUrl = `${base.replace(/\/$/, "")}/backtest/simulate`;

  let bodyText = "{}";
  try {
    const t = await req.text();
    bodyText = t && t.trim().length ? t : "{}";
  } catch {
    // keep default
  }

  // Strategy simulation can take up to 5 minutes for large date ranges
  const { controller, id } = withTimeout(300_000);
  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": req.headers.get("content-type") || "application/json",
        Accept: req.headers.get("accept") || "application/json",
      },
      body: bodyText,
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("content-type") || "application/json";
    if (upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "content-type": contentType },
      });
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": contentType },
    });
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Strategy simulation timed out (max 5 min)"
        : "Upstream request failed";
    return NextResponse.json({ detail: msg }, { status: 502 });
  } finally {
    clearTimeout(id);
  }
}
