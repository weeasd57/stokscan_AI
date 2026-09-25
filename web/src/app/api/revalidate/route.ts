import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { DAILY_CACHE_TAG_VALUES } from "@/lib/cache/daily";
import { refreshMarketQueries } from "@/lib/cache/market-query-cache";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleRevalidate(req);
}

export async function GET(req: NextRequest) {
  return handleRevalidate(req);
}

async function handleRevalidate(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const authHeader = req.headers.get("authorization");

  const validSecret =
    process.env.REVALIDATE_SECRET ||
    process.env.ADMIN_SECRET_KEY ||
    process.env.CRON_SECRET;

  const isAuthorized =
    Boolean(validSecret) &&
    (secret === validSecret || authHeader === `Bearer ${validSecret}`);

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing secret token" },
      { status: 401 }
    );
  }

  const body = req.method === "POST"
    ? await req.json().catch(() => ({} as Record<string, unknown>))
    : {};
  const path = searchParams.get("path") || (typeof body.path === "string" ? body.path : null);
  const requestedTags = [
    ...searchParams.getAll("tag"),
    ...(Array.isArray(body.tags) ? body.tags.filter((tag: unknown): tag is string => typeof tag === "string") : []),
    ...(typeof body.tag === "string" ? [body.tag] : []),
  ];
  const tags = [...new Set(requestedTags.map((tag) => tag.trim()).filter(Boolean))];
  const revalidated: string[] = [];
  const cdnInvalidated: string[] = [];

  try {
    if (tags.some(tag => !DAILY_CACHE_TAG_VALUES.includes(tag as any))) {
      return NextResponse.json({ error: "Unknown daily cache tag" }, { status: 400 });
    }
    // Refresh first, invalidate responses second. A failure preserves the old
    // generation and prevents a thundering herd of CDN misses hitting Supabase.
    const refreshTags = tags.length ? tags : DAILY_CACHE_TAG_VALUES;
    const eventId = typeof body.event_id === "string" ? body.event_id : new Date().toISOString();
    if (eventId.length > 100 || !Number.isFinite(Date.parse(eventId))) {
      return NextResponse.json({ error: "Invalid event_id" }, { status: 400 });
    }
    const marketCache = await refreshMarketQueries(refreshTags, eventId);
    if (tags.length > 0) {
      for (const tag of tags) {
        revalidateTag(tag);
        revalidated.push(`tag:${tag}`);
      }
      await invalidateByTag(tags);
      cdnInvalidated.push(...tags);
    }

    if (path) {
      if (path === "all" || path === "*") {
        revalidatePath("/", "layout");
        revalidated.push("all-layout");
      } else {
        revalidatePath(path);
        revalidated.push(path);
      }
    } else if (tags.length === 0) {
      // Default: purge cache across all pages, layout and major data endpoints
      revalidatePath("/", "layout");
      revalidatePath("/");
      revalidatePath("/scanner/market");
      revalidated.push("layout", "home", "market");
      await invalidateByTag(DAILY_CACHE_TAG_VALUES);
      cdnInvalidated.push(...DAILY_CACHE_TAG_VALUES);
    }

    return NextResponse.json({
      ok: true,
      message: "Cache successfully revalidated",
      revalidated,
      cdn_invalidated: cdnInvalidated,
      market_cache: marketCache,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[REVALIDATE] Error occurred during cache revalidation:", err);
    return NextResponse.json(
      { error: "Revalidation failed", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
