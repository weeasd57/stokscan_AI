import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const user_id = url.searchParams.get("user_id");
    const supabase = getSupabaseClient();

    // Read bot configs
    let configsQuery = supabase
      .from("bot_configs")
      .select("bot_id, config, updated_at, user_id")
      .order("updated_at", { ascending: false });
    if (user_id) configsQuery = configsQuery.eq("user_id", user_id);
    const { data: configs } = await configsQuery;

    // Read bot states
    const { data: states } = await supabase
      .from("bot_states")
      .select("bot_id, state, updated_at");
    const stateMap: Record<string, Record<string, unknown>> = {};
    (states || []).forEach((s: Record<string, unknown>) => {
      stateMap[s.bot_id as string] = s.state as Record<string, unknown>;
    });

    const bots = (configs || []).map((cfg: Record<string, unknown>) => {
      const config = (cfg.config || {}) as Record<string, unknown>;
      const botId = cfg.bot_id as string;
      const state = stateMap[botId] || {};
      return {
        bot_id: botId,
        name: (config.name as string) || botId,
        status: (config.status as string) || "stopped",
        trading_mode: (config.trading_mode as string) || "virtual",
        timeframe: (config.timeframe as string) || "1Hour",
        data_source: (config.data_source as string) || "binance",
        virtual_cash: (config.virtual_cash as number) ?? 10000,
        coins: Array.isArray(config.coins) ? config.coins : [],
        updated_at: cfg.updated_at,
        state,
      };
    });

    return NextResponse.json({ bots });
  } catch {
    return NextResponse.json({ bots: [] });
  }
}
