# Spec: Realtime Audio Behavior

## Goal
Natural, interruptible speech with low latency and consistent tone.

## Current Notes
- OpenAI Realtime is used via WebSocket in `call-gateway`.
- Server VAD is enabled, but responses are manually triggered.

## Desired Behavior
- Barge-in should stop assistant speech.
- Short, single responses per turn.
- Avoid duplicate assistant messages.

## Key Parameters
- VAD: tune `silence_duration_ms` and `prefix_padding_ms`.
- Output pump: queue length and pump interval.

## Logging
- Session model and response done events.
- Barge-in cancels.

## TODOs
- Evaluate alternate Realtime voices for less "announcer" tone.
