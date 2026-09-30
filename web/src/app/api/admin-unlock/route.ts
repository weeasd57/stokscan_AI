import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Log admin access events to the admin_access_logs table */
async function logAdminAccess(
    eventType: "page_view" | "unlock_success" | "unlock_failed",
    req: NextRequest,
    userEmail?: string,
    userId?: string,
) {
    try {
        const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
        const userAgent = req.headers.get("user-agent") || "unknown";
        await supabaseAdmin.from("admin_access_logs").insert({
            user_id: userId || null,
            user_email: userEmail || null,
            event_type: eventType,
            ip_address: ip,
            user_agent: userAgent,
        });
    } catch (e) {
        console.error("[admin-unlock] Failed to log access:", e);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { password, userEmail, userId } = await req.json();
        const secret = process.env.ADMIN_SECRET_PASSWORD;

        if (!secret) {
            return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
        }

        if (!password || typeof password !== "string") {
            return NextResponse.json({ ok: false, error: "Password required" }, { status: 400 });
        }

        if (password === secret) {
            // Log successful unlock
            await logAdminAccess("unlock_success", req, userEmail, userId);

            const response = NextResponse.json({ ok: true });
            response.cookies.set("admin_unlock", secret, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 8,
            });
            return response;
        }

        // Log failed unlock attempt
        await logAdminAccess("unlock_failed", req, userEmail, userId);

        return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
    } catch {
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
}
