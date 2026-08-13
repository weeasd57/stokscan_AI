import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return createClient(url, key);
}

export async function GET(request: Request) {
    try {
        const auth = await requireAdmin(request);
        if (auth instanceof Response) return auth;
        const supabase = getSupabaseAdminClient();
        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .select("id, system_prompt, updated_at")
            .eq("id", 1)
            .single();

        if (error) {
            if (error.code === "PGRST116") {
                return NextResponse.json({});
            }
            console.error("Error fetching AI settings:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            ...(data || {}),
            api_url: "https://api.deepseek.com",
            model: "deepseek-chat",
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (auth instanceof Response) return auth;

    try {
        const body = await request.json();
        const update: any = {
            id: 1,
            api_url: "https://api.deepseek.com",
            model: "deepseek-chat",
            updated_at: new Date().toISOString(),
        };
        if (body.system_prompt !== undefined) update.system_prompt = body.system_prompt;
        const supabase = getSupabaseAdminClient();
        
        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .upsert(update)
            .select("id, api_url, model, system_prompt, updated_at")
            .single();

        if (error) {
            console.error("Error updating AI settings:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
