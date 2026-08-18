import { NextRequest, NextResponse } from "next/server";

/**
 * Vercel Cron Job — يتشغل يومياً 13:00 UTC (16:00 Cairo) أحد-خميس
 * يستدعي الـ FastAPI backend لتشغيل مسح التجميع والتصريف
 * ويحدث جدول stock_scans_summary في Supabase
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

export async function GET(req: NextRequest) {
    // حماية: فقط Vercel Cron أو طلبات مصرح بها
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const backendUrl = process.env.PYTHON_BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL;

    if (!backendUrl) {
        console.error("[CRON] PYTHON_BACKEND_URL not configured");
        return NextResponse.json({ error: "Backend URL not configured" }, { status: 500 });
    }

    const startedAt = new Date().toISOString();
    console.log(`[CRON] accumulation-scan started at ${startedAt}`);

    try {
        const response = await fetch(`${backendUrl}/api/run-accumulation-scan`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Cron-Secret": cronSecret || "",
            },
            signal: AbortSignal.timeout(270_000),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`[CRON] Backend returned ${response.status}: ${text}`);
            return NextResponse.json(
                { error: "Backend scan failed", status: response.status, details: text },
                { status: 502 }
            );
        }

        const result = await response.json();
        console.log(`[CRON] accumulation-scan completed:`, result);
        return NextResponse.json({ ok: true, startedAt, result });

    } catch (err: any) {
        console.error("[CRON] accumulation-scan error:", err?.message || err);
        return NextResponse.json(
            { error: "Cron job failed", message: err?.message || String(err) },
            { status: 500 }
        );
    }
}
