"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
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

export default function UserActivityTracker() {
  const { user } = useAuth();
  const pathname = usePathname();
  const lastTracked = useRef("");

  useEffect(() => {
    if (!user || !pathname || pathname.startsWith("/admin") || pathname.startsWith("/api/")) return;
    const cleanPath = pathname.replace(/^\/(?:ar|en)(?=\/|$)/, "") || "/";
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
        metadata: { title: typeof document !== "undefined" ? document.title : "" },
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname, user]);

  return null;
}
