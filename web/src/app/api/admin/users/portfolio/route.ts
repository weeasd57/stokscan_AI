import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PositionRow = {
  user_id: string | null;
  symbol: string | null;
  name: string | null;
  quantity: number | string | null;
  entry_price: number | string | null;
  entry_at: string | null;
  status: string | null;
  updated_at: string | null;
  [key: string]: unknown;
};

type PortfolioUser = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  positions_count: number;
  open_count: number;
  total_quantity: number;
  portfolio_value: number;
  priced_positions: number;
  last_updated_at: string | null;
  positions: PositionRow[];
};

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const supabase = getSupabaseClient();

    const [posRes, stocksRes, latestDateRes] = await Promise.all([
      supabase.from("positions").select("user_id,symbol,name,quantity,entry_price,entry_at,status,updated_at").eq("status", "open").limit(100000),
      supabase.from("stocks").select("symbol,name,name_ar").is("is_active", true),
      supabase.from("stock_prices").select("date").eq("exchange", "EGX").order("date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (posRes.error) return NextResponse.json({ detail: posRes.error.message }, { status: 500 });
    const positions = (posRes.data || []) as PositionRow[];
    const latestDate = latestDateRes.data?.date || null;
    const symbols = Array.from(new Set(positions.map((p) => String(p.symbol || "").toUpperCase()).filter(Boolean)));
    const pricesRes = latestDate && symbols.length
      ? await supabase.from("stock_prices").select("symbol,close").eq("exchange", "EGX").eq("date", latestDate).in("symbol", symbols).limit(10000)
      : { data: [], error: null };
    const latestPrices = new Map<string, number>();
    for (const row of pricesRes.data || []) {
      const close = Number(row.close);
      if (Number.isFinite(close)) latestPrices.set(String(row.symbol).toUpperCase(), close);
    }
    const stockNames = new Map<string, { name?: string | null; name_ar?: string | null }>(
      (stocksRes.data || []).map((s: any) => [String(s.symbol).toUpperCase(), s] as const),
    );

    const userIds = Array.from(new Set(positions.map((p) => String(p.user_id))));
    const [profilesRes, authRes] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("id,display_name,username").in("id", userIds) : Promise.resolve({ data: [] }),
      supabase.auth.admin.listUsers({ page: 1, perPage: 2000 }).catch(() => ({ data: { users: [] } })),
    ]);
    const emailById = new Map<string, string | null>((authRes?.data?.users || []).map((u: any) => [String(u.id), u.email ? String(u.email) : null] as const));
    const nameById = new Map<string, { display_name?: string | null; username?: string | null }>(
      (profilesRes.data || []).map((p: any) => [String(p.id), p] as const),
    );

    const byUser = new Map<string, any[]>();
    for (const pos of positions) {
      const id = String(pos.user_id);
      if (!byUser.has(id)) byUser.set(id, []);
      const sym = String(pos.symbol || "").toUpperCase();
      const stock = stockNames.get(sym);
      byUser.get(id)!.push({
        ...pos,
        symbol: sym,
        name: pos.name || stock?.name || null,
        name_ar: stock?.name_ar || null,
      });
    }

    const topStocksMap = new Map<string, { users: Set<string>; positions: number; quantity: number }>();
    for (const pos of positions) {
      const sym = String(pos.symbol || "").toUpperCase();
      if (!sym) continue;
      const row = topStocksMap.get(sym) || { users: new Set<string>(), positions: 0, quantity: 0 };
      row.users.add(String(pos.user_id));
      row.positions += 1;
      row.quantity += Number(pos.quantity || 0);
      topStocksMap.set(sym, row);
    }
    const topStocks = Array.from(topStocksMap.entries())
      .map(([symbol, row]) => ({ symbol, users: row.users.size, positions: row.positions, quantity: row.quantity }))
      .sort((a, b) => b.users - a.users || b.positions - a.positions)
      .slice(0, 15);

    const users: PortfolioUser[] = Array.from(byUser.entries())
      .map(([userId, positionsList]) => {
        const user = nameById.get(userId) || {};
        const open = positionsList.filter((p) => String(p.status).toLowerCase() === "open");
        const pricedPositions = open.filter((p) => latestPrices.has(String(p.symbol || "").toUpperCase()));
        const portfolioValue = pricedPositions.reduce((sum, p) => sum + Number(p.quantity || 0) * (latestPrices.get(String(p.symbol || "").toUpperCase()) || 0), 0);
        const lastUpdated = positionsList.reduce((latest, p) => {
          const t = new Date(p.updated_at || p.entry_at || 0).getTime();
          return t > latest ? t : latest;
        }, 0);
        return {
          user_id: userId,
          display_name: user.display_name || user.username || null,
          email: emailById.get(userId) || null,
          positions_count: positionsList.length,
          open_count: open.length,
          total_quantity: positionsList.reduce((sum: number, p) => sum + Number(p.quantity || 0), 0),
          portfolio_value: Math.round(portfolioValue * 100) / 100,
          priced_positions: pricedPositions.length,
          last_updated_at: lastUpdated ? new Date(lastUpdated).toISOString() : null,
          positions: positionsList,
        };
      })
      .sort((a, b) => b.positions_count - a.positions_count || String(a.display_name || "").localeCompare(String(b.display_name || "")));

    const totalPortfolioValue = users.reduce((sum, user) => sum + user.portfolio_value, 0);

    return NextResponse.json({
      totalPortfolioUsers: users.length,
      totalOpenPositions: positions.length,
      latestPriceDate: latestDate,
      totalPortfolioValue: Math.round(totalPortfolioValue * 100) / 100,
      topStocks,
      users,
    });
  } catch (e) {
    console.error("[admin/users/portfolio] failed:", e);
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
