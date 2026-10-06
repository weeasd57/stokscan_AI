import { NextRequest, NextResponse } from "next/server";
import { getViewerContext } from "@/lib/supabase/viewer-context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const backendUrl = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";
    
    // Check viewer context / Pro subscription
    let isPro = false;
    try {
      const viewer = await getViewerContext(req);
      if (viewer?.pro === true) {
        isPro = true;
      }
    } catch {
      // Fallback
    }

    // Support query override for testing if authorized or in dev
    const url = new URL(req.url);
    const proParam = url.searchParams.get("is_pro");
    if (proParam === "true") {
      isPro = true;
    }

    const response = await fetch(`${backendUrl}/api/short-swings?is_pro=${isPro}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch short swings from backend", is_pro: isPro, active_trades: [], closed_trades: [] },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    console.error("Error in /api/short-swings:", error);
    return NextResponse.json(
      { error: "Internal server error fetching short swings", active_trades: [], closed_trades: [] },
      { status: 500 }
    );
  }
}
