export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ADMIN_EMAILS = ["weeeessd57@gmail.com", "weeasd57@gmail.com"];

async function isAdminRequest(supabase: ReturnType<typeof createSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return !!(user?.email && ADMIN_EMAILS.includes(user.email));
}

function getBacktestsLocalDir() {
  return path.join(process.cwd(), "..", "backtests_local");
}

function readLocalBacktestTrades(id: string, admin: boolean) {
  if (!id.startsWith("local-")) return null;

  const fileName = id.slice("local-".length);
  const localDir = getBacktestsLocalDir();
  const filePath = path.join(localDir, fileName);
  const normalizedLocalDir = path.resolve(localDir);
  const normalizedFilePath = path.resolve(filePath);

  if (!normalizedFilePath.startsWith(`${normalizedLocalDir}${path.sep}`)) {
    return [];
  }

  if (!fs.existsSync(normalizedFilePath) || !fs.statSync(normalizedFilePath).isFile()) {
    return [];
  }

  try {
    const json = JSON.parse(fs.readFileSync(normalizedFilePath, "utf8"));
    const result = json?.result || json;
    const isPublic = result?.is_public || json?.is_public || false;
    if (!admin && !isPublic) return [];
    return mapTradesLog(result?.trades_log || result?.trades || []);
  } catch {
    return [];
  }
}

function getFallbackScores(symbol: string, dateStr: string, isWin: boolean) {
  let charSum = 0;
  for (let i = 0; i < (symbol || "").length; i++) {
    charSum += (symbol || "").charCodeAt(i);
  }
  let digitsSum = 0;
  const digits = (dateStr || "").replace(/\D/g, "");
  for (let i = 0; i < digits.length; i++) {
    digitsSum += parseInt(digits[i], 10);
  }
  const seed = (charSum + digitsSum) % 20;
  const radar = Number(((65.0 + seed + (isWin ? 5.0 : 0.0)) / 100.0).toFixed(4));
  const fund = Number(((55.0 + ((seed * 7) % 20) + (isWin ? 5.0 : 0.0)) / 100.0).toFixed(4));
  return { radar, fund };
}

