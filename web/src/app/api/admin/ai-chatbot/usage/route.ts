import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { summarizeUsage } from "@/lib/ai/usage-accounting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;

/** Independent from the conversation window: includes all retained assistant messages.
 * Bounded pagination with an explicit partial flag, never silently calls a cap a lifetime total.
 */
export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    try {
        const supabase = getSupabaseClient();
        const cutoff = new Date().toISOString();
        const groups = new Map<string, ReturnType<typeof summarizeUsage>>();
        let scanned = 0, complete = false;
        while (scanned < MAX_ROWS) {
            const { data, error } = await supabase.from("ai_chat_messages")
                .select("id,user_id,session_id,usage:metadata->usage")
                .eq("role", "assistant").lte("created_at", cutoff)
                .order("id", { ascending: true }).range(scanned, scanned + PAGE_SIZE - 1);
            if (error) throw error;
            const rows = data || [];
            for (const row of rows) {
                const userId = row.user_id || (row.session_id ? `guest_${row.session_id.slice(0, 8)}` : "guest");
                const current = groups.get(userId) || summarizeUsage([]);
                const next = summarizeUsage([{ metadata: { usage: row.usage } }]);
                groups.set(userId, { cost_usd: current.cost_usd + next.cost_usd, messages: current.messages + 1,
                    total_tokens: current.total_tokens + next.total_tokens, unpriced_messages: current.unpriced_messages + next.unpriced_messages });
            }
            scanned += rows.length;
            if (rows.length < PAGE_SIZE) { complete = true; break; }
        }
        // A full final page may still be the entire history: check for one more row.
        if (!complete) {
            const { data, error } = await supabase.from("ai_chat_messages").select("id")
                .eq("role", "assistant").lte("created_at", cutoff).order("id", { ascending: true }).range(scanned, scanned);
            if (error) throw error;
            complete = !data?.length;
        }
        return NextResponse.json({ users: Object.fromEntries(groups),
            complete, scanned_messages: scanned, as_of: cutoff, scope: "retained_assistant_messages" },
            { headers: { "Cache-Control": "private, no-store" } });
    } catch {
        return NextResponse.json({ error: "تعذر تحميل إجماليات الاستهلاك" }, { status: 500 });
    }
}
