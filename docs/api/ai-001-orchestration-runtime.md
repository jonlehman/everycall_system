# AI-001 API Contract: Orchestration Runtime

## Endpoint
- Method: `POST`
- Path: `/v1/ai/orchestrate-turn`
- Auth: internal service auth (mTLS or signed service token)

## Purpose
Given call context and user turn, produce exactly one next action for the call engine.

## Request JSON
```json
{
  "trace_id": "trc_123",
  "tenant_id": "ten_123",
  "call_id": "cal_123",
  "turn_id": "turn_0007",
  "caller_input": {
    "type": "text",
    "text": "My water heater is leaking"
  },
  "context": {
    "from_number": "+15125550111",
    "to_number": "+15125550999",
    "business_profile": {
      "name": "Acme Plumbing",
      "timezone": "America/Chicago"
    },
    "faq_items": [
      {"q": "Do you offer emergency service?", "a": "Yes, 24/7 emergency dispatch is available."}
    ]
  }
}
```

## Response JSON
Exactly one action in `next_action`:
```json
{
  "trace_id": "trc_123",
  "call_id": "cal_123",
  "turn_id": "turn_0007",
  "next_action": {
    "type": "speak",
    "text": "I can help with that. What is the service address?"
  },
  "extracted": {
    "intent": "emergency_repair",
    "urgency": "high",
    "entities": {
      "service_type": "water_heater_leak"
    }
  }
}
```

Other `next_action.type` values:
- `tool_call`
- `handoff`
- `end_call`

## Validation rules
- `tenant_id`, `call_id`, `turn_id` required.
- Response must conform to schema; invalid model output must fail safe.
- Tool calls must include deterministic `idempotency_key`.

## Error behavior
- `422` bad request schema
- `503` model/provider unavailable -> caller receives fallback phrase path

## Acceptance checks
- Every output validates against JSON schema.
- No unstructured free-form side effect instructions.
- Unsafe/unknown requests route to safe fallback action.
