# Runbook

## Deployments
- Admin/client app: Vercel
- Call gateway: Render
- Outbound sales call gateway: separate Render service `everycall-sales-call-gateway`, exactly one instance
- Live web demo: pinned `grok-voice-think-fast-2.0`; `XAI_DEMO_REALTIME_VOICE` optionally selects a built-in xAI voice.

## Logs
- Render service logs for call-gateway
- Look for: `xai_realtime_session_updated`, `assistant_response_canceled`, `xai_realtime_response_done`
- For diagnosis, enable `REALTIME_TRACE=true` only on staging and confirm `xai_realtime_session_start` reports `model=grok-voice-think-fast-2.0`.

## Common Issues
- Assistant interrupts caller: check barge-in cancel logic and audio queue clearing.
- Missing pre-close question: verify deterministic enforcement.
- Wrong knowledge answers: verify compiled knowledge retrieval, overrides, and guardrails.
- Realtime session update rejected: inspect the xAI error `param`, confirm the selected voice is valid, and confirm G.711 μ-law is configured end-to-end.
- Static or missing outbound audio after the Grok Voice Think Fast 2.0 switch: verify the xAI `session.update` payload uses `session.audio.input.format.type: "audio/pcmu"` and `session.audio.output.format.type: "audio/pcmu"` with JSON transport, and that Telnyx is configured for G.711 μ-law at 8 kHz. Flat `input_audio_format` / `output_audio_format` fields can leave xAI on its default 24 kHz PCM and must not be used.
- Transfer lookup returns `not_found` when the caller asks who is available: run `corepack pnpm validate:transfer-directory` and confirm the gateway treats a general directory question as a request for all configured transfer targets; a transfer still requires explicit caller confirmation.

## Outbound Sales Calling
- Apply `migrations/0032_outbound_sales_demo.sql` before enabling the Sales Console.
- Configure the Vercel values documented under `# outbound sales console` in `.env.example`.
- Leave `SALES_OUTBOUND_ENABLED=false` until the migration, credentials, webhook routes, and controlled provider canary have passed. Set it to `true` to start the scheduled demo and follow-up worker.
- Configure the isolated Render values under `# isolated outbound sales call gateway`. Never substitute generic production `TELNYX_*` or `XAI_*` credentials.
- In Telnyx, use a dedicated sales Call Control Application for backend dials plus a distinct Credential Connection and WebRTC credential for the browser operator. Enable **Park Outbound Calls** on the Credential Connection and route both sales resources' webhooks to `/webhooks/telnyx` on the sales gateway.
- Register the dedicated E.164 Direct SIP number with xAI and route its signed webhook to `/webhooks/xai` on the sales gateway.
- Keep Telnyx and xAI signature enforcement enabled. Set both providers' public/webhook secrets before sending traffic.
- Configure Smartlead campaign IDs only for finalized outcome branches and set its sales webhook secret. Point reply/bounce/unsubscribe events at `/api/v1/webhooks/smartlead/sales`; use the `x-everycall-webhook-secret` header or a `?secret=` URL value when the provider cannot set custom headers. Missing campaign IDs cause a durable job to complete as `campaign_not_configured`; they do not send an unintended sequence.
- The gateway `/healthz` endpoint is public for platform health checks. `/internal/health` and call actions require an internal-service token.
- If the console reports `operator_leg_not_parked`, stop testing and enable parking on the dedicated WebRTC credential; the gateway intentionally refuses to dial the prospect.
- If the AI standby fails, the human call remains active and the console reports the provider error. End the demo or call cleanly before retrying.
- Automatic deploys are disabled for the sales gateway. Drain active calls, deploy it manually, and stop the old instance before the replacement starts.
- Do not scale the sales gateway above one instance. Realtime monitor sockets and call locks are process-local.
- Trial duration remains controlled by `DEFAULT_TRIAL_DAYS`; this subsystem does not change it.

## xAI Grok Realtime Cutover
- All realtime paths pin `grok-voice-think-fast-2.0`; stored runtime-profile model values cannot override the provider/model.
- Configure `XAI_API_KEY`, `XAI_REALTIME_VOICE=eve`, and `XAI_REALTIME_AUDIO_RATE_PER_MINUTE_USD=0.05`.
- Apply `migrations/0033_xai_realtime_cutover.sql`.
- The browser demo token endpoint returns an xAI ephemeral token, WebSocket URL, subprotocol, and `session.update` event.
- Configure the sales gateway with `SALES_XAI_API_KEY`, `SALES_XAI_PHONE_NUMBER`, and the one-time `SALES_XAI_WEBHOOK_SECRET` returned when registering the Direct SIP number.
- Before production rollout, run:
  - `corepack pnpm --filter @everycall/call-gateway... build`
  - `corepack pnpm validate:xai-realtime-payloads`
  - tenant profile dry run: `node scripts/migrate-xai-runtime-profiles.mjs`
- Apply existing profile migration only after reviewing dry-run output:
  - `EVERYCALL_APPLY_XAI_PROFILE_MIGRATION=1 node scripts/migrate-xai-runtime-profiles.mjs`
- Manual canary calls must cover greeting, direct question, knowledge lookup, data capture, transfer lookup/confirmation, alphanumeric readback, barge-in, silence/background noise, and tool failure.

## Billing Portal
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` should point at the live EveryCall portal configuration in Stripe.
- Plan changes are self-serve in Stripe Customer Portal and are expected to be next-renewal changes inside EveryCall.
- Webhook secret rollovers use:
  - `STRIPE_WEBHOOK_SECRET` for the current endpoint secret
  - `STRIPE_WEBHOOK_SECRET_PREVIOUS` during endpoint/API-version cutovers
- Required webhook coverage includes:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `subscription_schedule.created`
  - `subscription_schedule.updated`
  - `subscription_schedule.released`
  - `subscription_schedule.completed`
  - `subscription_schedule.canceled`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`
- If a customer reports that a future plan change is missing in the app, inspect both the Stripe subscription and any attached subscription schedule before changing local billing data.

## Rollback
- Use Render rollback to previous deploy.
- Roll back the Render/Vercel deployments together if provider setup fails; this direct cutover intentionally has no runtime provider toggle.
