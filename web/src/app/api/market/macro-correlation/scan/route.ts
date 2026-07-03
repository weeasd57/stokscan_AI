import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Porting the full macro-correlation logic to TS is too complex due to pandas/numpy dependency.
  // We return an empty state that the frontend can handle gracefully.
  return NextResponse.json({
    updated_at: new Date().toISOString(),
    symbols: []
  });
}
