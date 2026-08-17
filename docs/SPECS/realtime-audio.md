# Spec: Realtime Audio Behavior

## Goal
Natural, interruptible speech with low latency and consistent tone.

## Current Notes
- OpenAI Realtime is used via WebSocket in `call-gateway`.
- Session behavior is driven by EveryCall-provided configuration at session start.

## Desired Behavior
- Barge-in should stop assistant speech.
- Short, single responses per turn.
- Avoid duplicate assistant messages.

## Key Parameters
- Admin/runtime-profile model: `gpt-realtime-2.1`, with the gateway auto-selecting the Realtime 2 session schema from `session_config.model`.
- VAD: use `semantic_vad` with eagerness `high`, automatic response enabled, and interruption enabled.
- Audio formats: `g711_ulaw` input/output for Telnyx, mapped to Realtime 2 `audio/pcmu` format.
- Voice: `marin` (demo-aligned default).
- Transcription: `gpt-4o-mini-transcribe` with `far_field` noise reduction.
- Output pump: queue length and pump interval.

## Logging
- Session model and response done events.
- Barge-in cancels.

## TODOs
- If tone requires adjustment, update voice in admin configuration instead of hardcoding.
