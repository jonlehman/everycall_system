# Spec: Realtime Gateway Call Flow

## Purpose
Define the step-by-step sequence of events for an inbound call.

## Call Flow Sequence
1. **Inbound Call**
   - Telnyx sends inbound webhook to `call-gateway`.
   - Gateway verifies signature and resolves tenant.

2. **Prompt Contract Fetch**
   - Gateway requests prompt payload from EveryCall (system prompt, tenant greeting, tenant knowledge, field schema, tool definitions, session config).
   - Gateway validates required fields.

3. **Realtime Session Setup**
   - Gateway opens OpenAI Realtime session.
   - Gateway sends `session.update` with:
     - System prompt + tenant greeting + knowledge tool policy
     - Tool definitions
     - Session config

4. **Conversation Loop**
   - Caller speaks.
   - Audio streamed to OpenAI Realtime.
   - OpenAI responds with audio deltas.
   - Gateway relays audio to caller.

5. **Tool Calls**
   - If OpenAI requests `knowledge_lookup`, gateway performs lookup and returns relevant knowledge matches, overrides, and guardrails.
   - If OpenAI requests `data_capture`, gateway validates payload against schema and forwards it to EveryCall.

6. **Call End**
   - Call ends via caller hangup or gateway hangup.
   - Gateway closes Realtime session and finalizes logs.
   - Gateway sends any final tool payloads to EveryCall.

## Failure Paths
Refer to `realtime-gateway-failure-policy.md`.
