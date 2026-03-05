# Spec: Realtime Gateway Prompt Contract

## Purpose
Define the exact payload EveryCall sends to the gateway at session start. This payload is the sole source of truth for instructions, tools, and session configuration.

## Contract (Gateway Input)
The gateway must receive a single JSON payload with the following top-level fields:

- `system_prompt` (string, required)
- `tenant_greeting` (string, required)
- `tenant_faqs` (array, required)
- `field_schema` (object, required)
- `tool_definitions` (array, required)
- `session_config` (object, required)
- `metadata` (object, optional)

### Field Details
**`system_prompt`**
- The authoritative EveryCall system prompt defining call flow and tool usage.

**`tenant_greeting`**
- Tenant-specific greeting and naming details.

**`tenant_faqs`**
- Array of FAQ items. Each item must include:
  - `id` (string)
  - `question` (string)
  - `answer` (string)
  - `tags` (array of strings, optional)

**`field_schema`**
- JSON Schema defining the required data fields for the call.
- The gateway stores this schema and uses it to validate data capture payloads.

**`tool_definitions`**
- Array of tool definitions compatible with OpenAI Realtime tool calling.
- Must include tools for FAQ lookup and data capture.

**`session_config`**
- Realtime session settings (model, voice, VAD, transcription, max tokens).
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
  "tenant_faqs": [
    {"id": "faq_1", "question": "What are your hours?", "answer": "Mon–Fri 8–6."}
  ],
  "field_schema": { "type": "object", "properties": { "first_name": {"type": "string"} } },
  "tool_definitions": [
    {"type": "function", "name": "faq_lookup", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}},
    {"type": "function", "name": "data_capture", "parameters": {"type": "object", "properties": {"first_name": {"type": "string"}}}}
  ],
  "session_config": { "model": "gpt-realtime-1.5", "voice": "marin" },
  "metadata": { "tenant_id": "t_123" }
}
```
