# Product Requirements Document (PRD)

## Summary
EveryCall is a multi-tenant voice receptionist platform for service businesses. It answers inbound calls, collects key details, and hands off to the business for follow-up. The current production path uses Telnyx + OpenAI Realtime in `call-gateway`, with a Next.js admin/client portal.

## Users
- Callers: want fast, empathetic intake and clear next steps.
- Tenant staff: want accurate call summaries and structured lead data.
- Admins: manage tenants, prompts, FAQs, and system configuration.

## Primary Workflows
1. Inbound call is answered.
2. Assistant gathers: name, callback number, service address, timing, urgency.
3. Caller questions are answered via tenant FAQs.
4. Assistant asks pre-close question, then closes with next steps.
5. Call record and transcript are stored for tenant review.

## Success Metrics
- Call completion rate
- Correct capture rate for name/phone/address/time
- Fewer duplicate or interrupted assistant turns
- Response latency (time from caller end-of-speech to assistant speech)
- FAQ accuracy (answers match stored FAQs)

## Scope (Current)
- Inbound calls only
- Realtime voice via OpenAI
- Tenant + industry + system prompts
- FAQ-backed answers
- Admin and client portals for configuration

## Out of Scope (Current)
- Live transfer / dispatch automation
- Calendar booking integration
- Payments or quotes

## Key Risks
- Prompt compliance vs deterministic requirements (pre-close, FAQ fidelity)
- Barge-in and interruption handling in realtime audio
- Mixed intents in caller utterances

## Launch Criteria
- Deterministic FAQ handling in production
- Pre-close question reliably asked
- Barge-in cancels assistant speech
- Seeded prompts/FAQs align with desired tone
