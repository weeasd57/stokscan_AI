import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function localAdminRequest(_req: NextRequest) {
  return NextResponse.json(
    { detail: "Admin route is running in Vercel frontend mode." },
    { status: 404 }
  );
}

export async function GET() {
  return NextResponse.json({
    priceSource: "eodhd",
    fundSource: "tradingview",
    maxWorkers: 8,
    enabledModels: [],
    modelAliases: {},
    scanDays: 30,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const config = {
      priceSource: typeof body.priceSource === "string" ? body.priceSource : "eodhd",
      fundSource: typeof body.fundSource === "string" ? body.fundSource : "tradingview",
      maxWorkers: Number.isFinite(body.maxWorkers) && body.maxWorkers > 0 ? Math.floor(body.maxWorkers) : 8,
      enabledModels: Array.isArray(body.enabledModels) ? body.enabledModels : [],
      modelAliases: typeof body.modelAliases === "object" && body.modelAliases !== null ? body.modelAliases : {},
      scanDays: Number.isFinite(body.scanDays) && body.scanDays > 0 ? Math.floor(body.scanDays) : 30,
    };

    return NextResponse.json(config);
  } catch (error) {
    console.error("admin config update error:", error);
    return NextResponse.json({ detail: "Invalid config payload" }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  return POST(req);
}

export async function PATCH(req: NextRequest) {
  return POST(req);
}
