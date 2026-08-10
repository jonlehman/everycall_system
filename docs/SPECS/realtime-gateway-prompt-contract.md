# Spec: Realtime Gateway Prompt Contract

## Purpose
Define the exact payload EveryCall sends to the gateway at session start. This payload is the sole source of truth for instructions, tools, and session configuration.

## Contract (Gateway Input)
The gateway must receive a single JSON payload with the following top-level fields:

- `system_prompt` (string, required)
- `tenant_greeting` (string, required)
- `tenant_knowledge` (object, required)
- `field_schema` (object, required)
- `tool_definitions` (array, required)
- `session_config` (object, required)
- `metadata` (object, optional)

### Field Details
**`system_prompt`**
- The authoritative EveryCall system prompt defining call flow and tool usage.

**`tenant_greeting`**
- Tenant-specific greeting and naming details.

**`tenant_knowledge`**
- Object containing tenant-scoped runtime knowledge.
- Must include:
  - `cards` (array)
  - `facts` (array)
  - `guardrails` (array)
  - `overrides` (array)
  - `usage_instructions` (array of strings)
- `cards` items include:
  - `id` (string, optional)
  - `card_key` (string, optional)
  - `title` (string)
  - `topic` (string, optional)
  - `summary` (string, optional)
  - `service_tags` (array of strings, optional)
  - `facts` (array, optional)
- `facts` items include:
  - `id` (string, optional)
  - `claim` (string)
  - `topic` (string, optional)
  - `risk_level` (string, optional)
  - `service_tags` (array of strings, optional)

**`field_schema`**
- JSON Schema defining the required data fields for the call.
- The gateway stores this schema and uses it to validate data capture payloads.

**`tool_definitions`**
- Array of tool definitions compatible with xAI Grok Realtime tool calling.
- Must include tools for knowledge lookup and data capture.

**`session_config`**
- Realtime session settings (model, voice, reasoning, xAI VAD, transcription, and audio formats).
- The gateway must apply these settings exactly and must not override them.

**`metadata`** (optional)
- Freeform metadata such as tenant ID, industry ID, prompt version, or trace IDs.

## Gateway Rules
- The gateway must never send instructions not provided in this payload.
- The gateway must not merge or mutate prompt text beyond basic concatenation.
- If the payload is missing required fields, the gateway must reject the session.

## Example Payload (Redacted)
```json
{
  "system_prompt": "...",
  "tenant_greeting": "Hi, thanks for calling Acme Plumbing...",
  "tenant_knowledge": {
    "cards": [
      {
        "id": "card_1",
        "card_key": "entry:hours_and_availability:1",
        "title": "Hours and Availability",
        "topic": "availability",
        "summary": "Mon-Fri 8-6.",
        "facts": [
          {"id": "fact_1", "claim": "Open Monday through Friday from 8 AM to 6 PM.", "topic": "availability"}
        ]
      }
    ],
    "facts": [
      {"id": "fact_1", "claim": "Open Monday through Friday from 8 AM to 6 PM.", "topic": "availability"}
    ],
    "guardrails": [],
    "overrides": [],
    "usage_instructions": ["Use only the grounded tenant knowledge returned by the lookup tool."]
  },
  "field_schema": { "type": "object", "properties": { "first_name": {"type": "string"} } },
  "tool_definitions": [
    {"type": "function", "name": "knowledge_lookup", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}},
    {"type": "function", "name": "data_capture", "parameters": {"type": "object", "properties": {"first_name": {"type": "string"}}}}
  ],
  "session_config": {
    "model": "grok-voice-think-fast-2.0",
    "voice": "luna",
    "reasoning": { "effort": "none" },
    "turn_detection": { "type": "server_vad", "silence_duration_ms": 350 }
  },
  "metadata": { "tenant_id": "t_123" }
}
```
