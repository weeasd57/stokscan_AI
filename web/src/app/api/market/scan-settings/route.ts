import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.PYTHON_BACKEND_URL || process.env.BACKEND_URL || process.env.API_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
  let scanDays = 450;
  try {
    const headers = new Headers();
    if (process.env.ADMIN_SECRET_KEY) headers.set("x-admin-key", process.env.ADMIN_SECRET_KEY);
    const response = await fetch(new URL("/admin/config", backend), {
      headers, cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const config = await response.json();
      if (Number.isInteger(config.scanDays) && config.scanDays > 0 && config.scanDays <= 10000) scanDays = config.scanDays;
    }
  } catch { /* Retain the backend's default when it is unavailable. */ }
  // Expose only the public scanner setting; no keys or operational configuration.
  return NextResponse.json({ scanDays }, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
