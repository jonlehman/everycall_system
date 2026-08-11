# Spec: Realtime Gateway Data Storage

## Purpose
Define what the gateway stores vs what it forwards to EveryCall.

## Gateway Persistence
The gateway stores:
- Call metadata (start/end, status, provider IDs)
- Transcript (raw + combined)
- Realtime event log pointers or local file path
- Tool call records (request, response, validation status)

Caller transcription `updated` and `completed` events are cumulative snapshots,
not separate utterances. The gateway stores one caller `call_events` row per VAD
speech turn and updates it as later snapshots arrive. Shared transcript readers
also collapse legacy adjacent cumulative snapshots so previously stored calls
remain readable without deleting audit rows.

## Forwarded to EveryCall
The gateway forwards:
- Data capture tool payloads
- Knowledge lookup results (optional, for audit)
- Error events and validation failures

## Ownership
- EveryCall is the system of record for business logic and final data handling.
- The gateway is a transient runtime that persists only what is needed for debugging and traceability.
