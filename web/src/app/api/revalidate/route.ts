import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

export const runtime = "nodejs";

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

  const path = searchParams.get("path");
  const tag = searchParams.get("tag");
  const revalidated: string[] = [];

  try {
    if (tag) {
      revalidateTag(tag);
      revalidated.push(`tag:${tag}`);
    }

    if (path) {
      if (path === "all" || path === "*") {
        revalidatePath("/", "layout");
        revalidated.push("all-layout");
      } else {
        revalidatePath(path);
        revalidated.push(path);
      }
    } else if (!tag) {
      // Default: purge cache across all pages, layout and major data endpoints
      revalidatePath("/", "layout");
      revalidatePath("/");
      revalidatePath("/scanner/market");
      revalidated.push("layout", "home", "market");
    }

    return NextResponse.json({
      ok: true,
      message: "Cache successfully revalidated",
      revalidated,
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
