import { createHash } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { getCache } from "@vercel/functions";
import { DAILY_CACHE_TAGS as TAGS } from "./daily";

// Only server-side, non-user datasets. Never add auth, positions, subscriptions,
// payments, chat, activity, profiles, RPCs or Storage to this allowlist.
const TABLES: Record<string, string> = {
  stocks: TAGS.symbols,
  stock_prices: TAGS.market,
  stock_technical_indicators: TAGS.market,
  stock_fundamentals: TAGS.market,
  market_cache: TAGS.market,
  similarity_reports: TAGS.market,
  stock_news_sentiment: TAGS.news,
  // These are shared SERVER inputs, not public responses. The route must still
  // apply subscription visibility before returning any recommendations.
  scan_results: TAGS.recommendations,
  current_public_recommendations: TAGS.recommendations,
};
const TTL = 14 * 86400; // retention, NOT a daily refresh timer
const CHUNK = 900_000;
const MAX_BODY = 16 * 1024 * 1024;
const SHARDS = 16;
const MAX_SHARD = 128;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Query = { url: string; headers: Record<string, string>; id: string; tag: string; scope: string };
type Entry = { digest: string; chunks: number; bytes: number; storedBytes: number; status: number; headers: Record<string, string>; at: string };
type Scope = { url: string; key: string };
const pending = new Map<string, Promise<Response>>();
const registryLocks = new Map<string, Promise<void>>();

function cache() {
  return getCache({ namespace: `egxbots-market-v1-${process.env.VERCEL_PROJECT_ID || "local"}`, keyHashFunction: hash });
}
function scopeId(scope: Scope) { return hash(`${scope.url}|${scope.key}`); }
function versionKey(scope: string, tag: string) { return `version:${scope}:${tag}`; }
function priorKey(scope: string, tag: string) { return `prior:${scope}:${tag}`; }
function entryKey(q: Query, version: string) { return `entry:${q.scope}:${q.id}:${version}`; }
async function version(q: Query) { return (await cache().get(versionKey(q.scope, q.tag)) as string) || "bootstrap"; }

function describe(input: RequestInfo | URL, init: RequestInit | undefined, scope: Scope): Query | null {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const base = new URL(scope.url);
  const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
  if (request.method !== "GET" || url.origin !== base.origin || !table || !TABLES[table]) return null;
  // Do not share JWT-dependent/RLS results. Only this client's configured key.
  const auth = request.headers.get("authorization");
  if (auth && auth !== `Bearer ${scope.key}`) return null;
  if ((request.headers.get("accept-profile") || "public") !== "public") return null;
  // Reject embedded relationships; an allowlisted table must not join private rows.
  if (/[()!]/.test(url.searchParams.get("select") || "")) return null;
  const headers: Record<string, string> = {};
  for (const name of ["accept", "accept-profile", "range", "range-unit", "prefer"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  url.searchParams.sort();
  const id = hash(`${url}|${JSON.stringify(headers)}`);
  return { url: url.toString(), headers, id, tag: TABLES[table], scope: scopeId(scope) };
}

async function read(q: Query, v: string): Promise<Response | null> {
  const entry = await cache().get(entryKey(q, v)) as Entry | null;
  if (!entry) return null;
  const chunks = await Promise.all(Array.from({ length: entry.chunks }, (_, i) => cache().get(`blob:${q.scope}:${entry.digest}:${i}`)));
  if (chunks.some(part => typeof part !== "string")) return null;
  try {
    const body = gunzipSync(Buffer.from(chunks.join(""), "base64"), { maxOutputLength: MAX_BODY });
    return new Response(body, { status: entry.status, headers: { ...entry.headers, "x-market-cache": "HIT", "x-market-data-fetched-at": entry.at } });
  } catch { return null; }
}

async function save(q: Query, v: string, response: Response): Promise<Entry> {
  if (!response.ok) throw new Error(`Market origin status ${response.status}`);
  const text = await response.text();
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_BODY) throw new Error("Market response exceeds cache safety limit");
  JSON.parse(text); // Never cache an HTML gateway/login response as market data.
  const digest = hash(text);
  const encoded = gzipSync(text).toString("base64");
  const chunks = Math.ceil(encoded.length / CHUNK);
  for (let i = 0; i < chunks; i++) {
    const key = `blob:${q.scope}:${digest}:${i}`;
    // Content-addressed data: only write changed/missing chunks. Do not purge.
    if (!(await cache().get(key))) await cache().set(key, encoded.slice(i * CHUNK, (i + 1) * CHUNK), { ttl: TTL, name: "market-payload" });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const name of ["content-range", "range-unit", "preference-applied", "content-profile", "etag"]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  const entry = { digest, chunks, bytes, storedBytes: encoded.length, status: response.status, headers, at: new Date().toISOString() };
  await cache().set(entryKey(q, v), entry, { ttl: TTL, name: "market-query" });
  return entry;
}

async function register(q: Query) {
  const shard = parseInt(q.id.slice(0, 2), 16) % SHARDS;
  const key = `registry:${q.scope}:${q.tag}:${shard}`;
  // Serialize updates inside an instance. Across instances the registry is best
  // effort: a lost registration is recovered by the versioned cold-miss path.
  const previous = registryLocks.get(key) || Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    const rows = (await cache().get(key) as Query[]) || [];
    const next = [...rows.filter(row => row.id !== q.id), q].slice(-MAX_SHARD);
    await cache().set(key, next, { ttl: TTL, name: "market-query-index" });
  });
  registryLocks.set(key, work);
  try { await work; } finally { if (registryLocks.get(key) === work) registryLocks.delete(key); }
}

