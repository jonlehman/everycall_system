# Spec: Realtime Gateway Tools

## Purpose
Define tool schemas required for the realtime AI to interact with the gateway.

## Tool 1: FAQ Lookup
**Name:** `faq_lookup`  
**Purpose:** Answer tenant-specific questions using the FAQ corpus.

### Input Schema
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Caller question or topic" },
    "tags": { "type": "array", "items": { "type": "string" }, "description": "Optional tags to filter FAQs" }
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
          "question": { "type": "string" },
          "answer": { "type": "string" },
          "score": { "type": "number" }
        },
        "required": ["id", "answer"]
      }
    }
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
