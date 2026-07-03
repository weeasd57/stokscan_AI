import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return NextResponse.json({ detail: error.message }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("articles")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ detail: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(req, context);
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("articles").delete().eq("id", id);
    if (error) return NextResponse.json({ detail: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
