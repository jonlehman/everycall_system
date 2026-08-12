# Spec: Realtime Gateway Tools

## Purpose
Define tool schemas required for the realtime AI to interact with the gateway.

## Tool 1: Knowledge Lookup
**Name:** `knowledge_lookup`
**Purpose:** Retrieve tenant-specific knowledge, guardrail answers, overrides, and rules relevant to the caller's question.

### Input Schema
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Caller question or topic" },
    "topic": { "type": "string", "description": "Optional topic hint such as warranty or pricing" },
    "service_tags": { "type": "array", "items": { "type": "string" }, "description": "Optional service tags to narrow lookup" }
  },
  "required": ["query"]
}
```

### Output Schema (Gateway Response)
```json
{
  "type": "object",
  "properties": {
    "matches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "artifactType": { "type": "string" },
          "title": { "type": "string" },
          "content": { "type": "string" },
          "score": { "type": "number" }
        },
        "required": ["id", "content"]
      }
    },
    "overrides": { "type": "array" },
    "guardrails": { "type": "array" },
    "usage_instructions": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["matches"]
}
```

## Tool 2: Data Capture
**Name:** `data_capture`  
**Purpose:** Allow realtime AI to send structured call data back to the gateway.

### Input Schema
The input schema is **dynamic** and must match the `field_schema` provided by EveryCall at session start.

### Output Schema (Gateway Response)
```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["accepted", "invalid"] },
    "errors": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["status"]
}
```

## Gateway Rules
- The gateway must not add tools beyond those provided by EveryCall.
- The gateway must validate `data_capture` arguments against `field_schema`.
- The gateway must forward tool payloads and validation results to EveryCall.
- Tool calls execute serially within a call so persistence and assistant continuations cannot race.
- An exact repeated `data_capture` payload is idempotent: the gateway reuses the successful result without repeating persistence or the EveryCall callback.
- The gateway permits at most one `data_capture`-driven assistant continuation per caller speech turn. A later caller correction or newly supplied value remains eligible because it has a different payload and/or caller turn.
- An accepted `finish_session` discards queued assistant continuations so no stale capture acknowledgement can play after the spoken closing.
- Assistant continuations arriving after an accepted `finish_session` are suppressed during the audio-drain window.
- A capture is not reported as accepted to the model when the EveryCall persistence callback fails.
