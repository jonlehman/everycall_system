# Spec: Realtime Gateway Logging

## Purpose
Define what the gateway logs for each call and how logs are accessed.

## Log Scope
- Per-call log files, reset at call start.
- Logs are ephemeral and not retained long-term.

## Required Log Content
- Outbound `session.update` payload (redacted as needed).
- Outbound `response.create` instructions.
- Raw realtime events from OpenAI (inbound/outbound).
- Tool call requests and responses.
- Errors and disconnects with call IDs.

## Access
- Logs are downloadable via an authenticated endpoint.
- The gateway must never expose logs to unauthenticated callers.

## Redaction
- Sensitive fields (API keys, auth tokens) must be redacted.