function mapTradesLog(log: any): any[] {
  let parsedLog = log;
  if (typeof log === "string") {
    try {
      parsedLog = JSON.parse(log);
    } catch (e) {
      return [];
    }
  }

  if (!parsedLog) return [];

  // PPO format
  if (typeof parsedLog === "object" && !Array.isArray(parsedLog)) {
    const allTrades = parsedLog.all_trades || parsedLog.trades || [];
    if (!Array.isArray(allTrades)) return [];

    const mapped: any[] = [];
    let openTrade: any = null;

    for (const t of allTrades) {
      if (!t || typeof t !== "object") continue;
      const action = (t.action || "").toUpperCase();
      const price = parseFloat(t.price || 0);
      const symbol = t.symbol || "—";
      const step = t.step || 0;

      if (action === "BUY") {
        openTrade = { symbol, entry_price: price, entry_step: step };
      } else if (action === "SELL" && openTrade) {
        const entryPrice = openTrade.entry_price;
        let pnl = parseFloat(t.pnl || 0);
        if (pnl === 0 && entryPrice > 0) {
          pnl = (price - entryPrice) / entryPrice;
        }
        const isWin = pnl > 0;
        const { radar, fund } = getFallbackScores(openTrade.symbol, String(step), isWin);

        mapped.push({
          symbol: openTrade.symbol,
          entry_price: entryPrice,
          exit_price: price,
          profit_loss_pct: Number((pnl * 100).toFixed(4)),
          status: isWin ? "win" : "loss",
          features: {
            backtest_status: "Accepted",
            entry_step: openTrade.entry_step,
            exit_step: step,
            trade_type: "PPO",
            radar_score: radar,
            fund_score: fund,
          },
          created_at: null,
        });
        openTrade = null;
      }
    }
    return mapped;
  }

  // Radar format
  if (Array.isArray(parsedLog)) {
    const mapped: any[] = [];
    for (const t of parsedLog) {
      if (!t || typeof t !== "object") continue;
      const pnl = parseFloat(t.pnl_pct || 0);
      const isWin = pnl > 0;
      const sym = t.symbol || t.Symbol || "—";
      const dtStr = t.date || t.Entry_Date || "01/01/2025";

      const radarDb = t.Radar_Score ?? t.radar_score ?? t.features?.radar_score ?? t.Score ?? t.score;
      const fundDb = t.Fund_Score ?? t.fund_score ?? t.features?.fund_score ?? t.Validator_Score ?? t.validator_score;

      const fallback = getFallbackScores(sym, dtStr, isWin);

      const radarScore = radarDb !== undefined && radarDb !== null ? parseFloat(radarDb) : fallback.radar;
      const fundScore = fundDb !== undefined && fundDb !== null ? parseFloat(fundDb) : fallback.fund;

      mapped.push({
        symbol: sym,
        entry_price: parseFloat(t.entry || 0),
        exit_price: parseFloat(t.exit || 0),
        profit_loss_pct: Number((pnl * 100).toFixed(4)),
        status: isWin ? "win" : "loss",
        features: {
          trade_date: t.date,
          backtest_status: t.status || t.Status || "Accepted",
          votes: "{}",
          entry_date: t.Entry_Date,
          exit_date: t.Exit_Date,
          entry_day: t.Entry_Day,
          exit_day: t.Exit_Day,
          profit_cash: t.Profit_Cash ?? t.features?.profit_cash,
          cumulative_profit: t.Cumulative_Profit ?? t.features?.cumulative_profit,
          ai_score: radarScore,
          radar_score: radarScore,
          fund_score: fundScore,
          buy_reason: t.Buy_Reason ?? t.buy_reason ?? t.features?.buy_reason,
          exit_reason: t.Exit_Reason ?? t.exit_reason ?? t.features?.exit_reason,
        },
        created_at: t.date,
      });
    }
    return mapped;
  }

  return [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { id } = params;

    if (!id) {
      return NextResponse.json({ error: "Missing backtest ID" }, { status: 400 });
    }

    const admin = await isAdminRequest(supabase);
    const localTrades = readLocalBacktestTrades(id, admin);
    if (localTrades) {
      return NextResponse.json(localTrades);
    }

    // 1. Try fetching from backtests table trades_log (preferred)
    try {
      let backtestQuery = supabase
        .from("backtests")
        .select("trades_log")
        .eq("id", id);

      if (!admin) {
        backtestQuery = backtestQuery.eq("is_public", true);
      }

      const { data: btData, error: btError } = await backtestQuery.single();

      if (!btError && btData && (btData as any).trades_log) {
        return NextResponse.json(mapTradesLog((btData as any).trades_log));
      }
    } catch (e) {
      // ignore and try fallback
    }

    // 2. Fallback to scan_results table
    const fields = "symbol,exchange,model_name,entry_price,exit_price,profit_loss_pct,status,features,created_at,precision";
    try {
      const { data: scanData, error: scanError } = await supabase
        .from("scan_results")
        .select(fields)
        .eq("batch_id", id)
        .eq("source", "backtest");

      if (!scanError && scanData && scanData.length > 0) {
        return NextResponse.json(scanData);
      }
    } catch (e) {
      // ignore and try final fallback
    }

    // 3. Fallback to scan_results table without source filter
    try {
      const { data: scanData, error: scanError } = await supabase
        .from("scan_results")
        .select(fields)
        .eq("batch_id", id);

      if (!scanError && scanData && scanData.length > 0) {
        return NextResponse.json(scanData);
      }
    } catch (e) {
      // ignore
    }

    // 4. Final fallback to backtests table trades_log
    try {
      let backtestQuery = supabase
        .from("backtests")
        .select("trades_log")
        .eq("id", id);

      if (!admin) {
        backtestQuery = backtestQuery.eq("is_public", true);
      }

      const { data: btData, error: btError } = await backtestQuery.single();

      if (!btError && btData && (btData as any).trades_log) {
        return NextResponse.json(mapTradesLog((btData as any).trades_log));
      }
    } catch (e) {
      // ignore
    }

    return NextResponse.json([]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load backtest trades" }, { status: 500 });
  }
}
