import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin-access-log
 * Logs admin page view and access events for analytics.
 */
export async function POST(req: NextRequest) {
    try {
        const { eventType, userEmail, userId } = await req.json();

        if (!eventType || !["page_view", "unlock_success", "unlock_failed", "unauthorized_attempt"].includes(eventType)) {
            return NextResponse.json({ ok: false, error: "Invalid event type" }, { status: 400 });
        }

        const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
        const userAgent = req.headers.get("user-agent") || "unknown";

        await supabaseAdmin.from("admin_access_logs").insert({
            user_id: userId || null,
            user_email: userEmail || null,
            event_type: eventType,
            ip_address: ip,
            user_agent: userAgent,
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
}

/**
 * GET /api/admin-access-log
 * Returns admin access analytics summary.
 */
export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from("admin_access_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        const logs = data || [];
        const pageViews = logs.filter((l) => l.event_type === "page_view");
        const unlockSuccess = logs.filter((l) => l.event_type === "unlock_success");
        const unlockFailed = logs.filter((l) => l.event_type === "unlock_failed");

        const unauthorizedAttempts = logs.filter((l) => l.event_type === "unauthorized_attempt");

        // Unique users
        const uniqueViewers = new Set(pageViews.map((l) => l.user_email).filter(Boolean));
        const uniqueUnlockers = new Set(unlockSuccess.map((l) => l.user_email).filter(Boolean));

        return NextResponse.json({
            ok: true,
            summary: {
                totalPageViews: pageViews.length,
                uniqueViewers: uniqueViewers.size,
                totalUnlockSuccess: unlockSuccess.length,
                uniqueUnlockers: uniqueUnlockers.size,
                totalUnlockFailed: unlockFailed.length,
                totalUnauthorizedAttempts: unauthorizedAttempts.length,
                viewers: Array.from(uniqueViewers),
                unlockers: Array.from(uniqueUnlockers),
            },
            logs,
        });
    } catch {
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
}
