import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/portfolio — current user's holdings + cash + live valuation + market symbols list
export async function GET() {
    try {
        const supabase = createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { getPortfolioSnapshot } = await import("@/lib/ai/portfolio-tools");
        const snapshot = await getPortfolioSnapshot(supabase, user.id);

        // Real EGX symbols for the profile-page autocomplete selector
        let marketSymbols: Array<{ symbol: string; name: string | null }> = [];
        try {
            const { data: symbolsRows } = await supabase
                .from("stocks")
                .select("symbol, name")
                .order("symbol", { ascending: true })
                .limit(500);
            marketSymbols = (symbolsRows || []).map((r: any) => ({ symbol: r.symbol, name: r.name || null }));
        } catch (e) {
            console.warn("[api/portfolio] symbols list unavailable:", e);
        }

        return NextResponse.json({ ...snapshot, market_symbols: marketSymbols });
    } catch (e: any) {
        console.error("[api/portfolio] GET error:", e);
        return NextResponse.json({ ok: false, message: e?.message || "Internal error" }, { status: 500 });
    }
}

// POST /api/portfolio — manual edits from the profile page
// body: { action: "add" | "update" | "remove" | "sell" | "cash_set", symbol?, quantity?, price? }
export async function POST(req: NextRequest) {
    try {
        const supabase = createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const action = String(body.action || "");
        const symbol = body.symbol ? String(body.symbol).trim().toUpperCase() : "";
        const quantity = body.quantity !== undefined && body.quantity !== null && body.quantity !== "" ? Number(body.quantity) : null;
        const price = body.price !== undefined && body.price !== null && body.price !== "" ? Number(body.price) : null;

        const tools = await import("@/lib/ai/portfolio-tools");
        let result: { ok: boolean; message: string };
        switch (action) {
            case "add":
                if (!symbol || quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
                    return NextResponse.json({ ok: false, message: "symbol و quantity مطلوبان" }, { status: 400 });
                }
                result = await tools.addPortfolioPosition(supabase, user.id, symbol, quantity, price);
                break;
            case "update":
                if (!symbol) return NextResponse.json({ ok: false, message: "symbol مطلوب" }, { status: 400 });
                result = await tools.updatePortfolioPosition(supabase, user.id, symbol, quantity, price);
                break;
            case "remove":
                if (!symbol) return NextResponse.json({ ok: false, message: "symbol مطلوب" }, { status: 400 });
                result = await tools.removePortfolioPosition(supabase, user.id, symbol);
                break;
            case "sell":
                if (!symbol) return NextResponse.json({ ok: false, message: "symbol مطلوب" }, { status: 400 });
                result = await tools.sellPortfolioPosition(supabase, user.id, symbol, quantity, price);
                break;
            case "cash_set":
                if (quantity === null || !Number.isFinite(quantity) || quantity < 0) {
                    return NextResponse.json({ ok: false, message: "قيمة السيولة مطلوبة" }, { status: 400 });
                }
                result = await tools.setPortfolioCash(supabase, user.id, quantity);
                break;
            case "cash_add":
                if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
                    return NextResponse.json({ ok: false, message: "قيمة الإيداع مطلوبة" }, { status: 400 });
                }
                result = await tools.addPortfolioCash(supabase, user.id, quantity);
                break;
            default:
                return NextResponse.json({ ok: false, message: "action غير معروف" }, { status: 400 });
        }

        return NextResponse.json(result);
    } catch (e: any) {
        console.error("[api/portfolio] POST error:", e);
        return NextResponse.json({ ok: false, message: e?.message || "Internal error" }, { status: 500 });
    }
}
