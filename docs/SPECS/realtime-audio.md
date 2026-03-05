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
- VAD: use `server_vad` with threshold `0.75`, prefix padding `300ms`, silence duration `500ms`, idle timeout off.
- Voice: `marin` (demo-aligned default).
- Transcription: `gpt-4o-mini-transcribe` with `far_field` noise reduction.
- Output pump: queue length and pump interval.

## Logging
- Session model and response done events.
- Barge-in cancels.

## TODOs
- If tone requires adjustment, update voice in admin configuration instead of hardcoding.
