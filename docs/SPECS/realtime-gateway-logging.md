# Spec: Realtime Gateway Logging

## Purpose
Define what the gateway logs for each call and how logs are accessed.

## Log Scope
- Per-call log files, reset at call start.
- Logs are ephemeral and not retained long-term.
- Privacy-safe diagnostic summaries are also emitted to the Render process log
  so production audio failures can be correlated without downloading raw traces.

## Required Log Content
- Outbound `session.update` payload (redacted as needed).
- Outbound `conversation.item.create` tenant greeting and `response.create` tool-continuation instructions.
- Raw xAI Realtime events (inbound/outbound).
- Tool call requests and responses.
- Errors and disconnects with call IDs.
- Per-response audio-pump summaries, including chunk/frame counts, queue drains,
  underrun duration, re-primes, timer lateness, pending playback, and buffer size.
- Significant playback gaps of at least the configured jitter-buffer target,
  capped at eight process-log events per response.
- Every xAI caller-speech decision, including whether assistant audio was pending
  and whether a Telnyx `clear` command was actually sent.

## Production Process Events
- `assistant_audio_pump_trace`: one aggregate snapshot at response completion and
  again when playback drains, is interrupted, or the call ends.
- `assistant_audio_gap`: a rate-limited gap event emitted only when the pump
  actually re-primes after the output queue ran dry. Queue-empty time that ends
  without resumed playback is reported separately as terminal-gap totals in the
  pump summary and is not counted as an underrun.
- `assistant_barge_in_decision`: records `clear_applied`, `no_pending_audio`,
  `clear_not_sent`, `debounced`, or `transfer_ignored`, plus `clearSent` and
  audio-state counters.
- `assistant_barge_in_applied`: compatibility event with dropped frame/byte
  counts and `clearSent`.
- `xai_realtime_response_done`: includes whether audio arrived and how much
  playback remained queued when xAI completed the response.
- `xai_realtime_tool_response_requested`, `xai_realtime_tool_response_created`,
  and `xai_realtime_tool_response_first_audio`: isolate tool-related dead air.
- `knowledge_lookup_timing`: separates caller endpoint-to-tool selection,
  knowledge runtime, call-state persistence, internal result forwarding, and
  the result-dispatch attempt back to xAI, including whether the socket was
  open. It includes the runtime's planner, embedding,
  retrieval, packet, and persistence durations without the caller query or
  knowledge payload.
- `assistant_finish_session_rejected`: records an opaque call/tool correlation
  and safe rejection reason when the model requests `finish_session` before
  the configured closing has been spoken. It does not include transcript text.

## Access
- Logs are downloadable via an authenticated endpoint.
- The gateway must never expose logs to unauthenticated callers.

## Redaction
- Sensitive fields (API keys, auth tokens) must be redacted.
- Process audio diagnostics may contain only opaque call/response identifiers,
  event types, timings, byte/frame counts, booleans, and provider status. They
  must never contain PCM/base64 audio, transcripts, prompts, tool arguments,
  caller names, or phone numbers.
