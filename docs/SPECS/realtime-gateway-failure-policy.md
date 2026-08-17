# Spec: Realtime Gateway Failure & Retry Policy

## Purpose
Define behavior when realtime sessions or tool calls fail.

## Failure Modes
1. **OpenAI Realtime session fails to initialize**
   - Log error with call ID and tenant ID.
   - End call cleanly (no gateway-invented instructions).
   - Notify EveryCall via error callback.

2. **OpenAI Realtime disconnects mid-call**
   - Log disconnect.
   - Attempt a single reconnect if call is still active.
   - If reconnect fails, end call cleanly and notify EveryCall.

3. **Tool call validation fails**
   - Log validation errors.
   - Forward raw payload and errors to EveryCall.
   - Continue call without gateway injecting instructions.

4. **Knowledge lookup returns no strong matches**
   - Return empty cards/facts/overrides and only default guardrails.
   - Do not invent an answer.

5. **EveryCall prompt payload missing/invalid**
   - Reject session creation.
   - Log error and notify EveryCall.

## Retry Policy
- Telnyx webhooks: use idempotency keys to avoid duplicate call sessions.
- Tool result callbacks: retry up to 3 times with exponential backoff.
- Realtime reconnect: max 1 attempt per call.
