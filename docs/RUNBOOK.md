# Runbook

## Deployments
- Admin/client app: Vercel
- Call gateway: Render
- Outbound sales call gateway: separate Render service `everycall-sales-call-gateway`, exactly one instance
- Live web demo: code defaults to `gpt-realtime-2.1`; `OPENAI_DEMO_REALTIME_MODEL` is an optional demo-specific Vercel override.

## Logs
- Render service logs for call-gateway
- Look for: `openai_realtime_session_updated`, `assistant_response_canceled`, `openai_realtime_response_done`
- For the GPT-Realtime-2.1 rollout/canary, enable `REALTIME_TRACE=true` only on staging or a controlled canary and confirm `openai_realtime_session_start` logs `model=gpt-realtime-2.1` and `apiShape=realtime2`.

## Common Issues
- Assistant interrupts caller: check barge-in cancel logic and audio queue clearing.
- Missing pre-close question: verify deterministic enforcement.
- Wrong knowledge answers: verify compiled knowledge retrieval, overrides, and guardrails.
- Realtime session update rejected: deliberately pin or migrate the affected tenant/runtime profile's `session_config.model` to `gpt-realtime-1.5`, set the gateway's `OPENAI_REALTIME_API_SHAPE=legacy`, restart the gateway, then inspect the Realtime trace payload and OpenAI error `param`.
- No outbound audio after the GPT-Realtime-2.1 switch: verify output audio format remains `g711_ulaw` in admin session config and maps to `audio/pcmu` in the Realtime 2 session trace.

## Outbound Sales Calling
- Apply `migrations/0032_outbound_sales_demo.sql` before enabling the Sales Console.
- Configure the Vercel values documented under `# outbound sales console` in `.env.example`.
- Leave `SALES_OUTBOUND_ENABLED=false` until the migration, credentials, webhook routes, and controlled provider canary have passed. Set it to `true` to start the scheduled demo and follow-up worker.
- Configure the isolated Render values under `# isolated outbound sales call gateway`. Never substitute generic production `TELNYX_*` or `OPENAI_*` credentials.
- In Telnyx, use a dedicated sales Call Control Application for backend dials plus a distinct Credential Connection and WebRTC credential for the browser operator. Enable **Park Outbound Calls** on the Credential Connection and route both sales resources' webhooks to `/webhooks/telnyx` on the sales gateway.
- Route the dedicated OpenAI project's Realtime webhook to `/webhooks/openai` on the sales gateway.
- Keep Telnyx and OpenAI signature enforcement enabled. Set both providers' public/webhook secrets before sending traffic.
- Configure Smartlead campaign IDs only for finalized outcome branches and set its sales webhook secret. Point reply/bounce/unsubscribe events at `/api/v1/webhooks/smartlead/sales`; use the `x-everycall-webhook-secret` header or a `?secret=` URL value when the provider cannot set custom headers. Missing campaign IDs cause a durable job to complete as `campaign_not_configured`; they do not send an unintended sequence.
- The gateway `/healthz` endpoint is public for platform health checks. `/internal/health` and call actions require an internal-service token.
- If the console reports `operator_leg_not_parked`, stop testing and enable parking on the dedicated WebRTC credential; the gateway intentionally refuses to dial the prospect.
- If the AI standby fails, the human call remains active and the console reports the provider error. End the demo or call cleanly before retrying.
- Automatic deploys are disabled for the sales gateway. Drain active calls, deploy it manually, and stop the old instance before the replacement starts.
- Do not scale the sales gateway above one instance. Realtime monitor sockets and call locks are process-local.
- Trial duration remains controlled by `DEFAULT_TRIAL_DAYS`; this subsystem does not change it.

## OpenAI GPT-Realtime-2.1 Rollout
- Default admin/runtime-profile model: `gpt-realtime-2.1`; `session_config.model` is the gateway's model source of truth.
- Live web demo model: code default `gpt-realtime-2.1`; optionally set `OPENAI_DEMO_REALTIME_MODEL` in Vercel for an explicit demo-only override.
- Default API shape selection: `OPENAI_REALTIME_API_SHAPE=auto`.
- Explicit rollback:
  - deliberately pin or migrate the affected tenant/runtime profile to `session_config.model=gpt-realtime-1.5`
  - set `OPENAI_REALTIME_API_SHAPE=legacy` on the call gateway and restart it
- `OPENAI_REALTIME_MODEL` is not read by `call-gateway` and must not be used as a gateway rollout or rollback control.
- Before production rollout, run:
  - `corepack pnpm --filter @everycall/call-gateway... build`
  - `corepack pnpm validate:realtime2-payloads`
  - tenant profile dry run: `node scripts/migrate-realtime2-runtime-profiles.mjs`
- Apply existing profile migration only after reviewing dry-run output:
  - `EVERYCALL_APPLY_REALTIME2_PROFILE_MIGRATION=1 node scripts/migrate-realtime2-runtime-profiles.mjs`
- Manual canary calls must cover greeting, direct question, knowledge lookup, data capture, transfer lookup/confirmation, alphanumeric readback, barge-in, silence/background noise, and tool failure.

## What You Know By Heart
- Canonical receptionist v10 is the restored OpenAI v3 prompt plus only the conditional by-heart section, its memory allowance, and its lookup exception. When an active build has no pins, the rendered prompt must be byte-for-byte identical to OpenAI v3.
- Run `corepack pnpm audit:core-facts-rollout` before deployment. Migration `0039_automatic_core_fact_pins.sql` is additive; if it is already recorded, do not replay it.
- Run `corepack pnpm backfill:core-facts` for a dry run. Apply only after reviewing every proposed fact and spoken line with `EVERYCALL_APPLY_CORE_FACT_BACKFILL=1 corepack pnpm backfill:core-facts`. Target one tenant with `EVERYCALL_CORE_FACT_BACKFILL_TENANT=<tenant_key>`.
- Add `EVERYCALL_RESELECT_EXISTING_CORE_FACTS=1` only when intentionally replacing an existing selection. Otherwise existing pins remain unchanged.
- The hourly `/api/cron/knowledge-core-facts` job processes at most one due tenant. A tenant becomes due after seven days or 50 completed calls; at most three pins may change in one refresh.
- Run `corepack pnpm validate:core-facts`, `corepack pnpm validate:realtime2-payloads`, `corepack pnpm typecheck`, and `corepack pnpm build` before release.

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
- For a model/API-shape rollback without code rollback, deliberately pin or migrate the affected tenant/runtime profile to `session_config.model=gpt-realtime-1.5`, set `OPENAI_REALTIME_API_SHAPE=legacy`, then restart `everycall-call-gateway`.
- Changing `OPENAI_REALTIME_MODEL` alone has no effect on call-gateway sessions.
