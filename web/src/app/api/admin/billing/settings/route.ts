import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createClient(url, key);
}

const SELECT_COLS =
  "pro_price_egp,pro_6m_price_egp,pro_1y_price_egp,discount_enabled,discount_price_egp,discount_ends_at,discount_label_ar,discount_label_en,updated_at";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("local_billing_settings")
      .select(SELECT_COLS)
      .eq("id", 1)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || {});
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function validIsoOrEmpty(value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "__invalid__";
  return date.toISOString();
}

function validPriceOrNull(value: unknown): number | null | "__invalid__" {
  if (value === null || value === "" || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "__invalid__";
  return num;
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };

    const priceFields: Array<[string, "pro_price_egp" | "pro_6m_price_egp" | "pro_1y_price_egp"]> = [
      ["pro_price_egp", "pro_price_egp"],
      ["pro_6m_price_egp", "pro_6m_price_egp"],
      ["pro_1y_price_egp", "pro_1y_price_egp"],
    ];
    for (const [key, column] of priceFields) {
      if (body[key] === undefined) continue;
      const price = validPriceOrNull(body[key]);
      if (price === "__invalid__") return NextResponse.json({ error: `Invalid price for ${key}` }, { status: 400 });
      patch[column] = price;
    }

    if (typeof body.discount_enabled === "boolean") {
      const endsAt = validIsoOrEmpty(body.discount_ends_at ?? body.discountEndsAt);
      if (endsAt === "__invalid__") return NextResponse.json({ error: "Invalid discount_ends_at" }, { status: 400 });
      const discountPrice = validPriceOrNull(body.discount_price_egp);
      if (discountPrice === "__invalid__") return NextResponse.json({ error: "Invalid discount_price_egp" }, { status: 400 });
      if (body.discount_enabled && (discountPrice === null || discountPrice <= 0 || endsAt === null)) {
        return NextResponse.json({ error: "Discount requires a positive price and an end date" }, { status: 400 });
      }
      patch.discount_enabled = body.discount_enabled;
      patch.discount_price_egp = discountPrice;
      patch.discount_ends_at = endsAt;
      if (body.discount_label_ar !== undefined) patch.discount_label_ar = String(body.discount_label_ar).slice(0, 100);
      if (body.discount_label_en !== undefined) patch.discount_label_en = String(body.discount_label_en).slice(0, 100);
    } else {
      if (body.discount_label_ar !== undefined) patch.discount_label_ar = String(body.discount_label_ar).slice(0, 100);
      if (body.discount_label_en !== undefined) patch.discount_label_en = String(body.discount_label_en).slice(0, 100);
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.from("local_billing_settings").upsert(patch).select(SELECT_COLS).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
