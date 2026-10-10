# Why chat tests missed the production defects

The prior offline suite passed because its model responses were fixtures: the agentic architecture helper always supplied `finish_reason: stop`, small token usage and an approving reviewer verdict. It did not represent the real reviewer exhausting its 800-token limit or the portfolio table containing both loss and remaining-capital columns. Those production failures were subsequently fixed in c013b9322274e20d0c1a4de1430dbd177a9d50ba.

Provider-level tests also called the pipeline directly, bypassing website authentication, entitlements, session history/state, request sanitization, SSE transport, saved replies and rendering. The old live Jest configuration selected five legacy files and omitted current agentic live cases. Offline counts and the isolated build should have been reported as partial evidence, not proof that the website conversation worked.

## Verification now available

- `/admin/chat-verification` sends the two reported portfolio cases using the existing global ChatContext and ARTORO widget. Account, selected model and active session remain the website's normal values. Select an original session in ARTORO before reproducing a context-dependent failure; explicitly create a new session for a clean case.
- The normal chat API passively captures admin requests, real provider requests/responses (including finish reason and reviewer rejection), tool results, review decisions, usage and deployment SHA in existing message metadata. No test flag, alternate provider, forced reviewer approval or authentication bypass is introduced. Vision inputs have hashes rather than stored binary images.
- Private `/api/admin/ai-chatbot/trace` reads only the signed-in administrator's own latest two assistant messages for a specified session. It never returns authentication headers or API keys. Trace capture is bounded at 256,000 serialized data characters; truncation marks it incomplete.
- `npm run test:live` / `test:production-chat` now call the deployed `/api/ai-chat` via the exact request builder shared with ChatContext. The runner requires the full expected deployment SHA, uses real server session history and previous chart context, consumes SSE, checks saved answer equality, real review success, hypothetical allocation/stress calculations and absence of saved-portfolio mutations. It runs two turns without HTTP retries and stops after a failure or an observed total estimated cost above $0.05. This is a post-call stop threshold, not a guaranteed prepaid ceiling.
- API verification explicitly reports `api_verified_ui_not_verified`. Browser rendering and visual behavior require a separate signed-in browser check. Same path/context does not guarantee identical wording from a stochastic model or immutable market data.
- Provider-only tests remain `test:provider`, requiring explicit file paths to prevent accidental broad paid suites.

## Run

```bash
cd web
# Supply a normal signed-in admin credential through a local protected file.
# Never paste it into chat, command arguments or commit it.
CHAT_AUTH_COOKIE_FILE=/private/path/session-cookie npm run test:production-chat -- \
  --url https://egxbots.com --expected-sha <full-deployed-git-sha> \
  --session <original-session-uuid>
```

Alternatively use `CHAT_AUTH_TOKEN_FILE` for a normal user bearer token. Omit `--session` for a new isolated session. Reports default to ignored `web/scratch/production-chat-verification.json`, contain private conversation evidence and are written with mode 0600; do not publish them.

## Validation evidence

Before publishing: 119 offline suites passed, 1,263 tests passed, 22 skipped; TypeScript no-emit passed. An isolated production build succeeded with an empty local public-data fixture (compilation/static generation only). These checks do not use the real model or production account. Final page-shell extraction was checked separately.

The production runner correctly stopped with zero turns because no authenticated local session was available. The browser reached the real ARTORO login form. Actual authenticated HTTP/model/browser verification is pending sign-in; no live success is claimed.
