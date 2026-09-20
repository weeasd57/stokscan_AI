import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isChatAdminEmail } from "@/lib/chat-sharing";

export async function requireAdmin(request: Request): Promise<{ user: any } | Response> {
    const client = createSupabaseServerClient(request as any);
    const { data: { user }, error } = await client.auth.getUser();
    const isAdmin = !error && user && (
        user.app_metadata?.role === "admin" || isChatAdminEmail(user.email)
    );
    const unlockSecret = process.env.ADMIN_SECRET_PASSWORD;
    const unlockCookie = request.headers.get("cookie")?.match(/(?:^|;\s*)admin_unlock=([^;]+)/)?.[1];
    const unlocked = Boolean(unlockSecret && unlockCookie && decodeURIComponent(unlockCookie) === unlockSecret);
    if (!isAdmin && !unlocked) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    return { user };
}
