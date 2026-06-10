import { NextResponse } from "next/server";

export const runtime = "nodejs";

function backendBaseUrl(): string {
  const raw =
    process.env.PYTHON_BACKEND_URL ||
    (process.env.VERCEL ? process.env.NEXT_PUBLIC_API_BASE_URL : null) ||
    "http://127.0.0.1:8000";
  const base = String(raw).replace(/\/$/, "");
  if (/localhost:3000|:3000\b/.test(base)) {
    return "http://127.0.0.1:8000";
  }
  return base;
}

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const search = incomingUrl.searchParams.toString();
  const targetUrl = `${backendBaseUrl()}/symbols/countries${search ? `?${search}` : ""}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return NextResponse.json({ detail: "Upstream request failed" }, { status: 502 });
  }
}
