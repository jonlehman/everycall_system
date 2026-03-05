# Product Requirements Document (PRD)

## Summary
EveryCall is a multi-tenant voice receptionist platform for service businesses. It answers inbound calls, collects key details, and hands off to the business for follow-up. The product is centered on a thin, realtime gateway that executes an EveryCall system prompt plus tenant-specific greeting/FAQ content. Conversational logic lives in the EveryCall system; the gateway handles call control, tool execution, data persistence, and logging. The current production path uses Telnyx + OpenAI Realtime in `call-gateway`, with a Next.js admin/client portal.

## Users
- Callers: want fast, empathetic intake and clear next steps.
- Tenant staff: want accurate call summaries and structured lead data.
- Admins: manage tenants, prompts, FAQs, and system configuration.

## Primary Workflows
1. Inbound call is answered.
2. Gateway sends `session.update` with EveryCall system prompt + tenant greeting + tenant FAQs + session settings.
3. Assistant gathers required details as defined by the EveryCall system.
4. Caller questions are answered via tenant FAQs or tools; if unknown, assistant says it doesn’t know and offers a callback.
5. Call record, transcript, summary, and extracted fields are stored for tenant review.

## Success Metrics
- Call completion rate
- Correct capture rate for name/phone/address/time
- Fewer duplicate or interrupted assistant turns
- Response latency (time from caller end-of-speech to assistant speech)
- FAQ accuracy (answers match stored FAQs)

## Scope (Current)
- Inbound calls only
- Realtime voice via OpenAI
- EveryCall system prompt + tenant greeting + tenant FAQ content (sent at session start)
- FAQ-backed answers via tool calls when needed
- Structured data capture via tool calls (no transcript scraping)
- Admin and client portals for configuration

## Out of Scope (Current)
- Live transfer / dispatch automation
- Calendar booking integration
- Payments or quotes

## Key Risks
- Prompt compliance vs required behaviors (FAQ fidelity, escalation)
- Barge-in and interruption handling in realtime audio
- Mixed intents in caller utterances
- Overlong or ambiguous prompts causing inconsistent tool usage

## Launch Criteria
- Consistent FAQ handling in production
- Barge-in cancels assistant speech
- Seeded prompts/FAQs align with desired tone
- Structured data capture delivered via tool call payloads

## Architecture Principles
- Thin gateway: no conversational logic in code.
- EveryCall system prompt owns flow, tone, rules, and escalation behavior.
- Tenant greeting + FAQs are injected at session start and are the only tenant-specific logic.
- If a question is not covered by FAQ or general knowledge, the assistant must say it does not know and offer a callback.

## Realtime Session Settings (Stored in Admin, Not Hardcoded)
- Model: `gpt-realtime-1.5`
- Voice: `marin`
- Turn detection: `server_vad`. Threshold `0.75`. Prefix padding `300ms`. Silence duration `500ms`. Idle timeout off.
- Transcription model: `gpt-4o-mini-transcribe`
- Noise reduction: `far_field`
- Max output tokens: `4096`
- Tools: enabled for FAQ lookup and data capture; tool definitions are provided by EveryCall.

## Tooling & Data Capture
- The assistant uses tool calls for FAQ lookup and structured data capture.
- Data capture is sent as structured payloads (function call arguments), not extracted from transcripts after the fact.
- Field requirements are defined by the EveryCall system prompt and passed as schema to the gateway.
- The gateway forwards tool payloads and schema to EveryCall for handling.

## Gateway Specs
- Prompt contract: `docs/SPECS/realtime-gateway-prompt-contract.md`
- Tool schemas: `docs/SPECS/realtime-gateway-tools.md`
- API surface: `docs/SPECS/realtime-gateway-api.md`
- Call flow sequence: `docs/SPECS/realtime-gateway-call-flow.md`
- Failure & retry policy: `docs/SPECS/realtime-gateway-failure-policy.md`
- Admin settings model: `docs/SPECS/realtime-gateway-admin-settings.md`
- Logging spec: `docs/SPECS/realtime-gateway-logging.md`
- Data storage spec: `docs/SPECS/realtime-gateway-storage.md`
