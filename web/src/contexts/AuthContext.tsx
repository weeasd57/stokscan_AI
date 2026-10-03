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
import type { Session, User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  ensureFreshSession: () => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<{ user: User | null, error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ user: User | null, error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_REFRESH_SKEW_MS = 2 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const sessionRef = useRef<Session | null>(null);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);

  const applySession = useCallback((nextSession: Session | null, event?: string) => {
    sessionRef.current = nextSession;
    setSession(nextSession);

    const nextUser = nextSession?.user ?? null;
    setUser((currentUser) => {
      if (!currentUser || !nextUser || currentUser.id !== nextUser.id) {
        return nextUser;
      }

      // TOKEN_REFRESHED rotates credentials but does not change identity.
      // Keeping the User object stable prevents every provider/effect that
      // depends on the user identity from re-fetching after each refresh.
      if (event === "USER_UPDATED") return nextUser;
      return currentUser;
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          applySession(null);
        } else {
          applySession(data.session, "INITIAL_SESSION");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      applySession(nextSession, event);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession, supabase]);

  const ensureFreshSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return false;

    const expiresAtMs = current.expires_at ? current.expires_at * 1000 : 0;
    if (!expiresAtMs || expiresAtMs - Date.now() > SESSION_REFRESH_SKEW_MS) {
      return true;
    }

    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const refreshRequest = supabase.auth
      .refreshSession()
      .then(({ data, error }) => {
        if (error || !data.session) return false;
        // refreshSession also emits TOKEN_REFRESHED. Applying the returned
        // session here makes callers deterministic while preserving identity.
        applySession(data.session, "TOKEN_REFRESHED");
        return true;
      })
      .catch(() => false)
      .finally(() => {
        if (refreshInFlightRef.current === refreshRequest) {
          refreshInFlightRef.current = null;
        }
      });

    refreshInFlightRef.current = refreshRequest;
    return refreshRequest;
  }, [applySession, supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      ensureFreshSession,
      signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        return { user: data?.user ?? null, error: error?.message ?? null };
      },
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        return { user: data?.user ?? null, error: error?.message ?? null };
      },
      signInWithGoogle: async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin + "/auth/callback",
            // Force an interactive Google flow instead of relying on a stale
            // provider session. Google supports space-delimited prompt values.
            queryParams: {
              prompt: "consent select_account",
            },
          },
        });
        return { error: error?.message ?? null };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [ensureFreshSession, loading, session, supabase, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
