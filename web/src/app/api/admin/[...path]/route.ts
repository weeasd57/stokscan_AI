import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_BASE =
  process.env.PYTHON_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.VERCEL ? "https://weeasdwee-ai-bot.hf.space" : "http://127.0.0.1:8000");

function withTimeout(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, id };
}

async function proxyAdminRequest(req: Request, context: { params: { path?: string[] } }) {
  const incomingUrl = new URL(req.url);
  const path = (context.params.path || []).map(encodeURIComponent).join("/");
  const search = incomingUrl.searchParams.toString();
  const targetUrl = `${BACKEND_BASE.replace(/\/$/, "")}/admin/${path}${search ? `?${search}` : ""}`;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  const accept = req.headers.get("accept");
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);

  // Forward authorization if present (client-side auth token)
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    headers.set("authorization", authHeader);
  }

  // Forward middleware-injected or client-supplied x-admin-key
  const incomingAdminKey = req.headers.get("x-admin-key");
  if (incomingAdminKey && incomingAdminKey !== "undefined" && incomingAdminKey !== "null") {
    headers.set("x-admin-key", incomingAdminKey);
  } else if (process.env.ADMIN_SECRET_KEY) {
    headers.set("x-admin-key", process.env.ADMIN_SECRET_KEY);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const { controller, id } = withTimeout(300_000);
  init.signal = controller.signal;

  try {
    const upstream = await fetch(targetUrl, init);
    const responseHeaders = new Headers();
    responseHeaders.set("content-type", upstream.headers.get("content-type") || "application/json");

    if (upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (e: any) {
    const detail = e?.name === "AbortError" ? "Admin backend timeout" : "Admin backend request failed";
    return NextResponse.json({ detail }, { status: 502 });
  } finally {
    clearTimeout(id);
  }
}

export const GET = proxyAdminRequest;
export const POST = proxyAdminRequest;
export const PUT = proxyAdminRequest;
export const PATCH = proxyAdminRequest;
export const DELETE = proxyAdminRequest;
