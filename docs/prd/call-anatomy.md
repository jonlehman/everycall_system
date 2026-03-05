# PRD: Call Anatomy (End‑to‑End)

## Summary
Defines the full lifecycle of an inbound call: routing, AI handling, data persistence, and tenant communication.

## End‑to‑End Flow
1. **Routing**
   - Telnyx receives inbound call.
   - `call-gateway` resolves tenant by called number.
2. **Session Setup**
   - EveryCall system prompt, tenant greeting, tenant FAQs, field schema, tool definitions, and session settings are received by `call-gateway`.
   - Realtime session established with OpenAI using the provided settings.
3. **Conversation**
   - Caller speaks and transcription is captured.
   - Agent responds via Realtime audio.
   - FAQ lookup and data capture happen via tool calls defined by EveryCall.
4. **Data Persistence**
   - `calls` and `call_details` updated.
   - `call_events` and combined transcript stored.
5. **Tenant Follow‑Up**
   - Client UI shows recent calls, summaries, and action queue.
   - Dispatch/routing rules may trigger follow‑ups.

## Key Data Objects
- `calls`: call metadata and status
- `call_details`: transcript, state JSON
- `call_events`: per‑turn messages
- `faqs`: tenant knowledge base

## Tenant Notifications
Currently surfaced in UI dashboards. (SMS/email notifications are supported via alert endpoints.)

## Success Metrics
- Correct tenant routing
- High transcript completeness
- Low response latency
- Accurate info capture

## Risks
- Incorrect tenant routing
- Incomplete transcripts due to Realtime errors
- Model skipping tool calls or hallucinating FAQ responses
