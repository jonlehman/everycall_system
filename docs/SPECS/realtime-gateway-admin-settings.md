# Spec: Realtime Gateway Admin Settings Model

## Purpose
Define admin-configurable session settings used by the gateway.

## Required Settings
- `model`: `grok-voice-think-fast-2.0`, pinned by the gateway
- `voice`: `ara`
- `reasoning`:
  - `effort`: `high`
- `turn_detection`:
  - `type`: `server_vad`
  - `threshold`: `0.9`
  - `silence_duration_ms`: `350`
- `transcription_model`: `grok-transcribe`
- `input_audio_format`: `g711_ulaw`
- `output_audio_format`: `g711_ulaw`

## Persistence Rules
- Values are stored in EveryCall admin and injected into the gateway via the prompt contract.
- The gateway pins the Grok model and uses only xAI-supported session fields while preserving tenant prompts, tools, voice selection, and compatible audio settings.
- Stored legacy model values are retained for audit/history but cannot select an OpenAI realtime session after this cutover.
