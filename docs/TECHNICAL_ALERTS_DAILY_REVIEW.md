# Technical Alerts Daily Review

## Scope
This report documents the change to make saved technical scanner alerts part of the daily automation flow, so each user receives alerts on their linked Telegram chat instead of relying only on the central broadcast path.

## What Was Found
- Saved technical alerts already exist in `technical_alerts` and are created/managed from the technical scanner UI.
- The frontend alert save path was already pointed at `technical_alerts` and uses the same filter shape as the scanner.
- Before this change, the daily job did not evaluate `technical_alerts` and did not notify individual users from those saved filters.
- The existing daily Telegram helper was broadcast-oriented and was not enough for per-user technical alert delivery.
- The shared technical filtering logic already exists in `api/routers/scan_tech.py` via `TechFilter` and `filter_tech_row`, so the daily job can reuse the same rules instead of duplicating them.

## What Was Changed
- Added a daily technical-alert dispatcher in `api/daily_bot_run.py`.
- Added a new daily job step named `technical_alerts` after the market-status preparation stage.
- Reused `TechFilter` and `filter_tech_row` from `api/routers/scan_tech.py` to match the scanner behavior.
- The dispatcher loads active alerts, groups them by country, fetches the latest technical indicators and fundamentals, evaluates matches, and sends one Telegram message per alert to the linked `telegram_chat_id`.
- The alert record is updated after dispatch with `last_triggered_at` and `last_triggered_matches`.

## Design Decision
- The daily job now acts as the comparison engine for saved technical alerts.
- The central Telegram broadcast remains in place for service-level notifications and daily summaries.
- Technical scanner alerts are treated as per-user alerts and are delivered to the user's linked chat, not to the shared broadcast channel.

## Risks / Follow-Up Checks
- The current dispatcher uses the existing technical filter logic, but it still needs a live data verification pass against real alert rows and real symbol sets.
- The `technical_alerts` table update assumes `last_triggered_matches` can store JSON-style arrays; this should be confirmed in Supabase schema and runtime behavior.
- The alert message formatting is intentionally compact; it may need tuning if users expect richer match context or deduplication rules.
- The technical-alert evaluation currently sends a message whenever matches exist; if the desired behavior is to suppress repeated identical alerts, additional comparison logic against `last_triggered_matches` should be added.

## Reviewer Notes
- Validate the new `technical_alerts` daily step in a real daily run.
- Confirm that each alert is delivered only to the alert owner's `telegram_chat_id`.
- Confirm that the table schema supports the JSON payload stored in `last_triggered_matches`.
