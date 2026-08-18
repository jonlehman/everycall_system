# 001 System Overview

## Goal
Build a white-labeled, multi-tenant voice platform for service businesses using:
- Telnyx for telephony ingress/egress
- OpenAI Realtime for conversational audio responses

## Core Services
- `call-gateway`: receives Telnyx webhooks, validates signatures, resolves tenant by called number.
- `sales-call-gateway`: isolated, single-instance outbound-sales conference controller for parked browser operator legs, prospect legs, and OpenAI SIP standby legs.
- `api-gateway`: tenant/admin APIs, auth/RBAC, portal backend surface.
- `worker`: async side effects (retries, notifications, post-call tasks).
- `db`: system-of-record for tenants, contacts, calls, leads, and compiled tenant knowledge.

## High-Level Call Flow
1. Telnyx sends inbound webhook to `call-gateway`.
2. `call-gateway` verifies signature and resolves tenant.
3. `call-gateway` creates/updates call session and emits `call.inbound.received`.
4. `call-gateway` receives EveryCall prompt payload (system prompt, tenant greeting, tenant knowledge, field schema, tool definitions, session config).
5. OpenAI Realtime generates responses inside `call-gateway` using the provided instructions.
6. `call-gateway` plays audio to caller, handles tool calls, and persists timeline events.
7. `worker` performs post-call tasks as needed.

## Knowledge Build Flow
1. Each crawled website page or uploaded document is normalized into one page-level evidence document with visible line breaks preserved.
2. Normal sources are retained without a minimum line length. A genuinely oversized source is bounded independently at 12,000 estimated tokens, keeping its beginning and end.
3. Existing cross-page request budgets batch page summaries, assemble the site-wide topic inventory, and extract page facts/cards against that inventory.
4. Source references remain page-level; legacy segment/chunk tables store one compatibility document row per source in new builds.

## Multi-Tenancy Boundaries
- Every persisted domain record includes `tenant_id`.
- Every API request must carry authenticated tenant context.
- Cross-tenant reads/writes are denied by middleware and tested.
- Number-to-tenant mapping is strict and versioned.

## Reliability Requirements
- Webhook idempotency for Telnyx event retries.
- Correlation IDs (`trace_id`, `call_id`, `provider_call_sid`) across all services.
- Circuit breakers for provider APIs.
- Dead-letter queue for failed async tasks.

## Outbound Sales Isolation
- The sales console and its tables are admin-only and separate from tenants, production calls, and public-demo sessions.
- A dedicated Telnyx sales connection and credential park the browser operator leg before the sales gateway creates a conference.
- The sales gateway uses only `SALES_TELNYX_*` and `SALES_OPENAI_*` credentials and verifies both providers' webhook signatures.
- OpenAI Realtime monitor sockets and per-call locks are process-local, so the sales gateway runs as exactly one service instance until shared session coordination is introduced.
- The only production handoff is a single-use invitation into the existing intake and onboarding transaction.

## Security Requirements
- Verify Telnyx signatures on all inbound callbacks.
- Encrypt sensitive fields at rest (PII/contact details).
- Secrets only via runtime secret manager; no hardcoded credentials.
- RBAC roles: `owner`, `manager`, `agent`.

## Initial Scope (v1)
- Inbound calls
- Knowledge-backed conversational handling via tool calls
- Lead capture via structured tool payloads
- Human transfer fallback
- Tenant portal basics (onboarding, knowledge review, routing settings)
