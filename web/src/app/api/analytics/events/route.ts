import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { getViewerIdentity } from "@/lib/supabase/viewer-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set(["page_view", "feature_use"]);

function cleanMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-zA-Z0-9_:-]{1,50}$/.test(key)) continue;
    if (typeof item === "string") result[key] = item.slice(0, 240);
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "boolean") result[key] = item;
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    // Telemetry can fire on every navigation/feature action. Verify the
    // cookie access JWT without touching the refresh token so telemetry can
    // never participate in an auth-refresh fan-out.
    const { userId } = await getViewerIdentity(request);
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const eventName = String(body?.event_name || "");
    if (!ALLOWED_EVENTS.has(eventName)) return NextResponse.json({ ok: false }, { status: 400 });
    const path = String(body?.path || "").slice(0, 180);
    if (!path.startsWith("/")) return NextResponse.json({ ok: false }, { status: 400 });
    const service = getSupabaseServiceClient();
    const { error } = await service.from("user_activity_events").insert({
      user_id: userId,
      session_id: String(body?.session_id || "").slice(0, 100) || null,
      event_name: eventName,
      path,
      metadata: cleanMetadata(body?.metadata),
    });
    if (error) {
      // Keep telemetry non-blocking during rollout if the migration has not run yet.
      console.warn("[activity] event insert skipped:", error.code || error.message);
      return NextResponse.json({ ok: false, unavailable: true }, { status: 202 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[activity] event route failed:", error);
    return NextResponse.json({ ok: false }, { status: 202 });
  }
}
