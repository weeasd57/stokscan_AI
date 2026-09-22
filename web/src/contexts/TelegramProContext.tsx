"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

export type TelegramProInvite = {
  is_pro: boolean;
  current_period_end?: string | null;
  invite_link?: string;
  invite_expires_at?: string | null;
  invite_status?: "ready" | "unavailable";
};

type CachedInvite = {
  userId: string;
  invite: TelegramProInvite;
  error: boolean;
};

type TelegramProContextValue = {
  invite: TelegramProInvite;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

const EMPTY_INVITE: TelegramProInvite = { is_pro: false };
const TelegramProContext = createContext<TelegramProContextValue | null>(null);

export function TelegramProProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const activeUserIdRef = useRef<string | null>(userId);
  const cacheRef = useRef<CachedInvite | null>(null);
  const inFlightRef = useRef<{ userId: string; request: Promise<void> } | null>(null);
  const [invite, setInvite] = useState<TelegramProInvite>(EMPTY_INVITE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadInvite = useCallback(async (force: boolean) => {
    if (!userId) return;

    const cached = cacheRef.current;
    if (!force && cached?.userId === userId) {
      setInvite(cached.invite);
      setError(cached.error);
      setLoading(false);
      return;
    }

    if (inFlightRef.current?.userId === userId) {
      return inFlightRef.current.request;
    }

    setLoading(true);
    const request = (async () => {
      try {
        const response = await fetch("/api/profile/telegram-pro", { cache: "no-store" });
        if (!response.ok) throw new Error("Invite request failed");
        const nextInvite = await response.json() as TelegramProInvite;
        const nextError = Boolean(nextInvite.is_pro && !nextInvite.invite_link);
        if (activeUserIdRef.current !== userId) return;
        cacheRef.current = { userId, invite: nextInvite, error: nextError };
        setInvite(nextInvite);
        setError(nextError);
      } catch {
        if (activeUserIdRef.current !== userId) return;
        const fallback = cacheRef.current?.userId === userId
          ? cacheRef.current.invite
          : EMPTY_INVITE;
        cacheRef.current = { userId, invite: fallback, error: true };
        setInvite(fallback);
        setError(true);
      } finally {
        if (activeUserIdRef.current === userId) setLoading(false);
      }
    })();

    inFlightRef.current = { userId, request };
    try {
      await request;
    } finally {
      if (inFlightRef.current?.request === request) inFlightRef.current = null;
    }
  }, [userId]);

  useEffect(() => {
    activeUserIdRef.current = userId;
    if (authLoading) return;
    if (!userId) {
      cacheRef.current = null;
      inFlightRef.current = null;
      setInvite(EMPTY_INVITE);
      setError(false);
      setLoading(false);
      return;
    }
    void loadInvite(false);
  }, [authLoading, loadInvite, userId]);

  const value = useMemo<TelegramProContextValue>(() => ({
    invite,
    loading,
    error,
    refresh: () => loadInvite(true),
  }), [error, invite, loadInvite, loading]);

  return <TelegramProContext.Provider value={value}>{children}</TelegramProContext.Provider>;
}

export function useTelegramPro() {
  const context = useContext(TelegramProContext);
  if (!context) throw new Error("useTelegramPro must be used within a TelegramProProvider");
  return context;
}
