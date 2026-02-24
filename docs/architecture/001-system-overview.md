# 001 System Overview

## Goal
Build a white-labeled, multi-tenant voice platform for service businesses using:
- Twilio for telephony ingress/egress
- OpenAI for conversational orchestration and tool calling
- ElevenLabs for production TTS output

## Core Services
- `call-gateway`: receives Twilio webhooks, validates signatures, resolves tenant by called number.
- `ai-orchestrator`: manages conversation policy, prompt/runtime context, tool calls, structured outputs.
- `voice-service`: provider-agnostic TTS streaming (`ElevenLabs` first, fallback provider optional).
- `api-gateway`: tenant/admin APIs, auth/RBAC, portal backend surface.
- `worker`: async side effects (summaries, retries, notifications, post-call tasks).
- `db`: system-of-record for tenants, contacts, calls, leads, faq knowledge.

## High-Level Call Flow
1. Twilio sends inbound webhook to `call-gateway`.
2. `call-gateway` verifies signature and resolves tenant.
3. `call-gateway` creates/updates call session and emits `call.inbound.received`.
4. Audio/text turn payload is sent to `ai-orchestrator`.
5. `ai-orchestrator` returns one of:
   - `speak` (text to render)
   - `tool_call` (e.g. create lead, transfer, send sms)
   - `handoff` (human transfer)
   - `end_call`
6. `voice-service` renders AI text to streamable audio via ElevenLabs.
7. `call-gateway` plays audio to caller and persists timeline events.
8. `worker` performs post-call summary/disposition and CRM updates.

## Multi-Tenancy Boundaries
- Every persisted domain record includes `tenant_id`.
- Every API request must carry authenticated tenant context.
- Cross-tenant reads/writes are denied by middleware and tested.
- Number-to-tenant mapping is strict and versioned.

## Reliability Requirements
- Webhook idempotency for Twilio event retries.
- Correlation IDs (`trace_id`, `call_id`, `provider_call_sid`) across all services.
- Circuit breakers for provider APIs.
- Dead-letter queue for failed async tasks.

## Security Requirements
- Verify Twilio signatures on all inbound callbacks.
- Encrypt sensitive fields at rest (PII/contact details).
- Secrets only via runtime secret manager; no hardcoded credentials.
- RBAC roles: `owner`, `manager`, `agent`.

## Initial Scope (v1)
- Inbound calls
- FAQ-backed conversational handling
- Lead capture + call summary
- Human transfer fallback
- Tenant portal basics (onboarding, faq editor, routing settings)
