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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const supabase = getSupabaseClient();

    const [posRes, stocksRes] = await Promise.all([
      supabase.from("positions").select("user_id,symbol,name,quantity,entry_price,entry_at,status,updated_at").eq("status", "open").limit(100000),
      supabase.from("stocks").select("symbol,name,name_ar").is("is_active", true),
    ]);
    if (posRes.error) return NextResponse.json({ detail: posRes.error.message }, { status: 500 });
    const positions = (posRes.data || []) as PositionRow[];
    const stockNames = new Map<string, { name?: string | null; name_ar?: string | null }>(
      (stocksRes.data || []).map((s: any) => [String(s.symbol).toUpperCase(), s] as const),
    );

    const userIds = Array.from(new Set(positions.map((p) => String(p.user_id))));
    const [profilesRes, authRes] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("id,display_name,username").in("id", userIds) : Promise.resolve({ data: [] }),
      supabase.auth.admin.listUsers({ page: 1, perPage: 2000 }).catch(() => ({ data: { users: [] } })),
    ]);
    const emailById = new Map((authRes?.data?.users || []).map((u: any) => [String(u.id), u.email || null]));
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

    const users = Array.from(byUser.entries())
      .map(([userId, positionsList]) => {
        const user = nameById.get(userId) || {};
        const open = positionsList.filter((p) => String(p.status).toLowerCase() === "open");
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
          last_updated_at: lastUpdated ? new Date(lastUpdated).toISOString() : null,
          positions: positionsList,
        };
      })
      .sort((a, b) => b.positions_count - a.positions_count || String(a.display_name || "").localeCompare(String(b.display_name || "")));

    return NextResponse.json({
      totalPortfolioUsers: users.length,
      totalOpenPositions: positions.length,
      topStocks,
      users,
    });
  } catch (e) {
    console.error("[admin/users/portfolio] failed:", e);
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
