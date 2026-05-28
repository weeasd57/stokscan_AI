import { NextResponse } from "next/server";

export const runtime = "nodejs";

function withTimeout(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, id };
}

const base = process.env.PYTHON_BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || (process.env.VERCEL ? "https://weeasdwee-ai-bot.hf.space" : "http://127.0.0.1:8000");

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const search = incomingUrl.searchParams.toString();
  const targetUrl = `${base.replace(/\/$/, "")}/scan/alerts${search ? `?${search}` : ""}`;

  const { controller, id } = withTimeout(30_000);
  try {
    const upstream = await fetch(targetUrl, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("content-type") || "application/json";
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Upstream timeout" : "Upstream request failed";
    return NextResponse.json({ detail: msg }, { status: 502 });
  } finally {
    clearTimeout(id);
  }
}

export async function POST(req: Request) {
  const incomingUrl = new URL(req.url);
  const search = incomingUrl.searchParams.toString();
  const targetUrl = `${base.replace(/\/$/, "")}/scan/alerts${search ? `?${search}` : ""}`;

  let bodyText = "{}";
  try {
    const t = await req.text();
    bodyText = t && t.trim().length ? t : "{}";
  } catch {
    // keep default
  }

  const { controller, id } = withTimeout(30_000);
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
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Upstream timeout" : "Upstream request failed";
    return NextResponse.json({ detail: msg }, { status: 502 });
  } finally {
    clearTimeout(id);
  }
}
