import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
    try {
        const auth = await requireAdmin(_req);
        if (auth instanceof Response) return auth;
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .select("*")
            .eq("id", 1)
            .single();

        if (error && error.code !== "PGRST116") { // Ignore not found error if it's not initialized
            return NextResponse.json({ detail: error.message }, { status: 500 });
        }

        const safe = { ...(data || {}) } as any;
        delete safe.api_key;
        return NextResponse.json(safe);
    } catch (e) {
        return NextResponse.json({ detail: "Internal error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdmin(req);
        if (auth instanceof Response) return auth;
        const supabase = getSupabaseClient();
        const body = await req.json();

        // Safely extract fields
        const updateData: any = { updated_at: new Date().toISOString() };
        if (body.api_url !== undefined) updateData.api_url = body.api_url;
        if (body.api_key !== undefined) updateData.api_key = body.api_key;
        if (body.model !== undefined) updateData.model = body.model;
        if (body.system_prompt !== undefined) updateData.system_prompt = body.system_prompt;

        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .upsert({ id: 1, ...updateData })
            .select()
            .single();

        if (error) {
            return NextResponse.json({ detail: error.message }, { status: 500 });
        }

        const safe = { ...data } as any;
        delete safe.api_key;
        return NextResponse.json(safe);
    } catch (e) {
        return NextResponse.json({ detail: "Internal error" }, { status: 500 });
    }
}
