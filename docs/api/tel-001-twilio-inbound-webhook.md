# TEL-001 API Contract: Twilio Inbound Webhook

## Endpoint
- Method: `POST`
- Path: `/v1/twilio/webhooks/voice/inbound`
- Auth: Twilio signature verification (`X-Twilio-Signature`)

## Purpose
Receive inbound voice call events, resolve tenant by called number, and create an idempotent call session.

## Request (application/x-www-form-urlencoded)
Required provider fields (subset):
- `CallSid` string
- `From` string (E.164 expected)
- `To` string (E.164 expected)
- `CallStatus` string (e.g. `ringing`, `in-progress`)
- `Direction` string

Optional fields:
- `AccountSid` string
- `ApiVersion` string
- `CallerName` string
- `ForwardedFrom` string

## Validation rules
- Reject if Twilio signature invalid.
- Normalize `To` and `From` to E.164.
- Fail with 404 if `To` does not map to an active tenant number.
- Idempotency key: `provider=twilio + CallSid + event_type`.

## Successful response
- Status: `200`
- Body: TwiML document that starts media flow and/or greeting path.

Example (minimal):
```xml
<Response>
  <Say>Connecting you now.</Say>
</Response>
```

## Side effects
- Upsert `calls` by `provider_call_sid=CallSid`.
- Persist `call_events` record for inbound receipt.
- Emit internal event `call.inbound.received.v1`.

## Error responses
- `401` invalid signature
- `404` number not provisioned/tenant not found
- `422` payload invalid
- `500` unexpected failure (still return valid TwiML fallback if possible)

## Acceptance checks
- Duplicate deliveries do not create duplicate call sessions.
- Same `CallSid` maps to one canonical `call_id`.
- Correlation IDs are logged with each request.
