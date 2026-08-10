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
- VAD: use xAI-native `server_vad` with a `0.9` activation threshold and a 350 ms silence endpoint. The higher activation threshold reduces speakerphone echo triggers. xAI owns automatic response creation and provider-side interruption; do not send OpenAI-only `eagerness`, `create_response`, or `interrupt_response` settings.
- Audio formats: stored `g711_ulaw` input/output settings are mapped to xAI's nested `audio.input.format` and `audio.output.format` objects as `audio/pcmu` over JSON transport. This prevents xAI's default 24 kHz PCM from being sent to Telnyx as 8 kHz PCMU.
- Voice: `ara`.
- Reasoning: `high` for conversation continuity and instruction following; measure latency during canaries.
- Transcription: `grok-transcribe` in the nested xAI audio input configuration.
- Carrier stream: request only the inbound caller track while keeping RTP playback bidirectional.
- Output pump: queue length and pump interval.

## Logging
- Session model and response done events.
- Barge-in clears the local output queue and sends Telnyx `{"event":"clear"}` immediately; xAI server VAD handles the model-side interruption.
- Log endpoint-to-first-audio latency for each caller turn.

## TODOs
- Validate Ara, first-ring pickup, speakerphone echo resistance, and intentional caller barge-in with a controlled live call after deployment.
