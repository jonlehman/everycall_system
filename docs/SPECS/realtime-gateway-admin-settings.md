# Spec: Realtime Gateway Admin Settings Model

## Purpose
Define admin-configurable session settings used by the gateway.

## Required Settings
- `model`: `gpt-realtime-1.5`
- `voice`: `marin`
- `turn_detection`:
  - `type`: `server_vad`
  - `threshold`: `0.75`
  - `prefix_padding_ms`: `300`
  - `silence_duration_ms`: `500`
  - `idle_timeout_ms`: `null`
- `transcription_model`: `gpt-4o-mini-transcribe`
- `noise_reduction`: `far_field`
- `max_output_tokens`: `4096`

## Persistence Rules
- Values are stored in EveryCall admin and injected into the gateway via the prompt contract.
- The gateway must not override admin-provided values.
