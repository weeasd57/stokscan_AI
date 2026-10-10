import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { isUuid } from "@/lib/ai/session";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    // Trace can include private conversation data; only return the signed-in admin's own requests.
    if (!auth.user?.id) return NextResponse.json({error: "Sign in required"}, {status: 401});
    if (req.nextUrl.searchParams.get("action") === "access") return NextResponse.json({ authorized: true, deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA || null, environment: process.env.VERCEL_ENV || "local" }, {headers: {"Cache-Control": "private, no-store"}});
    const sessionId = req.nextUrl.searchParams.get("session_id");
    if (!isUuid(sessionId)) return NextResponse.json({error: "Invalid session"}, {status: 400});
    const { data, error } = await getSupabaseServiceClient().from("ai_chat_messages")
        .select("id,session_id,created_at,content,trace:metadata->diagnostic_trace,usage:metadata->usage,review:metadata->publication_review,origin:metadata->response_origin")
        .eq("user_id", auth.user.id).eq("session_id", sessionId).eq("role", "assistant")
        .order("created_at", {ascending: false}).limit(2);
    if (error) return NextResponse.json({error: "Trace unavailable"}, {status: 503});
    return NextResponse.json({messages: data || []}, {headers: {"Cache-Control": "private, no-store"}});
}
