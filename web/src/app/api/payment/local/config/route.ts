import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = !["", "0", "false", "no", "off"].includes((process.env.LOCAL_VODAFONE_CASH_ENABLED || "false").toLowerCase());
  return NextResponse.json({
    enabled,
    provider: "vodafone_cash",
    amount_egp: Number(process.env.LOCAL_PRO_PRICE_EGP || "300"),
    qr_url: process.env.VODAFONE_CASH_QR_URL || "",
    wallet_number: process.env.VODAFONE_CASH_NUMBER || "",
  });
}
