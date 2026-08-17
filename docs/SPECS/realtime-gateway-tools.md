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
