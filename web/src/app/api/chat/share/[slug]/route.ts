import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
        .from("shared_chat_posts")
        .select("slug, question, answer, title, created_at")
        .eq("slug", params.slug)
        .eq("is_published", true)
        .maybeSingle();

    if (error || !data) return NextResponse.json({ error: "المشاركة غير موجودة" }, { status: 404 });
    return NextResponse.json(data);
}
