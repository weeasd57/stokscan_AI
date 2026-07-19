import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return createClient(url, key);
}

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdminClient();
        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .select("*")
            .eq("id", 1)
            .single();

        if (error) {
            console.error("Error fetching AI settings:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data || {});
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const supabase = getSupabaseAdminClient();
        
        const { data, error } = await supabase
            .from("ai_chatbot_settings")
            .upsert({ id: 1, ...body, updated_at: new Date().toISOString() })
            .select()
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
