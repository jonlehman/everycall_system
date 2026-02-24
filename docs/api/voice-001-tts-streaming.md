# VOICE-001 API Contract: TTS Streaming

## Endpoint
- Method: `POST`
- Path: `/v1/voice/synthesize-stream`
- Auth: internal service auth

## Purpose
Convert response text to streamable audio chunks using provider profile (ElevenLabs first).

## Request JSON
```json
{
  "trace_id": "trc_123",
  "tenant_id": "ten_123",
  "call_id": "cal_123",
  "utterance_id": "utt_009",
  "provider": "elevenlabs",
  "voice": {
    "voice_id": "vce_abc",
    "stability": 0.45,
    "similarity_boost": 0.8,
    "style": 0.2
  },
  "audio": {
    "format": "mulaw",
    "sample_rate_hz": 8000
  },
  "text": "I can help with that. What is the service address?"
}
```

## Response
- Streaming binary chunks over HTTP chunked transfer or websocket channel.
- Metadata headers:
  - `X-Utterance-Id`
  - `X-Provider`

## Control endpoint (barge-in)
- Method: `POST`
- Path: `/v1/voice/utterances/{utterance_id}/stop`
- Effect: stop ongoing synthesis/playback immediately.

## Validation rules
- Reject empty `text`.
- `tenant_id` and `call_id` required.
- Audio output format must be one of supported telephony codecs.

## Error behavior
- `422` validation failure
- `503` provider unavailable
- On `503`, caller flow should fallback to alternate TTS provider if configured.

## Acceptance checks
- Barge-in stop request halts playback for active utterance.
- Provider failures are emitted as structured events and do not crash call session.
