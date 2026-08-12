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
   - Gateway opens xAI Grok Realtime session.
   - Gateway sends `session.update` with:
     - System prompt + tenant greeting + knowledge tool policy
     - Tool definitions
     - Session config

4. **Conversation Loop**
   - Caller speaks.
   - Audio streamed to xAI Grok Realtime.
   - xAI responds with audio deltas.
   - Gateway relays audio to caller.

5. **Tool Calls**
   - Gateway serializes tool execution in provider event order for the current call.
   - If xAI requests `knowledge_lookup`, gateway performs lookup and returns relevant knowledge matches, overrides, and guardrails.
   - If xAI requests `data_capture`, gateway validates payload against schema and forwards it to EveryCall.
   - Exact repeated capture payloads do not repeat persistence. Only one capture continuation may be generated for one caller speech turn.

6. **Call End**
   - Once the spoken-close policy accepts `finish_session`, gateway drops any stale queued assistant continuations before draining audio and hanging up.
   - Call ends via caller hangup or gateway hangup.
   - Gateway closes Realtime session and finalizes logs.
   - Gateway sends any final tool payloads to EveryCall.

## Failure Paths
Refer to `realtime-gateway-failure-policy.md`.
