import { NextRequest, NextResponse } from "next/server";
import { getViewerContext } from "@/lib/supabase/viewer-context";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";

export const dynamic = "force-dynamic";

function maskTradesForFreeUser(trades: any[], cutoffDate: string) {
  return (trades || []).map((t: any) => {
    const entryDate = t.entry_date || "";
    const isPending = Boolean(t.is_pending_entry);
    const isRecent = isPending || Boolean(entryDate && entryDate >= cutoffDate);
    if (isRecent) {
      const sym = String(t.symbol || "");
      return {
        // The backend signal id contains the real ticker/date; do not expose
        // it to free users alongside the masked symbol.
        signal_id: null,
        symbol: sym.length > 2 ? `${sym.slice(0, 2)}**` : "**",
        name_ar: "سهم قيادي مشفر (متاح لـ PRO)",
        name_en: "PRO Signal",
        sector: t.sector || "عام",
        entry_date: t.entry_date,
        signal_date: t.signal_date,
        entry_price: null,
        current_price: null,
        reference_close: null,
        trailing_stop: null,
        stop_loss: null,
        ema10_trend: null,
        return_pct: t.return_pct ?? 0,
        is_breakeven_protected: Boolean(t.is_breakeven_protected),
        max_gain_pct: t.max_gain_pct ?? 0,
        trigger_type: "صفقة زخم وليدة مشفرة",
        status: t.status,
        is_pending_entry: isPending,
        is_locked: true,
      };
    }
    return { ...t, is_locked: false };
  });
}

export async function GET(req: NextRequest) {
  try {
    const backendUrl = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";

    // 1. Check viewer context / Pro subscription strictly from authenticated session
    let isPro = false;
    try {
      const viewer = await getViewerContext(req);
      if (viewer?.pro === true) {
        isPro = true;
      }
    } catch {
      isPro = false;
    }

    // 2. Refresh parameter: only allowed for verified admins to prevent abuse/DoS
    const url = new URL(req.url);
    const wantsRefresh = url.searchParams.get("refresh") === "true";
    let isAdmin = false;
    if (wantsRefresh) {
      const adminHeader = req.headers.get("x-admin-key");
      const configuredKey = process.env.ADMIN_SECRET_KEY;
      if (adminHeader && configuredKey && adminHeader === configuredKey) {
        isAdmin = true;
      } else {
        try {
          const { requireAdmin } = await import("@/lib/admin-auth");
          const adminCheck = await requireAdmin(req);
          if (!(adminCheck instanceof Response) && (adminCheck as any)?.user) {
            isAdmin = true;
          }
        } catch {
          isAdmin = false;
        }
      }
    }
    const passRefresh = wantsRefresh && isAdmin;

    // 3. Fetch shared daily dataset from backend with internal secret
    const adminKey = process.env.ADMIN_SECRET_KEY || "";
    const fetchHeaders: Record<string, string> = {};
    if (adminKey) {
      fetchHeaders["x-admin-key"] = adminKey;
    }

    const fetchUrl = `${backendUrl}/api/short-swings?is_pro=true${passRefresh ? "&refresh=true" : ""}`;
    
    // Cache the upstream dataset with Next.js daily tag unless refreshing
    const fetchOptions: RequestInit = passRefresh
      ? { cache: "no-store", headers: fetchHeaders }
      : {
          headers: fetchHeaders,
          next: {
            tags: [DAILY_CACHE_TAGS.shortSwings],
            revalidate: 86400,
          },
        };

    const response = await fetch(fetchUrl, fetchOptions);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch short swings from backend", is_pro: isPro, active_trades: [], closed_trades: [] },
        { status: response.status }
      );
    }

    const data = await response.json();

    // 4. Calculate 15-day freshness window for masking
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 15);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // 5. Apply entitlement-based masking dynamically for this user
    let activeTrades = data.active_trades || [];
    let closedTrades = (data.closed_trades || []).map((t: any) => ({ ...t, is_locked: false }));

    if (!isPro) {
      activeTrades = maskTradesForFreeUser(activeTrades, cutoffDate);
    } else {
      activeTrades = activeTrades.map((t: any) => ({ ...t, is_locked: false }));
    }

    const responsePayload = {
      status: data.status || "ok",
      is_pro: isPro,
      kpis: data.kpis || {},
      active_trades: activeTrades,
      closed_trades: closedTrades,
      total_active: activeTrades.length,
      total_closed: closedTrades.length,
      as_of: data.as_of,
      cutoff_date_15d: cutoffDate,
      ...(!isPro
        ? {
            upgrade_cta:
              "اشترك في باقة PRO للوصول اللحظي لإشارات الصفقات القصيرة فور ظهورها ومستويات الوقف المتحرك اليومية.",
          }
        : {}),
    };

    // Personalized response: must not be cached by shared CDN proxies
    return NextResponse.json(responsePayload, {
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "Vercel-CDN-Cache-Control": "private, no-store",
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
