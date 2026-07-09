import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAuthenticatedUser(supabase: ReturnType<typeof createSupabaseServerClient>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseServerClient(req);
    const user = await getAuthenticatedUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("technical_alerts")
      .select("*")
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alerts: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load alerts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, filters } = body;

    if (!name || !filters) {
      return NextResponse.json({ error: "Missing required fields (name, filters)" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient(req);
    const user = await getAuthenticatedUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = {
      user_id: user.id,
      name,
      filters,
      is_active: true,
    };

    const { data, error } = await (supabase
      .from("technical_alerts") as any)
      .insert(payload)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to create alert" }, { status: 500 });
  }
}
