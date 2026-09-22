# Inbound GPT-Live runtime

The inbound gateway selects a transport from trusted server configuration. Set
`CALL_GATEWAY_VOICE_RUNTIME=live` for the GPT-Live deployment target. Unset or
`realtime` preserves the prior tenant-profile Realtime model/schema path. Unknown
values fail startup. Public demo and outbound sales runtimes are unaffected.

Live requires the existing server `OPENAI_API_KEY` and an explicitly approved
`OPENAI_LIVE_BACKEND_MODEL` with Responses function-call support and account access.
Missing backend model fails startup; the voice model is always `gpt-live-1`.
The approved deployment backend is `gpt-5.6-terra`, with explicit
`OPENAI_LIVE_BACKEND_REASONING_EFFORT=medium`. The code defaults to `medium` and
validates an operator override (`none`, `low`, `medium`, `high`, `xhigh`, `max`).
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

GPT-Live receives only the short `LIVE_SPEECH_INSTRUCTIONS`, which delegates every
substantive turn and prohibits independent intake progression, facts, prices,
callback offers, transfer decisions, scheduling claims, next questions, or closing.
The full canonical EveryCall prompt, tenant bindings/by-heart facts, and private
tool schemas go only to the backend. Its voice adapter preserves the approved
receptionist procedure, silent lookup/capture, callback consent, pricing boundary,
and exact close, adapting only the delivery of spoken content. Initial tenant
greeting is sent once after Live readiness. No calendar/scheduling tool exists.

### Conversation controller

The Terra backend is the conversation controller. The canonical Conversation and
Callback Capture sections remain its source of procedure: recognize the actual
problem, answer direct questions, use one or two discovery questions, assess
readiness, and earn the transition to callback consent. A delegation is a request
for that conversational decision, not a knowledge lookup request.

Each speech handoff includes a private `conversation_plan`: the caller's goal,
readiness, conversational beat, purpose of any question, contact field and any
pending-question clarification reference. It is produced in
the same backend generation as the speech, so this adds no planning round trip.
The runtime retains the accepted plan and counts issued optional discovery
questions in `conversation_state`. After two, another discovery handoff is
rejected before speech and gets the existing one bounded repair. The limit never
authorizes callback consent, capture, transfer or closing. A model can choose a
specific reflection with `next_question=null` and listen while the caller is
still exploring; hesitant or declined readiness cannot authorize a callback
offer. Required contact fields and clarification of genuinely unclear input are
separate question purposes. Renaming discovery as clarification does not exempt
it from the budget. A genuine current caller business question can authorize one
clarification bound to `caller:TURN_ID`, even after project discovery is exhausted.
The application preserves that unresolved question across the clarifier reply:
"Do you paint siding?" → "What type?" → "Metal" can still reach lookup. A repeated
clarification can repeat the exact currently heard, answered question once with
its application question ID.
Required-contact exemption needs a heard and bound callback yes, an actual
missing capture field, and a matching approved field question. Natural affirmative
forms such as "Yes, that would be great" are accepted; a later "don't call me"
revokes that consent. Labels alone do not authorize these exemptions.

An "okay" or "go on" after a complete no-question reflection is meaningful input
to the controller. The completed reflection must match output transcript and
precede the acknowledgement in media time; unfinished backend work and overlapping
speech retain the ordinary backchannel suppression. This creates an opportunity
to offer a callback, never callback or transfer consent. Transcript matching is
an application timing heuristic, not verified human hearing.

For the observed painting call, house painting + exterior + whole house is enough
project discovery. The controller must recognize that project and move toward
the approved callback path when the caller is receptive, rather than asking a
third condition/materials/repair question. A question about the business can
interrupt that flow; after answering, preserve the existing goal and consent.

Only the backend sees tools. Its `knowledge_lookup` schema additionally requires
`lookup_intent` with `purpose=caller_question|service_fit`, a specific
`missing_fact`, current `caller_turn_id`, and a verbatim `caller_quote`.
The runtime binds that span to the current caller turn or a retained original
business question whose exact clarifier was heard and just answered. A short discovery answer
cannot authorize a new question lookup. It constructs lookup input from the
actual quoted caller question (with its bound clarification when present) or a service-capability question around the
quoted service request, so an asserted missing fact cannot become a diagnostic
lookup about paint condition at the caller's house. Genuine caller questions
such as "Do you repair peeling paint?" remain valid. Missing/invalid intent returns an unexecuted tool result for the
backend to reconsider; no lookup runs. The runtime strips controller metadata
before the original tenant schema validation and lookup API. Known by-heart or
previously retrieved information needs no lookup, nor does ordinary recognition
of caller-provided project details. The controller can reuse known facts without
another tool call; the gateway does not cache by query alone because lookup also
depends on current application context. Existing source and
pricing validation is unchanged. The backend still decides semantic necessity;
the application binds retrieval content to caller evidence and the approved
capability purpose.

Live receives the final speech and a quiet delivery instruction to leave room
after that beat. The plan, caller goal, and tool results never enter Live's speech
or quiet facts. `openai_live_conversation_decision` logs enum-only beat,
readiness, question purpose and discovery count; `openai_live_lookup_decision`
logs accepted purpose or rejected intent, without caller text. These events are
correlated with the existing request/delegation latency trace.

