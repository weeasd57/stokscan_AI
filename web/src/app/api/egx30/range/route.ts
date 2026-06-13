export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Egx30Row = {
  date: string;
  open?: number | string | null;
  close?: number | string | null;
};

function toNum(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : null;
  if (n === null || !Number.isFinite(n)) return null;
  return n;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!start || !end) {
      return NextResponse.json({ error: "Missing start/end" }, { status: 400 });
    }

    const startStr = start.includes("T") ? start.split("T")[0] : start;
    const endStr = end.includes("T") ? end.split("T")[0] : end;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );

    const { data: period, error } = await supabase
      .from("stock_prices")
      .select("date, open, close")
      .eq("symbol", "EGX30")
      .eq("exchange", "INDX")
      .gte("date", startStr)
      .lte("date", endStr)
      .order("date", { ascending: true });

    if (error) {
      throw new Error(`Supabase query error: ${error.message}`);
    }

    if (period.length < 2) {
      return NextResponse.json({ return_pct: null });
    }

    const first = period[0];
    const last = period[period.length - 1];
    const startPrice = toNum(first.open) ?? toNum(first.close);
    const endPrice = toNum(last.close);
    if (startPrice === null || endPrice === null) {
      return NextResponse.json({ return_pct: null });
    }

    const pct = ((endPrice - startPrice) / startPrice) * 100;
    return NextResponse.json({ return_pct: Math.round(pct * 100) / 100 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to compute EGX30 return" },
      { status: 500 }
    );
  }
}

