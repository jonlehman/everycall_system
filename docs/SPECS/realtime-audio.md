# Spec: Realtime Audio Behavior

## Goal
Natural, interruptible speech with low latency and consistent tone.

## Current Notes
- xAI Grok Realtime is used via WebSocket in `call-gateway`.
- Session behavior is driven by EveryCall-provided configuration at session start.

## Desired Behavior
- Barge-in should stop assistant speech.
- Short, single responses per turn.
- Avoid duplicate assistant messages.

## Key Parameters
- Gateway model: `grok-voice-think-fast-2.0`, pinned by the inbound realtime entry point.
- VAD: use `semantic_vad` with eagerness `high`, automatic response enabled, and interruption enabled.
- Audio formats: stored `g711_ulaw` input/output settings are mapped to xAI's nested `audio.input.format` and `audio.output.format` objects as `audio/pcmu` over JSON transport. This prevents xAI's default 24 kHz PCM from being sent to Telnyx as 8 kHz PCMU.
- Voice: `eve` (demo-aligned default).
- Transcription: `grok-transcribe` with `far_field` noise reduction.
- Output pump: queue length and pump interval.

## Logging
- Session model and response done events.
- Barge-in cancels.

## TODOs
- If tone requires adjustment, update voice in admin configuration instead of hardcoding.