async function origin(q: Query, scope: Scope, fetcher: typeof fetch) {
  return fetcher(q.url, {
    headers: { ...q.headers, apikey: scope.key, authorization: `Bearer ${scope.key}` },
    cache: "no-store", signal: AbortSignal.timeout(12000),
  });
}

/** Inject only in cookie-free clients. A CDN miss must not become a DB miss. */
export function marketCachedFetch(scope: Scope, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const q = describe(input, init, scope);
    if (!q || process.env.MARKET_QUERY_CACHE_DISABLED === "true") return fetcher(input, init);
    const v = await version(q);
    const hit = await read(q, v);
    if (hit) return hit;
    const prior = await cache().get(priorKey(q.scope, q.tag)) as string | null;
    const old = prior && prior !== v ? await read(q, prior) : null;
    const key = entryKey(q, v);
    if (pending.has(key)) return (await pending.get(key)!).clone();
    const work = (async () => {
      // Short shared failure backoff: never hammer the origin on a failed miss.
      if (await cache().get(`failure:${key}`)) return old || new Response('{"message":"Market data temporarily unavailable"}', { status: 503 });
      try {
        const response = await origin(q, scope, fetcher);
        if (!response.ok) {
          await cache().set(`failure:${key}`, true, { ttl: 60 });
          return old || response;
        }
        const entry = await save(q, v, response.clone());
        await register(q);
        console.info("[market-cache]", JSON.stringify({ event: "cold-fill", table: new URL(q.url).pathname.split("/").pop(), bytes: entry.bytes, storedBytes: entry.storedBytes }));
        const headers = new Headers(response.headers);
        headers.set("x-market-cache", "MISS");
        headers.set("x-market-data-fetched-at", entry.at);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch {
        await cache().set(`failure:${key}`, true, { ttl: 60 });
        return old || new Response('{"message":"Market cache temporarily unavailable"}', { status: 503 });
      }
    })();
    pending.set(key, work);
    try { return (await work).clone(); } finally { pending.delete(key); }
  };
}

export async function refreshMarketQueries(tags: string[], eventId: string, fetcher: typeof fetch = fetch) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const keys = [...new Set([process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_SERVICE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, process.env.SUPABASE_ANON_KEY, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY].filter(Boolean))] as string[];
  if (!url || !keys.length) throw new Error("Missing market origin configuration");
  const summary = { queries: 0, bytes: 0, storedBytes: 0, unchanged: 0, completed: [] as string[] };
  for (const tag of tags) {
    if (!Object.values(TABLES).includes(tag)) continue;
    for (const key of keys) {
      const scope = { url, key };
      const id = scopeId(scope);
      const current = (await cache().get(versionKey(id, tag)) as string) || "bootstrap";
      if (current === eventId || (current !== "bootstrap" && Date.parse(current) > Date.parse(eventId))) continue;
      const groups = await Promise.all(Array.from({ length: SHARDS }, (_, i) => cache().get(`registry:${id}:${tag}:${i}`)));
      const queries = (groups.flatMap(group => Array.isArray(group) ? group : []) as Query[]);
      // Stage each new generation before switching readers. Failed refreshes
      // leave the entire previous generation available, and do not purge CDN.
      for (let i = 0; i < queries.length; i += 4) {
        await Promise.all(queries.slice(i, i + 4).map(async q => {
          const previous = await cache().get(entryKey(q, current)) as Entry | null;
          const staged = await cache().get(entryKey(q, eventId)) as Entry | null;
          const entry = staged && await read(q, eventId) ? staged : await save(q, eventId, await origin(q, scope, fetcher));
          summary.queries++;
          summary.bytes += staged ? 0 : entry.bytes;
          summary.storedBytes += entry.storedBytes;
          if (previous?.digest === entry.digest) summary.unchanged++;
        }));
      }
      const latest = await cache().get(versionKey(id, tag)) as string | null;
      if (!latest || latest === "bootstrap" || Date.parse(latest) <= Date.parse(eventId)) {
        await cache().set(priorKey(id, tag), current, { ttl: TTL, name: "market-previous-generation" });
        await cache().set(versionKey(id, tag), eventId, { ttl: TTL, name: "market-generation" });
      }
      // Keep the warm-up index alive even when all reads hit the shared cache.
      await Promise.all(groups.map((group, i) => Array.isArray(group) && group.length
        ? cache().set(`registry:${id}:${tag}:${i}`, group, { ttl: TTL, name: "market-query-index" })
        : Promise.resolve()));
    }
    summary.completed.push(tag);
  }
  return summary;
}
