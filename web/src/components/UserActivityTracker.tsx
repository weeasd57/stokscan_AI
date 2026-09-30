"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

function getTrackingSessionId(): string {
  const key = "egxbots_activity_session_v1";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return "browser-session";
  }
}

function Tracker() {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab = ["bots", "similarity", "backtests", "analytics"].includes(rawTab || "") ? rawTab : "bots";
  const lastTracked = useRef("");

  useEffect(() => {
    if (!user || !pathname || pathname.startsWith("/admin") || pathname.startsWith("/api/")) return;
    const basePath = pathname.replace(/^\/(?:ar|en)(?=\/|$)/, "") || "/";
    const cleanPath = basePath === "/scanner/backtests" ? `${basePath}?tab=${tab}` : basePath;
    const key = `${user.id}:${cleanPath}`;
    if (lastTracked.current === key) return;
    lastTracked.current = key;
    void fetch("/api/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_name: "page_view",
        path: cleanPath,
        session_id: getTrackingSessionId(),
        metadata: { title: typeof document !== "undefined" ? document.title : "", ...(basePath === "/scanner/backtests" ? { tab } : {}) },
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname, tab, user]);

  return null;
}

export default function UserActivityTracker() {
  return <Suspense fallback={null}><Tracker /></Suspense>;
}
