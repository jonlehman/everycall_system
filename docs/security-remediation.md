# Security Remediation Plan

Date: 2026-03-31

This document captures the current EveryCall security remediation plan based on a review of the actual codebase, not just generic SaaS / AI / telephony risk lists.

Status update:

- `Fix Now` implementation is complete in code, with remaining operational follow-up limited to env/config rollout and any desired extra production restrictions.
- `Next Sprint` implementation is also complete in code as of 2026-03-31.
- The main remaining work is now under `Later Hardening`, plus any follow-up tightening discovered during live validation.

It is organized by urgency:

- `Fix Now`: high-priority weaknesses that should be addressed before substantial additional feature work
- `Next Sprint`: important hardening that should follow immediately after the highest-risk items
- `Later Hardening`: worthwhile improvements that are lower priority than the current access, auth, and secret-management gaps

This started as a planning document. The status update above reflects implementation progress, while the sections below preserve the remediation rationale and remaining work.

## Fix Now

### 1. Enforce tenant RBAC on write endpoints

Current concern:

- Several tenant-scoped write APIs appear to allow any active tenant user to perform actions that should likely be restricted to `owner` or tenant `admin`.

Examples:

- team user management
- role changes
- status changes
- deletes
- tenant settings changes
- runtime profile changes
- build publish / run actions

Representative paths:

- `pages/api/v1/tenant/users.js`
- `pages/api/v1/settings.js`
- `pages/api/v1/knowledge/runtime-profile.js`
- `pages/api/v1/knowledge/builds/[buildId]/publish.js`
- `pages/api/v1/knowledge/builds/[buildId]/run.js`

Recommended remediation:

- Introduce a shared helper such as `requireTenantRole(session, roles)` or equivalent.
- Default to a pragmatic policy, not a maximally restrictive one:
  - `owner` only for billing and payment flows
  - `owner` or tenant `admin` for actions that can directly create provider cost, trigger external side effects, or materially change tenant access
  - ordinary active tenant users can continue to do most day-to-day product work that does not create spend or change security boundaries
- Initial examples of `owner` / tenant `admin` scope:
  - integrations configuration and test
  - knowledge build run / rebuild
  - publish / rollback
  - team-user role, status, delete, and invitation controls
  - phone / caller-ID / other external-provider-affecting settings
- Apply the helper consistently across all tenant write routes.

### 2. Lock down the Telnyx media WebSocket

Current concern:

- The inbound voice webhook is signature-verified, but the media stream socket still accepts a stream start message based on `call_control_id` without a second explicit authentication layer on the socket path itself.

Representative path:

- `apps/call-gateway/src/server.ts`

Recommended remediation:

- Add a short-lived, one-time stream token bound to the specific call / stream bootstrap.
- Require that token on the media WebSocket start event.
- Reject stream starts that do not present a valid token or that present a mismatched call identifier.
- Add network-level restrictions where possible.

### 3. Split internal service auth and remove query-string secrets

Current concern:

- The same internal token is currently used across multiple internal pathways.
- One debug route accepts the secret through the query string, which risks leakage into logs, browser history, proxy traces, and copied URLs.

Representative paths:

- `pages/api/v1/gateway/prompt.js`
- `pages/api/v1/gateway/tools/result.js`
- `pages/api/v1/calls.js`
- `apps/call-gateway/src/server.ts`

Recommended remediation:

- Replace the single shared internal token with separate credentials per internal purpose.
- Remove support for query-string token auth on debug routes.
- Prefer header-based auth only.
- Consider signed internal requests if the number of service-to-service flows continues to grow.

### 4. Require a dedicated integration secret encryption key

Current concern:

- Integration secret encryption currently falls back to unrelated environment values when the dedicated encryption key is not set.
- This increases blast radius and couples unrelated secret rotation events together.

Representative path:

- `pages/api/_lib/integrationSecrets.js`

Recommended remediation:

- Make `INTEGRATION_SECRET_ENCRYPTION_KEY` mandatory.
- Remove fallback to unrelated secrets.
- Re-encrypt existing stored connector credentials under the dedicated key.

### 5. Add SSRF protections to the website crawler

Current concern:

- The website build crawler fetches user-supplied URLs server-side.
- That makes it an SSRF surface unless private-address, metadata-service, redirect, and loopback protections are explicitly enforced.

Representative path:

- `pages/api/_lib/knowledgeReceptionistBuilds.js`

Recommended remediation:

- Reject loopback, link-local, RFC1918 private networks, and cloud metadata endpoints.
- Re-resolve and re-check each redirect target before following it.
- Keep crawl scope limited to the intended origin.
- Consider explicit allowlist / denylist logic for dangerous target classes.
- Limit production crawling to public `http` / `https` websites only.

### 6. Reduce sensitive debug logging in production

Current concern:

- The gateway currently logs inbound webhook request previews.
- Realtime debug / trace modes can persist raw payloads to disk, which may include transcripts or other sensitive content.

Representative path:

- `apps/call-gateway/src/server.ts`

Recommended remediation:

