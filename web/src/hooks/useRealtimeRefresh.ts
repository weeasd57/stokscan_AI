"use client";

import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type RealtimeTable = {
  table: string;
  filter?: string;
};

type Options = {
  enabled?: boolean;
  debounceMs?: number;
  refreshOnVisible?: boolean;
  onChannelError?: (status: string, error?: unknown) => void;
  /** Fires only for real database change events (not visibility/focus refreshes). */
  onDbEvent?: () => void;
};

/** Refreshes a view from database change events without fixed-interval polling. */
export function useRealtimeRefresh(
  tables: RealtimeTable[],
  onRefresh: () => void | Promise<void>,
  options: Options = {},
) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (options.enabled === false || tables.length === 0) return;

    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshRef.current(), options.debounceMs ?? 250);
    };

    const channel = supabase.channel(`realtime-refresh-${Math.random().toString(36).slice(2)}`);
    for (const item of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: item.table, ...(item.filter ? { filter: item.filter } : {}) },
        () => {
          options.onDbEvent?.();
          scheduleRefresh();
        },
      );
    }
    channel.subscribe((status, error) => {
      if (status !== "SUBSCRIBED") options.onChannelError?.(status, error);
    });

    const onVisible = () => {
      if (!document.hidden && options.refreshOnVisible !== false) scheduleRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [options.debounceMs, options.enabled, options.refreshOnVisible, options.onChannelError, options.onDbEvent, tables.map((item) => `${item.table}:${item.filter || ""}`).join("|")]);
}

/** Refreshes once when a user returns to a view, without a background timer. */
export function useRefreshOnVisibility(onRefresh: () => void | Promise<void>, enabled = true) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      const now = Date.now();
      if (!document.hidden && now - lastRefreshAtRef.current >= 5 * 60 * 1000) {
        lastRefreshAtRef.current = now;
        void refreshRef.current();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);
}
