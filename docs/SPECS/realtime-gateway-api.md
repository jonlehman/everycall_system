# Spec: Realtime Gateway API Surface

## Purpose
Define the gateway endpoints and the contract between EveryCall and the realtime gateway.

## Authentication
- All EveryCall-to-gateway requests must be authenticated.
- Gateway rejects unsigned or unauthenticated requests.

## Endpoints

### 1) Initialize Session
**Path:** `/v1/gateway/session`  
**Method:** `POST`  
**Auth:** required  
**Description:** Create a new realtime session for an inbound call and apply the prompt contract payload.

**Request Body:** Prompt contract payload (see `realtime-gateway-prompt-contract.md`).

**Response**
```json
{
  "session_id": "rt_123",
  "call_id": "call_456",
  "status": "ok"
}
```

### 2) Tool Result Callback
**Path:** `/v1/gateway/tools/result`  
**Method:** `POST`  
**Auth:** required  
**Description:** Gateway forwards tool payloads and validation results to EveryCall.

**Request Body**
```json
{
  "call_id": "call_456",
  "tool": "data_capture",
  "payload": { },
  "validation": { "status": "accepted", "errors": [] }
}
```

### 3) Log Download
**Path:** `/v1/gateway/debug/realtime-log`  
**Method:** `GET`  
**Auth:** required  
**Description:** Download the per-call realtime log file.

**Query**
- `call_id` (required)

## Notes
- Exact endpoint paths may change; the above defines the required surface and behavior.
- Gateway must never expose tools or logs to unauthenticated callers.
