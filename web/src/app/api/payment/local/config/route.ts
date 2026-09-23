import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = !["", "0", "false", "no", "off"].includes((process.env.LOCAL_VODAFONE_CASH_ENABLED || "false").toLowerCase());
  const monthly = Number(process.env.PRO_PRICE_EGP || process.env.LOCAL_PRO_PRICE_EGP || "200");
  return NextResponse.json({
    enabled,
    provider: "vodafone_cash",
    amount_egp: monthly,
    plans: [
      { id: "pro", name_ar: "شهري", name_en: "Monthly", amount_egp: monthly, days: 30 },
      { id: "pro_6m", name_ar: "6 شهور", name_en: "6 Months", amount_egp: Number(process.env.PRO_6M_PRICE_EGP || "1000"), days: 180 },
      { id: "pro_1y", name_ar: "سنة", name_en: "1 Year", amount_egp: Number(process.env.PRO_1Y_PRICE_EGP || "1950"), days: 365 },
    ],
    qr_url: process.env.VODAFONE_CASH_QR_URL || "",
    wallet_number: process.env.VODAFONE_CASH_NUMBER || "",
  });
}
