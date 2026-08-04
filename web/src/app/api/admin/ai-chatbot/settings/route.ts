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
            .select("*")
            .eq("id", 1)
            .single();

        if (error) {
            if (error.code === "PGRST116") {
                return NextResponse.json({});
            }
            console.error("Error fetching AI settings:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const safe = data ? { ...data, api_key: undefined } : {};
        delete (safe as any).api_key;
        return NextResponse.json(safe);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (auth instanceof Response) return auth;

    try {
        const body = await request.json();
        const update: any = { id: 1, updated_at: new Date().toISOString() };
        for (const key of ["api_url", "api_key", "model", "system_prompt"]) if (body[key] !== undefined) update[key] = body[key];
        const supabase = getSupabaseAdminClient();
        
        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .upsert(update)
            .select()
            .single();

        if (error) {
            console.error("Error updating AI settings:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const safe = { ...data } as any;
        delete safe.api_key;
        return NextResponse.json(safe);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