The backend opens one `wss://api.openai.com/v1/responses` connection per call while
Live starts. A `response.create` with `generate:false` prepares the stable
instructions, schemas, output contract, model and reasoning effort before the
first delegated generation. Subsequent requests send `previous_response_id` and
new inputs on the same connection. Instructions are supplied on every request
because they do not inherit through that ID. `store:false` and encrypted reasoning
items permit a full-context restart without persisted provider response storage.
No unsupported Live `response.create` or WebSocket `session.update` is used for
the separate Responses connection.

On backend disconnect/cache loss, retry model generation once after preparing a
new connection and restoring the exact retained inputs, outputs, encrypted
reasoning, and completed function results. Only completed model responses can
request application operations. Streamed partial calls never execute. Aborted
generation is not automatically retried. Application actions do not run again as
part of connection recovery.

Client delegation events carry identifiers, not user requests. The adapter keeps
speaker/timestamp provisional transcripts and finalizes application turns on a
speaker change or 350 ms transcript quiet boundary. This is a local heuristic,
not an invented provider final-transcript event. Deltas and spelled characters
are preserved verbatim. Task revision changes only for meaningful finalized caller
turns; narrow standalone backchannels without an unanswered question and labeled
noise do not restart work. Provisional substantive speech immediately blocks new
commits while it settles. Long-request and correction behavior still needs a live
canary because transcript pauses are not proof of caller completion.

New tasks serialize behind submitted actions. A correction suppresses stale
results and continues the same known delegation with the latest state. Each
operation has a tenant/call/arguments/meaningful-turn identity plus a pending,
completed, failed or unknown status, audited without raw private results. A new
model function-call ID cannot repeat the same operation. An uncertain side effect
is not retried even after a later caller turn repeats the arguments. Existing
read-only lookup cancellations/failures may be retried in bounded backend rounds;
they never become a permanent unknown side effect. A Live transfer provider or
persistence failure retains its pending command ID and reports an unknown outcome
until reconciliation, rather than reopening transfer permission. Existing
tenant binding, schema validation and transfer handlers remain authoritative.
This is process-local action tracking, not durable exactly-once execution. Loss of
the Live speech connection ends the call; there is no blind speech-session replay.

Backend next questions have a server-assigned ID, question kind and, for transfer,
the exact target ID. Consent attaches only after that question appears in the
output transcript and a later caller turn starts after its end timestamp. A yes
to another question, an unheard/paraphrased confirmation, overlap, target change,
or later correction cannot authorize a transfer. This deliberately fails closed
on uncertain transcript matching; provider acceptance must verify this behavior.

The strict backend handoff contains `conversation_plan`, `verified_facts` with source references,
`action_status`, `spoken_response`, `next_question`, and
`completed_operation_ids`. Operation references are checked against the local
ledger. Quiet facts go to `session.thinking.append`; a complete caller-facing
sentence and its single next question go in one `session.commentary.append`.
No private reasoning, raw tool result or serialized contract is forwarded. The
backend remains responsible for semantic grounding in approved context; schema
and identifier validation alone cannot prove a generated factual claim.
If backend generation or contract validation fails, the runtime supplies only a
neutral inability-to-confirm statement. It never invents a next question or
reopens a callback offer. Invalid capture results are failed operations, never
successful capture evidence.

Delegation is bounded to 128 tasks per call, six backend rounds per task,
4,096 output tokens per request (including reasoning), and a 30-second task timeout. Tools already
submitted are not rolled back by that timeout. Transcript context retains up to
128 finalized entries/48,000 characters, alongside authoritative application state.
The Responses recovery history fails closed at 512,000 UTF-8 bytes instead of
discarding action context. Caller-facing handoffs must fit 480 UTF-8 bytes and
one question; invalid/oversized handoffs are rejected, never split mid-sentence.
Other context appends are also limited to 480 bytes, below the 500-token limit.

## Closing and usage

Live has no output-audio-done event. Append acknowledgments only confirm context
delivery. `finish_session` requests the existing exact confirmed-first-name close.
The backend must have supplied the required checkpoint and received its bound
caller answer before requesting the close. The local close policy requires matching newly generated closing transcript,
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

`openai_live_latency` reports separate `live_ack` (first audible output arrival),
`backend_useful_fact` (validated result made available) and `action_complete`
milestones relative to the latest caller transcript receipt for that task. These
are gateway timings, not verified human hearing or model latency percentiles.
Preparation/reconnect and operation-state audit events expose backend readiness
and outcomes independently of the unchanged Telnyx jitter-buffer metrics.

## Offline verification and release gates

Run from the repository root:

```sh
corepack pnpm --filter @everycall/call-gateway... build
node scripts/validate-live-runtime.mjs
node scripts/validate-audio-pump.mjs
corepack pnpm validate:realtime2-payloads
corepack pnpm validate:receptionist-v19
```

The Live validator uses fake WebSockets and scripted backend responses and never
spends API credits. It covers warmup/continuation/cache-loss recovery, explicit
medium reasoning, storage-disabled payloads, split prompts, structured handoffs,
known/unknown facts and scheduling/callback fixtures, long and spelled input,
corrections, backchannels during lookup, duplicate/uncertain actions, schema
allowlisting, target-bound yes/no, failures, interruption, closing and noise/loss.
The content fixtures test contract handling, not unexecuted model behavior. Audio
pump checks remain a separate gate for the existing PCMU pacing/jitter fixes.
Conversation fixtures replay the latest painting chain, block/recover its third
discovery question, allow reflection without a question, preserve state through
a direct question/lookup, reject a purposeless lookup, answer from a known result,
and preserve hesitation/refusal/correction alongside existing action safeguards.
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
- https://developers.openai.com/api/docs/guides/websocket-mode
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
