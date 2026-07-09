import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("id", params.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ detail: "Article not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("articles")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ detail: "Article not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("articles")
      .delete()
      .eq("id", params.id);

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}