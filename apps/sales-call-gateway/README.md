# EveryCall sales-call gateway

This service owns only the temporary outbound-sales conference. It does not read
or mutate production tenant routing, inbound receptionists, or public-demo
sessions.

## Provider setup

- Use a dedicated Telnyx sales Call Control application, Credential Connection,
  API key, caller ID, public key, and WebRTC credential.
- Set `SALES_TELNYX_CALL_CONTROL_APP_ID` to the Call Control Application used
  by backend `/v2/calls` requests. Set `SALES_TELNYX_OPERATOR_CONNECTION_ID`
  to the distinct Credential Connection that owns the browser credential.
- Enable **Park Outbound Calls** on that Credential Connection. The gateway rejects
  any operator `call.initiated` event whose payload is not `state=parked`, hangs
  up that unsafe leg, and does not dial the prospect or AI.
- Send the dedicated Telnyx webhooks to `/webhooks/telnyx`.
- Send OpenAI Realtime SIP webhooks to `/webhooks/openai`.
- Keep both webhook signature checks enabled.

Required runtime values are configured in `render.yaml`: `DATABASE_URL`,
`INTERNAL_SERVICE_SECRET`, the `SALES_TELNYX_*` values, and the
`SALES_OPENAI_*` values.

The admin/API deployment must set `SALES_CALL_GATEWAY_BASE_URL` to this
service's private or authenticated base URL and use the same
`INTERNAL_SERVICE_SECRET`.

## Scaling limitation

Deploy exactly one instance. Active OpenAI control WebSockets and call locks are
process-local. The database persists call state and event deduplication, and the
service reconnects recoverable Realtime monitors before it starts listening,
but multi-instance socket ownership is intentionally not implemented.

The authenticated health response at `/internal/health` reports this limitation.
Automatic deploys are disabled in `render.yaml`. Use a drained,
stop-before-start deployment and do not deploy while calls are active. A rolling
overlap can temporarily create two monitor owners even when the steady-state
instance count is one.

`SALES_AI_DEMO_MAX_SECONDS` sets the hard wall-clock demo limit (600 seconds by
default). Expiry removes only the AI leg; the operator and prospect remain
connected. The durable `demo_started_at` timestamp lets recovery reschedule or
immediately enforce the limit after a restart.
