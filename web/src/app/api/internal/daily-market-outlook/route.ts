import { NextRequest, NextResponse } from "next/server";
import { executeStructuredTools } from "@/lib/ai/tools-v2";
import { getDeepSeekApiKey } from "@/lib/ai/server-secrets";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import type { IntentPlan, ToolResult } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DailyContext = {
  date: string;
  recommendationGate?: {
    blocked?: boolean;
    reason?: string;
    latestClose?: number;
    sma50?: number;
    percentVsSma50?: number;
  };
  recommendationsCreated?: number;
};

export async function POST(request: NextRequest) {
  const expectedKey = process.env.ADMIN_SECRET_KEY?.trim();
  const providedKey = request.headers.get("x-admin-key")?.trim();
  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deepSeekKey = getDeepSeekApiKey();
  if (!deepSeekKey) {
    return NextResponse.json({ error: "DeepSeek is not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as DailyContext;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || ""))) {
      return NextResponse.json({ error: "A valid Cairo market date is required" }, { status: 400 });
    }

    const plan: IntentPlan = {
      intent: "market_summary",
      confidence: 1,
      entities: {
        symbols: [],
        sector: null,
        timeframe: "current",
        reference: null,
        requested_date: null,
        requested_start_date: null,
        requested_end_date: null,
        requested_sectors: [],
        excluded_sectors: [],
      },
      needs_vision_context: false,
      needs_history: false,
      needs_live_data: true,
      needs_historical_data: false,
      tools: ["get_market", "get_sector_liquidity"],
      clarification_needed: false,
      resolved_from: { symbol: null, message_id: null },
    };

    const supabase = getSupabaseServiceClient({ cacheMarketData: true });
    const toolOutput = await executeStructuredTools(
      supabase,
      plan,
      [],
      "",
      `daily-market-outlook-${body.date}`,
      "قدّم نظرة يومية موجزة على سوق EGX والسيولة والقطاعات، اعتمادًا حصريًا على بيانات الأدوات المرفقة.",
      [],
    );

    const market = toolOutput.results.find((result) => result.tool === "get_market");
    const liquidity = toolOutput.results.find((result) => result.tool === "get_sector_liquidity");
    if (!market?.data || market.error || !liquidity?.data || liquidity.error) {
      return NextResponse.json(
        { error: "Market or sector-liquidity tool did not return usable data" },
        { status: 503 },
      );
    }

    const contextResult: ToolResult = {
      tool: "daily_job_context",
      source: "daily_recommendation_run",
      data_time: body.date,
      symbols: ["EGX30"],
      data_type: "cached",
      data: {
        date: body.date,
        recommendation_gate: body.recommendationGate || null,
        recommendations_created: Math.max(0, Number(body.recommendationsCreated || 0)),
      },
    };
    const evidence = JSON.stringify({
      tools: toolOutput.results.map((result) => ({
        tool: result.tool,
        date: result.data_time,
        data: result.data,
        error: result.error || null,
      })),
      daily_job: contextResult.data,
    }).slice(0, 22000);
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deepSeekKey}`,
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.15,
        max_tokens: 900,
        stream: false,
        messages: [
          {
            role: "system",
            content: "أنت محرر ملخص سوق مصري. اكتب رسالة تيليجرام عربية موجزة بعنوان نظرة السوق اليومية. استخدم الأدلة المرفقة فقط، ولا تستنتج اتجاهًا أو سيولة أو أرقامًا غير موجودة. وضّح تاريخ بيانات السوق إن توفر، واذكر اتجاه EGX30/EGX100، تركّز السيولة بين القطاعات، وقرار التوصيات وسببه الفني كما ورد. لا تقدم توصية شراء/بيع. إذا غابت معلومة فقل إنها غير متاحة. اختم بأن الملخص تحليلي وليس نصيحة استثمارية. أخرج نص الرسالة فقط.",
          },
          {
            role: "user",
            content: `أنشئ مسودة اليوم ${body.date} للقناتين. لا ترسلها. هذه البيانات المنظمة من الأدوات الفعلية وسجل التشغيل:\n${evidence}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`[daily-market-outlook] DeepSeek returned HTTP ${response.status}`);
      return NextResponse.json({ error: "DeepSeek could not generate the daily market outlook" }, { status: 503 });
    }
    const completion = await response.json();
    const message = String(completion?.choices?.[0]?.message?.content || "").trim();
    if (!message) {
      return NextResponse.json({ error: "DeepSeek returned an empty market outlook" }, { status: 503 });
    }

    return NextResponse.json({
      date: body.date,
      message: message.trim(),
      model: String(completion?.model || "deepseek-chat"),
      sources: [market.source, liquidity.source],
      marketDataDate: market.data_time,
      liquidityDataDate: liquidity.data_time,
    });
  } catch (error) {
    console.error("daily market outlook generation failed:", error);
    return NextResponse.json({ error: "Could not generate the daily market outlook" }, { status: 500 });
  }
}