- Default production logging to errors and minimal operational metadata only.
- Remove request body previews from production logs.
- Keep realtime debug / trace disabled in production by default.
- Only enable richer debug logging temporarily during active troubleshooting.
- Add retention limits and cleanup if diagnostic logs are temporarily enabled.
- Review whether any remaining logs contain caller PII, transcripts, or internal state that should be redacted.

### 7. Inventory and gate operator / debug / test surfaces

Current concern:

- The repo contains several operational convenience surfaces that are useful for troubleshooting or QA, but should be explicitly reviewed as production attack surface.
- These include public preview endpoints, destructive admin utilities, debug downloads, cron routes, and local scripts that can mutate real environments if run with the right credentials.

Examples to review and gate:

- `pages/api/v1/tenants/enrichment/preview.js`
  - currently unauthenticated and performs pack sync plus onboarding-shape preview work
- `apps/call-gateway/src/server.ts`
  - realtime log download endpoints
- `pages/api/cron/billing-lifecycle.js`
- `pages/api/cron/knowledge-builds.js`
  - currently allow query-string token auth
- `pages/api/v1/admin/tenants/cleanup-qa.js`
- `pages/api/v1/admin/tenants/[tenantKey]/delete.js`
- `scripts/*`
  - especially schema reset, tenant cleanup, rebuild, and E2E onboarding scripts

Recommended remediation:

- Require authentication or explicitly disable any preview/debug route that does not need to be public in production.
- Remove query-string token auth from cron and debug endpoints; header-based auth only.
- Keep destructive admin routes audited and consider extra confirmation / environment gating for the most dangerous ones.
- Maintain the existing script safety guards and require non-production defaults wherever possible.
- Document which routes and scripts are intended for production operations versus development-only troubleshooting.

## Next Sprint

### 1. Harden login and password reset

Recommended work:

- add rate limiting and lockout protection to login and reset endpoints
- hash reset tokens at rest rather than storing them plaintext
- invalidate active sessions on password reset
- remove bootstrap admin credentials after first-time setup

Representative paths:

- `pages/api/v1/auth/login.js`
- `pages/api/v1/auth/request-reset.js`
- `pages/api/v1/auth/reset.js`
- `pages/api/_lib/auth.js`

### 2. Add webhook idempotency for Telnyx voice and SMS callbacks

Recommended work:

- persist provider event ids
- reject duplicate provider events safely
- avoid repeated processing on retries

Representative paths:

- `apps/call-gateway/src/server.ts`
- `pages/api/v1/telnyx/webhooks/sms/inbound.js`
- `pages/api/v1/telnyx/webhooks/sms/failover.js`

### 3. Add request rate limiting and abuse controls

Recommended work:

- login
- password reset
- team-user mutation routes
- integration test routes
- preview / generation endpoints

Representative paths:

- `pages/api/v1/auth/*`
- `pages/api/v1/tenant/users.js`
- `pages/api/v1/integrations/connectors/test.js`
- `pages/api/v1/voice/sample.js`
- `pages/api/v1/knowledge/runtime-preview.js`

### 4. Add payload and file size limits

Recommended work:

- cap uploaded-document payload size
- cap crawl fetch body size
- cap transcript inclusion size for notifications and integrations
- review memory-heavy parsing paths

Representative paths:

- `pages/api/_lib/knowledgeReceptionistConfig.js`
- `pages/api/_lib/knowledgeReceptionistFiles.js`
- `pages/api/_lib/outboundIntegrations.js`

### 5. Expand audit logging for sensitive tenant mutations

Recommended work:

- team-user role/status/delete/phone updates
- caller ID changes
- account settings updates
- other tenant-scoped configuration changes that materially affect operations
- destructive admin actions such as QA cleanup and tenant deletion

Representative paths:

- `pages/api/v1/tenant/users.js`
- `pages/api/v1/settings.js`

## Later Hardening

### 1. Encrypt higher-risk stored data at the application layer

Targets to evaluate first:

- transcripts
- callback numbers
- addresses

Representative path:

- `pages/api/_lib/db.js`

### 2. Improve session security

Recommended work:

- session rotation on login and password reset
- optional MFA for admin access
- session revocation / visibility tooling

### 3. Add anomaly monitoring

Recommended work:

- unusual call volume
- invalid webhook signatures
- repeated failed logins
- SMS failovers
- connector delivery failures

### 4. Formalize secret inventory and rotation

Scope:

- Vercel
- Render
- Neon
- Telnyx
- Stripe
- OpenAI
- integration credentials

## Recommended Execution Order

1. Enforce tenant RBAC on write endpoints
2. Lock down the Telnyx media WebSocket
3. Split internal service auth and remove query-string secrets
4. Require a dedicated integration secret encryption key
5. Add SSRF protections to the website crawler
6. Harden login and password reset
7. Add webhook idempotency and request rate limiting
8. Reduce sensitive logging and add size limits
9. Expand audit logging and monitoring

## Notes

- This plan intentionally prioritizes access control, authentication boundaries, and secret handling over lower-severity polish.
- The `Fix Now` items should be discussed individually before implementation so product intent and role policy are clear.
