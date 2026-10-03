import { NextRequest, NextResponse } from "next/server";
import { getViewerIdentity } from "@/lib/supabase/viewer-context";
import { getPublicMarketClient, getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { loadPortfolioPerformance } from "@/lib/portfolio-performance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vercel-CDN-Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  Vary: "Cookie",
};

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getViewerIdentity(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const report = await loadPortfolioPerformance(getSupabaseServiceClient(), getPublicMarketClient(), userId);
    return NextResponse.json(report, { headers });
  } catch (error) {
    console.error("[portfolio/performance] report unavailable", error);
    return NextResponse.json({ error: "Portfolio performance unavailable" }, { status: 503, headers });
  }
}
