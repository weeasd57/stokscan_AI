import { createHash } from "node:crypto";
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
// A six-hour negative cache left newly paid accounts looking Free in the
// scanner long after the profile page already showed Pro. Entitlements must
// become visible promptly, including revocations, without polling per view.
const PLAN_TTL_SEC = 60;
const MAX_ENTRIES = 3000;

interface Identity { userId: string | null; exp: number; }
interface Plan { pro: boolean; exp: number; }

const identityCache = new Map<string, Identity>();
const planCache = new Map<string, Plan>();

function nowMs(): number {
  return Date.now();
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function prune<T extends { exp: number }>(store: Map<string, T>) {
  if (store.size <= MAX_ENTRIES) return;
  const now = nowMs();
  for (const [key, value] of store) if (value.exp <= now) store.delete(key);
}

function projectRefFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function readChunkedCookie(req: NextRequest, baseName: string): string | null {
  const rows = req.cookies.getAll();
  const exact = rows.find((row) => row.name === baseName);
  if (exact) return exact.value;

  const chunks = rows
    .map((row) => {
      const prefix = baseName + ".";
      if (!row.name.startsWith(prefix)) return null;
      const suffix = row.name.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) return null;
      return { index: Number(suffix), value: row.value };
    })
    .filter((row): row is { index: number; value: string } => row !== null)
    .sort((a, b) => a.index - b.index);

  if (!chunks.length || chunks.some((chunk, index) => chunk.index !== index)) return null;
  return chunks.map((chunk) => chunk.value).join("");
}

/**
 * Read the access JWT directly from the @supabase/ssr cookie representation.
 * Calling auth.getSession() here is unsafe for a read-only identity check:
 * auth-js proactively refreshes near-expiry sessions, which is exactly the
 * server-side refresh race this helper exists to avoid.
 */
function readSessionAccessToken(req: NextRequest): string | null {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!supabaseUrl) return null;
    const projectRef = projectRefFromUrl(supabaseUrl);
    if (!projectRef) return null;

    const encoded = readChunkedCookie(req, "sb-" + projectRef + "-auth-token");
    if (!encoded) return null;

    const json = encoded.startsWith("base64-")
      ? decodeBase64Url(encoded.slice("base64-".length))
      : encoded;
    const session = JSON.parse(json);

    if (typeof session?.access_token === "string") return session.access_token;
    // Compatibility with legacy token-array cookie shapes.
    if (Array.isArray(session) && typeof session[0] === "string") return session[0];
    return null;
  } catch {
    return null;
  }
}

/** Verify the cookie session belongs to a real user — at most once per TTL. */
async function resolveIdentityToken(token: string | null): Promise<string | null> {
  if (!token) return null;

  const key = tokenFingerprint(token);
  const cached = identityCache.get(key);
  const now = nowMs();
  if (cached && cached.exp > now) return cached.userId;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
    // A plain non-cookie client with the user's bearer token hits only the
    // Auth /user endpoint — the cheapest possible existence confirmation.
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "viewer-context" },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    // Pass the JWT explicitly. This verifies the token at /auth/v1/user
    // without loading or rotating a cookie-backed refresh session.
    const { data, error } = await client.auth.getUser(token);
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

  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) return false;
  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin
      .from("subscriptions")
      .select("plan_id,status,current_period_end")
      .eq("user_id", userId);
    if (error) return false; // transient lookup failures must not cache Free
    const pro = hasActiveProSubscription(data || []);
    prune(planCache);
    planCache.set(userId, { pro, exp: now + PLAN_TTL_SEC * 1000 });
    return pro;
  } catch {
    // Fail closed: unknown plan means Free, never a leaked paid signal.
    return false;
  }
}

export interface ViewerIdentity {
  authenticated: boolean;
  userId: string | null;
}

export interface ViewerAuth extends ViewerIdentity {
  accessToken: string | null;
}

export interface ViewerContext extends ViewerIdentity {
  pro: boolean;
}

/**
 * Verified identity plus the request's access JWT for server-to-server calls
 * that must forward the user's credential. The token is never refreshed here.
 */
export async function getViewerAuth(req: NextRequest): Promise<ViewerAuth> {
  const accessToken = readSessionAccessToken(req);
  const userId = await resolveIdentityToken(accessToken);
  if (!userId) return { authenticated: false, userId: null, accessToken: null };
  return { authenticated: true, userId, accessToken };
}

/**
 * Verified identity only, without a plan lookup. Use this for high-traffic
 * reads that already load their own user-scoped entitlement data.
 */
export async function getViewerIdentity(req: NextRequest): Promise<ViewerIdentity> {
  const { authenticated, userId } = await getViewerAuth(req);
  return { authenticated, userId };
}

/**
 * (authenticated, pro) for a page view with amortized Supabase calls instead
 * of two per request. For GET/visibility use only — privileged actions must
 * still re-check in the database.
 */
export async function getViewerContext(req: NextRequest): Promise<ViewerContext> {
  const { userId } = await getViewerIdentity(req);
  if (!userId) return { authenticated: false, pro: false, userId: null };
  const pro = await resolvePro(userId);
  return { authenticated: true, pro, userId };
}

/** Force the next visibility check to re-read this user's plan. */
export function invalidateViewerPlanCache(userId: string) {
  planCache.delete(userId);
}
