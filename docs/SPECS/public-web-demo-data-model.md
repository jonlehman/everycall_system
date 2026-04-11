# SPEC: Public Web Demo Data Model

## Status
- Proposed for initial implementation
- Last Updated: 2026-04-11

## Related Docs
- [Public Web Demo Receptionist](/home/jonle/everycall/docs/SPECS/public-web-demo-receptionist.md)
- [Public Web Demo API Contract](/home/jonle/everycall/docs/SPECS/public-web-demo-api.md)

## Purpose
Define the demo-only database objects used by the public website receptionist demo.

These tables must remain isolated from:
- `tenants`
- `tenant_users`
- tenant knowledge build tables
- billing tables
- live call tables

## Table: `demo_sessions`

### Purpose
One row per public demo request.

### Columns
- `demo_session_id TEXT PRIMARY KEY`
- `normalized_website_url TEXT NOT NULL`
- `website_origin TEXT NOT NULL`
- `website_hostname TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'created'`
- `business_name TEXT`
- `preview_summary TEXT`
- `demo_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `scrape_page_count INTEGER NOT NULL DEFAULT 0`
- `scrape_pages_json JSONB NOT NULL DEFAULT '[]'::jsonb`
- `failure_code TEXT`
- `failure_message TEXT`
- `request_ip_hash TEXT`
- `user_agent TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `expires_at TIMESTAMPTZ NOT NULL`

### Notes
- `normalized_website_url` should be canonicalized enough for short-term reuse.
- `demo_bundle_json` is the demo-only prompt/runtime payload source.
- `scrape_pages_json` is safe metadata only, not full raw HTML.
- `request_ip_hash` stores a one-way hash, not the raw IP.

## Table: `demo_session_events`

### Purpose
Lightweight event log for build lifecycle and later frontend analytics.

### Columns
- `demo_session_event_id BIGSERIAL PRIMARY KEY`
- `demo_session_id TEXT NOT NULL REFERENCES demo_sessions(demo_session_id) ON DELETE CASCADE`
- `event_type TEXT NOT NULL`
- `payload_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

## Suggested Indexes
- `demo_sessions_status_updated_idx` on `(status, updated_at DESC)`
- `demo_sessions_website_url_updated_idx` on `(normalized_website_url, updated_at DESC)`
- `demo_sessions_origin_updated_idx` on `(website_origin, updated_at DESC)`
- `demo_sessions_expires_idx` on `(expires_at ASC)`
- `demo_session_events_session_created_idx` on `(demo_session_id, created_at ASC)`

## Retention
- Demo sessions should be short-lived.
- Default expiry target: 24 hours from creation.
- Cleanup may happen later via cron or lazy expiration checks.

## Session State Semantics
- `created`: row inserted, work not started
- `scraping`: fetching root or linked pages
- `summarizing`: synthesizing the demo bundle
- `ready`: preview bundle available
- `failed`: scrape/build failed
- `expired`: session exists but should no longer be used

## Migration Plan
Add one new migration:
- `0027_public_demo_receptionist.sql`

That migration should:
1. create `demo_sessions`
2. create `demo_session_events`
3. add indexes

`ensureTables()` in [db.js](/home/jonle/everycall/pages/api/_lib/db.js) should also create the same structures so fresh environments work before migrations are applied.
