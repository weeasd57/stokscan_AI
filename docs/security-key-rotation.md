# EGXBOTS security rollout

This change removes an embedded privileged Supabase JWT from
`scratch/check_abuk_db.py`, restores TLS certificate verification, and upgrades
the web application to a supported Next.js release. Removing a key from Git
does **not** invalidate copies of that key or erase existing Git history.

## Complete the key replacement before closing the incident

1. Open the `ai scanner` project (`gfcmaxbtscmizsakarvc`) in Supabase Dashboard,
   Settings > API Keys. Create a new server secret key and a publishable key.
2. Replace credentials in every active consumer: Vercel, the Hugging Face
   `weeasdwee/AI_BOT` Space, GitHub Actions secrets, local automation and any
   database webhooks. Keep server secrets out of `NEXT_PUBLIC_*` variables.
   The web application accepts `SUPABASE_SECRET_KEY` for server credentials and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for browser credentials, while keeping
   the existing variable names compatible during migration. For Python/Hugging
   Face consumers, put the new secret in their existing server-only environment
   variable (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY` as applicable).
3. Deploy the code and verify login, session refresh, a public market query,
   a user-owned portfolio query, and the daily worker with the new credentials.
   For database webhook calls, send a non-JWT secret in `apikey`, not as a
   bearer JWT. Audit Edge Function JWT verification before changing callers.
4. Disable the legacy keys in Supabase Dashboard only after every consumer
   has migrated. Verify that the old exposed key is rejected, and that the
   new clients and user sessions still work. A WAF or RLS cannot neutralize a
   leaked service-role key, which bypasses RLS.
5. Coordinate a separate history cleanup with repository collaborators after
   revocation. Rewriting shared history requires a force push and fresh clones;
   it is not performed by this pull request. Existing forks and downloaded
   copies remain outside the repository owner's control.

## Validation

```sh
python -m unittest discover -s tests -p test_secret_scan.py
python scripts/check_secrets.py
cd web
npm ci --ignore-scripts
npm audit --audit-level=low
npm test -- --runInBand src/lib/__tests__/supabase-server.test.ts src/lib/__tests__/admin-proxy-security.test.ts src/lib/__tests__/portfolio-performance-route.test.ts
NEXT_PUBLIC_SUPABASE_URL=https://build-only.invalid NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=build-only-public SUPABASE_SECRET_KEY=build-only-private npm run build
```

The build and regression tests use no production credentials. Browser and
deployment checks still need the actual deployment environment. Do not mark
the exposed key as revoked until the Dashboard operation and rejection check
have completed.

References:
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://nextjs.org/blog/september-2026-security-release

## Dependency and authorization changes

Next.js is pinned to 15.5.27 (Maintenance LTS), React/React DOM to 19.3.0,
and Lucide is upgraded for React 19 compatibility. PostCSS is pinned to
8.5.28 and overridden for nested consumers, including Next.js, because Next's
own pinned PostCSS dependency is still reported vulnerable by npm audit.
The override remains within PostCSS 8 and must be checked during future Next
upgrades. Compatible fixes for the remaining dependencies are recorded in the
npm lockfile. CI installs with `npm ci` and audits development dependencies too.

Middleware stays disabled to avoid Vercel middleware invocations. Sensitive
admin route handlers verify admin sessions before database access or proxying
server credentials; the access-log reader is protected too. Public market
handlers receive no new authorization round trip. Admin email matching is exact;
addresses containing an administrator's handle no longer grant privileges.
The existing password unlock flow is preserved and needs its own production
smoke test, together with a genuine administrator session and denied access
for a normal user. No database data is changed by these offline tests.
