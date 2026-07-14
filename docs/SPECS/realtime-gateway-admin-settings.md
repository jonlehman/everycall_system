# Spec: Realtime Gateway Admin Settings Model

## Purpose
Define admin-configurable session settings used by the gateway.

## Required Settings
- `model`: `gpt-realtime-2.1`, delivered to the gateway as `session_config.model`
- `api_shape`: auto-selected by the gateway from `session_config.model` unless the shape-only `OPENAI_REALTIME_API_SHAPE` override is set.
- `voice`: `marin`
- `turn_detection`:
  - `type`: `semantic_vad`
  - `eagerness`: `high`
  - `create_response`: `true`
  - `interrupt_response`: `true`
- `transcription_model`: `gpt-4o-mini-transcribe`
- `noise_reduction`: `far_field`
- `max_output_tokens`: `4096`
- `input_audio_format`: `g711_ulaw`
- `output_audio_format`: `g711_ulaw`

## Persistence Rules
- Values are stored in EveryCall admin and injected into the gateway via the prompt contract.
- The gateway must not override admin-provided values.
- `session_config.model` is the gateway's model source of truth; `OPENAI_REALTIME_MODEL` is not a call-gateway model control.
- Existing tenant profiles with no stored model override inherit the current default model.
- Existing tenant profiles with stored legacy model overrides must be migrated explicitly or intentionally pinned.
