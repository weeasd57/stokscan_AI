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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const alertId = params.id;
    if (!alertId) {
      return NextResponse.json({ error: "Missing alert ID" }, { status: 400 });
    }

    const body = await req.json();
    const { is_active } = body;

    if (is_active === undefined) {
      return NextResponse.json({ error: "Missing is_active parameter" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient(req);
    const user = await getAuthenticatedUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await (supabase
      .from("technical_alerts") as any)
      .update({ is_active })
      .eq("id", alertId)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to update alert" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const alertId = params.id;
    if (!alertId) {
      return NextResponse.json({ error: "Missing alert ID" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient(req);
    const user = await getAuthenticatedUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("technical_alerts")
      .delete()
      .eq("id", alertId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json({ status: "deleted" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to delete alert" }, { status: 500 });
  }
}
