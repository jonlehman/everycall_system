# Product Requirements Document (PRD)

## Summary
EveryCall is a multi-tenant voice receptionist platform for service businesses. It answers inbound calls, collects key details, and routes the next step through follow-up workflows or tenant-configured blind transfers. The product is centered on a thin, realtime gateway that executes an EveryCall system prompt plus tenant-specific greeting and compiled knowledge content. Conversational logic lives in the EveryCall system; the gateway handles call control, tool execution, data persistence, and logging. The current production path uses Telnyx + xAI Grok Realtime in `call-gateway`, with a Next.js admin/client portal.

## Users
- Callers: want fast, empathetic intake and clear next steps.
- Tenant staff: want accurate call summaries and structured lead data.
- Admins: manage tenants, prompts, knowledge seeds, and system configuration.

## Primary Workflows
1. Inbound call is answered.
2. Gateway sends `session.update` with EveryCall system prompt + tenant greeting + tenant knowledge payload + session settings.
3. Assistant gathers required details as defined by the EveryCall system.
4. Caller questions are answered via tenant knowledge lookup or tools; if unknown, assistant says it doesn’t know and offers a callback.
5. When the caller explicitly asks for a configured person or extension and confirms the match, the gateway can blind-transfer the call.
6. Call record, transcript, summary, and extracted fields are stored for tenant review.

## Success Metrics
- Call completion rate
- Correct capture rate for name/phone/address/time
- Fewer duplicate or interrupted assistant turns
- Response latency (time from caller end-of-speech to assistant speech)
- Knowledge accuracy (answers match approved tenant knowledge)

## Scope (Current)
- Inbound calls only
- Realtime voice via xAI
- EveryCall system prompt + tenant greeting + tenant knowledge payload (sent at session start)
- Knowledge-backed answers via tool calls when needed
- Structured data capture via tool calls (no transcript scraping)
- Tenant-configured blind transfer by person name or extension
- Admin and client portals for configuration

## Out of Scope (Current)
- Automated dispatch orchestration
- Calendar booking integration
- Payments or quotes

## Key Risks
- Prompt compliance vs required behaviors (knowledge fidelity, escalation)
- Barge-in and interruption handling in realtime audio
- Mixed intents in caller utterances
- Overlong or ambiguous prompts causing inconsistent tool usage

## Launch Criteria
- Consistent knowledge handling in production
- Barge-in cancels assistant speech
- Seeded prompts/knowledge align with desired tone
- Structured data capture delivered via tool call payloads

## Architecture Principles
- Thin gateway: no conversational logic in code.
- EveryCall system prompt owns flow, tone, rules, and escalation behavior.
- Tenant greeting + tenant knowledge payload are injected at session start and are the only tenant-specific logic.
- If a question is not covered by approved knowledge or general knowledge, the assistant must say it does not know and offer a callback.

## Realtime Session Settings
- Model: `grok-voice-think-fast-2.0`, pinned by each realtime entry point.
- Voice: `eve`
- Realtime endpoint: `wss://api.x.ai/v1/realtime`.
- Turn detection: `server_vad`. Automatic response and interruption enabled.
- Transcription model: `grok-transcribe`
- Noise reduction: `far_field`
- Max output tokens: `4096`
- Tools: enabled for knowledge lookup and data capture; tool definitions are provided by EveryCall.

## Tooling & Data Capture
- The assistant uses tool calls for knowledge lookup and structured data capture.
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
