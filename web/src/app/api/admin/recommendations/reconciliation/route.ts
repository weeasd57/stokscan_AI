import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("reconciliation_conflicts")
      .select("*")
      .order("last_updated_at", { ascending: false });
    if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
    return NextResponse.json({ read_only: true, conflicts: data || [] });
  } catch (error) {
    return NextResponse.json({ detail: String(error) }, { status: 500 });
  }
}
