import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { isChatAdminEmail } from "@/lib/chat-sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeSlug(): string {
    return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function POST(request: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(request);
        const { data: { user } } = await authClient.auth.getUser();
        if (!isChatAdminEmail(user?.email)) {
            return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
        }

        const body = await request.json();
        const question = typeof body.question === "string" ? body.question.trim() : "";
        const answer = typeof body.answer === "string" ? body.answer.trim() : "";
        if (!question || !answer) {
            return NextResponse.json({ error: "السؤال والإجابة مطلوبان" }, { status: 400 });
        }
        if (question.length > 4000 || answer.length > 50000) {
            return NextResponse.json({ error: "النص أطول من الحد المسموح" }, { status: 400 });
        }

        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from("shared_chat_posts")
            .insert({
                slug: makeSlug(),
                question,
                answer,
                title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 160) : "تحليل من EGX Bots",
                created_by: user.id,
                is_published: true,
            })
            .select("slug")
            .single();

        if (error || !data) {
            return NextResponse.json({ error: error?.message || "تعذر إنشاء المشاركة" }, { status: 500 });
        }

        const origin = new URL(request.url).origin;
        return NextResponse.json({ slug: data.slug, url: `${origin}/blogs/chat/${data.slug}` }, { status: 201 });
    } catch {
        return NextResponse.json({ error: "تعذر إنشاء المشاركة" }, { status: 500 });
    }
}
