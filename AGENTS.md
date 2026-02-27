# EveryCall Agent System Best Practices

This document captures operating guidelines for voice + SMS agents and the supporting services.

## Product Principles
- Be clear, short, and helpful on every turn.
- Collect only information needed to complete the task.
- Never give technical advice outside the agent's role.
- Always answer direct questions before continuing the script.

## Voice Experience
- Keep each response to 1-2 short sentences.
- Ask one question at a time.
- Confirm critical details once (name, callback number, address, timing).
- End with a short, clear closing and next steps.

## SMS Experience
- Use a single, shared SMS sender for system-to-client alerts.
- Include opt-out language and honor opt-out requests immediately.
- Support common opt-out keywords (STOP/UNSUBSCRIBE) and send a confirmation.
- Avoid messaging during quiet hours for recipients.
- Register required messaging traffic (10DLC or toll-free verification where applicable).

## Compliance & Risk
- Avoid collecting payment card data by voice or SMS.
- If payment is needed, use DTMF masking, pause/resume recording, or a secure payment link.
- Obtain recording consent where required and follow local laws.

## Security & Privacy
- Minimize PII storage to only required fields.
- Encrypt sensitive data at rest and in transit.
- Use least-privilege access to production data.
- Avoid storing full call recordings unless required.

## Logging & Audit
- Log authentication events, privilege changes, config changes, and webhook activity.
- Review logs regularly for unusual activity.
- Retain audit logs for investigations and compliance reviews.

## Webhooks & Integrations
- Verify webhook signatures when providers support it.
- Use idempotency keys for inbound events.
- Retry with backoff and track failure states.

## AI Prompting & Guardrails
- Use system + industry + tenant prompts with clear precedence.
- Never let untrusted text directly drive tool calls.
- Prefer structured outputs for critical decisions.
- Fail safe: ask for clarification if input is ambiguous.

## Testing & Monitoring
- Run smoke tests against staging services.
- Track latency per service (gateway, AI, voice, SMS).
- Monitor error rates and alert on spikes.
