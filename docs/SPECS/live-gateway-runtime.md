# Inbound GPT-Live runtime

The inbound gateway selects a transport from trusted server configuration. Set
`CALL_GATEWAY_VOICE_RUNTIME=live` for the GPT-Live deployment target. Unset or
`realtime` preserves the prior tenant-profile Realtime model/schema path. Unknown
values fail startup. Public demo and outbound sales runtimes are unaffected.

Live requires the existing server `OPENAI_API_KEY` and an explicitly approved
`OPENAI_LIVE_BACKEND_MODEL` with Responses function-call support and account access.
Missing backend model fails startup; the voice model is always `gpt-live-1`.
The privacy-preserving safety identifier uses the existing gateway HMAC identity
for both Live authentication and backend requests. No project key or private tool
definition is sent to Telnyx or a browser. Live storage and Responses storage are
disabled.

## Protocol and business rules

The gateway connects to `wss://api.openai.com/v1/live/sessions`, sends
`session.start`, and waits for `session.started`. Both audio directions use raw
8 kHz PCMU. Telnyx retains its existing 160-byte, 20 ms paced frames. Live uses
`session.input_audio.append` and `session.output_audio.delta`; it never receives
Realtime response/cancel/truncate commands. Continuous caller audio must remain
enabled while greeting: Live's timeline advances with input audio. Live manages
full-duplex speech and interruption; backend actions have a separate lifecycle.

The existing EveryCall prompt supplies tenant instructions, business facts, and
flow. A runtime instruction describes the delegated execution boundary. The
backend receives the same business rules, exact transcript fragments, current
captured state, and recent completed actions. Initial tenant greeting is sent
once after session readiness. Approved private function schemas are supplied
only to the backend. Their arguments must pass schema validation before invoking
the existing knowledge, capture, confirmed-transfer, and finish handlers.

Client delegation events carry identifiers, not user requests. The adapter keeps
speaker/timestamp transcript history and reconstructs the backend context.
Per-call generations and caller revisions suppress stale actions and results.
New tasks serialize behind submitted actions; speaking or a new task does not
undo a previously committed capture or transfer. An incomplete/stale task asks
Live to delegate again with current context. Tools retain the existing server
tenant/call binding and transfer-confirmation checks. Duplicate delegation IDs
and tool execution keys cannot repeat a submitted operation in one live session.
Unexpected transport loss ends the call instead of replaying actions in a new
session. This is process-local deduplication, not a new durable exactly-once
transaction system.

Delegation is bounded to 128 tasks per call, six backend rounds per task,
1,200 output tokens per request, and a 30-second reasoning timeout. Tools already
submitted are not rolled back by that timeout. Transcript context retains up to
128 entries/48,000 characters, alongside authoritative application state. Backend
results are bounded before being appended as commentary; appends are limited to
480 UTF-8 bytes, conservatively below the 500-token provider limit.

## Closing and usage

Live has no output-audio-done event. Append acknowledgments only confirm context
delivery. `finish_session` requests the existing exact confirmed-first-name close.
The local close policy requires matching newly generated closing transcript,
audible PCMU playback, an empty playback queue, and 1.5 seconds without further
audible playback or closing transcript. Caller speech cancels a pending close.
A 15-second delivery timeout logs `openai_live_close_unverified` and ends the call.
This bounded quiet policy is a heuristic, not provider proof of completed audio
or of what the human heard. It requires real-call acceptance before release.

The gateway sends `session.close`, keeps reading for `session.closed`, and records
final usage or a bounded 1.5-second finalization timeout. Voice usage snapshots
are cumulative seconds; backend token usage is separate. Tenant-bound
`call_events` retain these usage/audit records. Live bypasses legacy Realtime
token-rate estimation; existing call cost dashboards are not Live cost accounting.
Duration/backend cost aggregation is a separate follow-up and must not infer a
zero charge from the old token columns.

## Offline verification and release gates

Run from the repository root:

```sh
corepack pnpm --filter @everycall/call-gateway... build
node scripts/validate-live-runtime.mjs
corepack pnpm validate:realtime2-payloads
corepack pnpm validate:receptionist-v19
```

The Live validator uses injected fake backend responses and never spends API
credits. It covers protocol selection, readiness, raw PCMU, append limits, schema
allowlisting, tenant-bound execution IDs, duplicate tasks, corrections during
reasoning, action serialization, finalization, and the closing playback policy.
Existing repository typecheck/build and independent critical review remain gates.
The historical v18 validator pins prompt version 18 and fails on the current
version 19 baseline; the current v19 validator is the relevant prompt gate.

Deployment alone is not acceptance. With explicit paid-test approval, verify a
controlled Telnyx call: exact greeting, direct question, approved knowledge,
pricing boundary, silent capture and its next question, alphanumeric recognition,
transfer lookup/confirmation/rejection, overlapping speech and corrections during
backend work, tool failure, silence/noise, exact close with drained playback, and
final usage. Check provider access to both selected models before routing traffic.
Until those provider tests pass, this is an offline-verified integration.

Rollback: set `CALL_GATEWAY_VOICE_RUNTIME=realtime` and restart the inbound
gateway. Existing `session_config.model` and `OPENAI_REALTIME_API_SHAPE` again
control the Realtime connection. No database/model-profile migration is required.

Protocol references:

- https://developers.openai.com/api/docs/guides/voice-websockets?api=live
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/live-conversations
