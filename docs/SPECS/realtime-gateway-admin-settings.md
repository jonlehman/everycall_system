# Spec: Realtime Gateway Admin Settings Model

## Purpose
Define admin-configurable session settings used by the gateway.

## Required Settings
- `model`: `grok-voice-think-fast-2.0`, pinned by the gateway
- `voice`: `eve`
- `turn_detection`:
  - `type`: `server_vad`
  - `create_response`: `true`
  - `interrupt_response`: `true`
- `transcription_model`: `grok-transcribe`
- `noise_reduction`: `far_field`
- `max_output_tokens`: `4096`
- `input_audio_format`: `g711_ulaw`
- `output_audio_format`: `g711_ulaw`

## Persistence Rules
- Values are stored in EveryCall admin and injected into the gateway via the prompt contract.
- The gateway overrides provider-specific model, voice, transcription, and VAD settings while preserving tenant prompts, tools, and compatible audio settings.
- Stored legacy model values are retained for audit/history but cannot select an OpenAI realtime session after this cutover.
