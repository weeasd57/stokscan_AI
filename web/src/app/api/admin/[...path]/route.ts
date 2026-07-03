import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackendBaseUrl() {
  return (
    process.env.PYTHON_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000"
  );
}

function parseFundamentalsPath(path: string) {
  if (!path.startsWith("fundamentals/")) return null;
  const ticker = path.slice("fundamentals/".length);
  const rawTicker = decodeURIComponent(ticker);
  const [symbolPart, exchangePart] = rawTicker.split(".");
  return {
    ticker: rawTicker,
    symbol: (symbolPart || rawTicker).trim().toUpperCase(),
    exchange: (exchangePart || "").trim().toUpperCase(),
  };
}

async function proxyAdminRequest(req: Request, context: { params: { path?: string[] } }) {
  const path = (context.params.path || []).join("/");
  const fundamentalsRequest = req.method.toUpperCase() === "GET" ? parseFundamentalsPath(path) : null;

  if (fundamentalsRequest?.symbol) {
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("stock_fundamentals")
        .select("data, fund_score, updated_at")
        .eq("symbol", fundamentalsRequest.symbol)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (fundamentalsRequest.exchange) {
        query = query.eq("exchange", fundamentalsRequest.exchange);
      }

      const { data, error } = await query.maybeSingle();
      if (!error && data?.data) {
        return NextResponse.json({
          ticker: fundamentalsRequest.ticker,
          data: data.data,
          meta: {
            source: "supabase",
            updated_at: data.updated_at,
            fund_score: data.fund_score,
          },
        });
      }
    } catch (error) {
      console.error("Supabase fundamentals lookup failed:", error);
    }
  }

  const backendUrl = new URL(`/admin/${path}`, getBackendBaseUrl());
  const incomingUrl = new URL(req.url);

  incomingUrl.searchParams.forEach((value, key) => {
    backendUrl.searchParams.append(key, value);
  });

  const headers = new Headers(req.headers);
  headers.delete("host");
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (adminKey && path.startsWith("fundamentals/")) {
    headers.set("x-admin-key", adminKey);
  }

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  try {
    const backendRes = await fetch(backendUrl.toString(), {
      method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    const contentType = backendRes.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await backendRes.json();

      if (fundamentalsRequest && backendRes.ok) {
        try {
          const fundamentals = data?.data ?? null;

          if (fundamentalsRequest.symbol && fundamentals && typeof fundamentals === "object") {
            const supabase = getSupabaseClient();
            await supabase.from("stock_fundamentals").upsert(
              {
                symbol: fundamentalsRequest.symbol,
                exchange: fundamentalsRequest.exchange,
                data: fundamentals,
                updated_at: new Date().toISOString(),
              },
              {
                onConflict: "symbol,exchange",
              }
            );
          }
        } catch (syncError) {
          console.error("Failed to backfill stock_fundamentals:", syncError);
        }
      }

      return NextResponse.json(data, { status: backendRes.status });
    }

    const text = await backendRes.text();
    if (fundamentalsRequest && !backendRes.ok) {
      return NextResponse.json({
        ticker: fundamentalsRequest.ticker,
        data: null,
        meta: {
          source: "missing",
          status: backendRes.status,
          detail: text,
        },
      });
    }

    return new NextResponse(text, {
      status: backendRes.status,
      headers: {
        "content-type": contentType || "text/plain; charset=utf-8",
      },
    });
  } catch (error: any) {
    console.error("Admin proxy error:", error);
    const isUnreachable =
      error?.cause?.code === "ECONNREFUSED" ||
      error?.name === "TimeoutError" ||
      error?.code === "ECONNREFUSED";
    return NextResponse.json(
      {
        detail: isUnreachable
          ? `Admin backend is unreachable. Route '${path}' requires the Python backend to be running.`
          : `Failed to proxy admin route '${path}'`,
        error: error?.message || "Unknown proxy error",
      },
      { status: isUnreachable ? 503 : 502 }
    );
  }
}

export const GET = proxyAdminRequest;
export const POST = proxyAdminRequest;
export const PUT = proxyAdminRequest;
export const PATCH = proxyAdminRequest;
export const DELETE = proxyAdminRequest;
