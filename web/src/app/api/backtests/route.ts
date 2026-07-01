export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ADMIN_EMAILS = ["weeeessd57@gmail.com", "weeasd57@gmail.com"];

type BacktestRecord = Record<string, any>;

const backtestsSoftCache = new Map<string, { data: BacktestRecord[]; ts: number }>();

function getCacheKey(admin: boolean, model: string | null) {
  return JSON.stringify({ admin, model: model || null });
}

function getBacktestsLocalDir() {
  return path.join(process.cwd(), "..", "backtests_local");
}

function normalizeLocalBacktest(filePath: string, fileName: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  const result = json?.result || json;
  const createdAt =
    json?.saved_at ||
    json?.created_at ||
    result?.created_at ||
    `${fs.statSync(filePath).mtime.toISOString()}`;

  return {
    id: `local-${fileName}`,
    model_name: json?.model || json?.model_name || result?.model_name,
    exchange: result?.exchange || json?.exchange,
    start_date: result?.start_date || json?.start_date,
    end_date: result?.end_date || json?.end_date,
    total_trades: result?.total_trades,
    win_rate: result?.win_rate,
    net_profit: result?.net_profit,
    avg_return_per_trade: result?.avg_return_per_trade,
    trades_log: result?.trades_log || result?.trades || [],
    status: result?.status || "completed",
    status_msg: result?.status_msg || json?.status_msg,
    meta_threshold: result?.meta_threshold || result?.wave_confluence || result?.king_threshold,
    council_threshold: result?.council_threshold,
    target_pct: result?.target_pct,
    stop_loss_pct: result?.stop_loss_pct,
    capital: result?.capital,
    created_at: createdAt,
    council_model: result?.council_model,
    pre_council_win_rate: result?.pre_council_win_rate,
    pre_council_profit_pct: result?.pre_council_profit_pct,
    post_council_win_rate: result?.post_council_win_rate,
    post_council_profit_pct: result?.post_council_profit_pct,
    is_public: result?.is_public || json?.is_public || false,
    is_favorite: result?.is_favorite || json?.is_favorite || false,
    saved_local_path: filePath,
  };
}

function mergeLocalBacktests(data: BacktestRecord[], admin: boolean, model: string | null) {
  const localDir = getBacktestsLocalDir();
  if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
    return data;
  }

  const merged = [...data];
  const files = fs.readdirSync(localDir).filter((file) => file.toLowerCase().endsWith(".json")).sort().reverse();

  for (const file of files) {
    try {
      const localRecord = normalizeLocalBacktest(path.join(localDir, file), file);
      if (model && localRecord.model_name !== model) continue;
      if (!admin && !localRecord.is_public) continue;

      const exists = merged.some((record) => {
        return (
          String(record.model_name || record.model) === String(localRecord.model_name) &&
          String(record.start_date) === String(localRecord.start_date) &&
          String(record.end_date) === String(localRecord.end_date)
        );
      });

      if (!exists) {
        merged.unshift(localRecord);
      }
    } catch {
      // Ignore malformed local fallback files, matching the Python route behavior.
    }
  }

  return merged;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const model = searchParams.get("model");
  const adminRequested = searchParams.get("admin") === "true";

  try {
    const supabase = createSupabaseServerClient();
    
    // Check if the user is authenticated and is an admin
    const { data: { user } } = await supabase.auth.getUser();
    const isAdminUser = !!(user?.email && ADMIN_EMAILS.includes(user.email));

    const columns = [
      "id", "model_name", "exchange", "start_date", "end_date", "total_trades", "win_rate", "net_profit",
      "avg_return_per_trade", "status", "status_msg", "meta_threshold", "council_threshold",
      "target_pct", "stop_loss_pct", "capital", "created_at", "council_model",
      "pre_council_win_rate", "pre_council_profit_pct", "post_council_win_rate", "post_council_profit_pct", "is_public", "is_favorite"
    ].join(",");

    let query = supabase
      .from("backtests")
      .select(columns)
      .order("created_at", { ascending: false });

    if (model) {
      query = query.eq("model_name", model);
    }

    // Only return public backtests for regular users or if admin isn't requested
    if (!isAdminUser || !adminRequested) {
      query = query.eq("is_public", true);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(backtestsSoftCache.get(getCacheKey(isAdminUser && adminRequested, model))?.data || []);
    }

    const merged = mergeLocalBacktests(data || [], isAdminUser && adminRequested, model);
    backtestsSoftCache.set(getCacheKey(isAdminUser && adminRequested, model), { data: merged, ts: Date.now() });

    return NextResponse.json(merged);
  } catch (e: any) {
    return NextResponse.json(backtestsSoftCache.get(getCacheKey(false, model))?.data || []);
  }
}
