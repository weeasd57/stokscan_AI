import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasActiveProSubscription, paymentsEnabled } from "@/lib/ai/plan-gate";

/**
 * Session/plan inspection for high-traffic GET routes.
 *
 * Previously every page view paid a Supabase auth round trip, and every Free
 * user paid an extra subscriptions query. This helper resolves the request's
 * tokens locally and keeps two layers of in-memory freshness:
 *   - identity: the user's own access token is verified with auth.getUser()
 *     once per IDENTITY_TTL_SEC per token (cookie-based, safe for logout).
 *   - plan: the Pro tier is read from subscriptions once per PLAN_TTL_SEC.
 * Everything between refreshes costs zero upstream requests. Failure to
 * verify resolves to "free" — the safe direction (can only hide, never leak).
 */

const IDENTITY_TTL_SEC = 300; // per-token re-confirmation every 5 min
const PLAN_TTL_SEC = 6 * 3600; // plan changes propagate within 6 h
const MAX_ENTRIES = 3000;

interface Identity { userId: string | null; exp: number; }
interface Plan { pro: boolean; exp: number; }

const identityCache = new Map<string, Identity>();
const planCache = new Map<string, Plan>();

function nowMs(): number {
  return Date.now();
}

function tokenFingerprint(token: string): string {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return `${h.toString(36)}:${token.length}:${token.slice(-8)}`;
}

function prune<T extends { exp: number }>(store: Map<string, T>) {
  if (store.size <= MAX_ENTRIES) return;
  const now = nowMs();
  for (const [key, value] of store) if (value.exp <= now) store.delete(key);
}

/** Cookie reader without a network hop: reads the SSR client cookies directly. */
async function readSessionTokens(req: NextRequest): Promise<string | null> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
    if (!supabaseUrl || !anonKey) return null;
    const cookieStore = req.cookies;
    // The cookie adapter only reads request cookies; getSession() here just
    // decodes the stored session (with chunked-cookie merge) — no refresh
    // because autoRefreshToken is disabled.
    const client = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await client.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

/** Verify the cookie session belongs to a real user — at most once per TTL. */
async function resolveIdentity(req: NextRequest): Promise<string | null> {
  const token = await readSessionTokens(req);
  if (!token) return null;

  const key = tokenFingerprint(token);
  const cached = identityCache.get(key);
  const now = nowMs();
  if (cached && cached.exp > now) return cached.userId;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
    // A plain non-cookie client with the user's bearer token hits only the
    // Auth /user endpoint — the cheapest possible existence confirmation.
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "viewer-context" },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser();
    const userId = !error && data.user ? data.user.id : null;
    prune(identityCache);
    identityCache.set(key, { userId, exp: now + IDENTITY_TTL_SEC * 1000 });
    return userId;
  } catch {
    // Network hiccup: do not poison the cache, fall back to free this round.
    return null;
  }
}

async function resolvePro(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (!paymentsEnabled()) return true; // billing disabled → free-unlimited site
  const cached = planCache.get(userId);
  const now = nowMs();
  if (cached && cached.exp > now) return cached.pro;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) return false;
  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await admin
      .from("subscriptions")
      .select("plan_id,status,current_period_end")
      .eq("user_id", userId);
    const pro = hasActiveProSubscription(data || []);
    prune(planCache);
    planCache.set(userId, { pro, exp: now + PLAN_TTL_SEC * 1000 });
    return pro;
  } catch {
    // Fail closed: unknown plan means Free, never a leaked paid signal.
    return false;
  }
}

export interface ViewerContext {
  authenticated: boolean;
  pro: boolean;
  userId: string | null;
}

/**
 * (authenticated, pro) for a page view with amortized Supabase calls instead
 * of two per request. For GET/visibility use only — privileged actions must
 * still re-check in the database.
 */
export async function getViewerContext(req: NextRequest): Promise<ViewerContext> {
  const userId = await resolveIdentity(req);
  if (!userId) return { authenticated: false, pro: false, userId: null };
  const pro = await resolvePro(userId);
  return { authenticated: true, pro, userId };
}

/** Force the next visibility check to re-read this user's plan. */
export function invalidateViewerPlanCache(userId: string) {
  planCache.delete(userId);
}
