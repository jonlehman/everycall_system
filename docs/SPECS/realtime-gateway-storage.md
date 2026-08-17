# Spec: Realtime Gateway Data Storage

## Purpose
Define what the gateway stores vs what it forwards to EveryCall.

## Gateway Persistence
The gateway stores:
- Call metadata (start/end, status, provider IDs)
- Transcript (raw + combined)
- Realtime event log pointers or local file path
- Tool call records (request, response, validation status)

## Forwarded to EveryCall
The gateway forwards:
- Data capture tool payloads
- Knowledge lookup results (optional, for audit)
- Error events and validation failures

## Ownership
- EveryCall is the system of record for business logic and final data handling.
- The gateway is a transient runtime that persists only what is needed for debugging and traceability.
