# Runbook

## Deployments
- Admin/client app: Vercel
- Call gateway: Render
- Outbound sales call gateway: separate Render service `everycall-sales-call-gateway`, exactly one instance
- Live web demo: code defaults to `gpt-realtime-2.1`; `OPENAI_DEMO_REALTIME_MODEL` is an optional demo-specific Vercel override.

## Logs
- Render service logs for call-gateway
- Look for: `openai_realtime_session_updated`, `assistant_response_canceled`, `openai_realtime_response_done`, `assistant_finish_session_rejected`
- For the GPT-Realtime-2.1 rollout/canary, enable `REALTIME_TRACE=true` only on staging or a controlled canary and confirm `openai_realtime_session_start` logs `model=gpt-realtime-2.1` and `apiShape=realtime2`.
- `openai_realtime_response_done` includes `cachedInputTokens`, `cacheHitRate`, `cumulativeCacheHitRate`, and `promptRenderMode`. A zero on one call is not proof caching is disabled; Realtime caching is best-effort.

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
- Canonical Receptionist v11 is the restored OpenAI v3 prompt plus the conditional by-heart accommodations and the reviewed v11 capture/closing/humor rules. With no pins, omit the by-heart section and every by-heart reference; the v11 behavior rules remain.
- Apply migrations `0041_persist_no_tool_statement.sql`, `0042_core_fact_spoken_rewrites.sql`, and `0043_knowledge_build_execution_leases.sql` with `EVERYCALL_APPLY_RECEPTIONIST_V11_MIGRATIONS=1 corepack pnpm migrate:receptionist-v11`.
- Run `corepack pnpm backfill:core-facts` for a no-egress dry run. It reuses complete saved ratings and fails with an aggregate count if any fact still requires OpenAI scoring. After explicit data-flow approval, allow only those missing ratings with `EVERYCALL_ALLOW_CORE_FACT_OPENAI_SCORING=1`. Apply with `EVERYCALL_APPLY_CORE_FACT_BACKFILL=1 corepack pnpm backfill:core-facts`; target one tenant with `EVERYCALL_CORE_FACT_BACKFILL_TENANT=<tenant_key>`.
- To rewrite only a tenant's current pins without re-scoring or exporting all facts, set `EVERYCALL_REWRITE_PINNED_CORE_FACTS=1` and `EVERYCALL_PINNED_CORE_FACT_TENANT=<tenant_key>`, then run `corepack pnpm rewrite:pinned-core-facts`.
- There is no periodic selector. A knowledge build or explicit backfill deterministically ranks saved scores, materializes the tenant/build section, and records its checksum. Calls only load the saved section.
- Run `corepack pnpm validate:receptionist-v11`, `corepack pnpm validate:realtime2-payloads`, `corepack pnpm typecheck`, and `corepack pnpm build` before release.
- Knowledge-build cron and manual runners share a database row lease. Defaults are a 180-second expiry and a 30-second heartbeat. `execution_lease_owner`, `execution_lease_heartbeat_at`, `execution_lease_expires_at`, and `execution_attempt_count` are returned by the build-list API for diagnosis.
- If a serverless invocation terminates, do not manually clear a healthy lease. The cron resumes after expiry. A published build must never be changed to failed by a stale worker; investigate any terminal-status mismatch before repairing it with an audited, build-specific transaction.
- The synthetic Realtime battery requires explicit API-cost approval: `EVERYCALL_RUN_RECEPTIONIST_V11_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v11:realtime`. Optional comma-separated filters are `EVERYCALL_RECEPTIONIST_V11_ACCEPTANCE_MODES` and `EVERYCALL_RECEPTIONIST_V11_ACCEPTANCE_CASES`.

## Knowledge Source Page Budgets
- `KNOWLEDGE_BUILD_SOURCE_PAGE_TOKEN_BUDGET` defaults to `12000`. It applies independently to each normalized website page or uploaded document before raw build-source persistence and AI compilation.
- Normal sources remain lossless after visible-text cleanup: there is no minimum line length and no five-line chunking. New builds store one compatibility `source_segments` row and one compatibility `source_chunks` row per source page/document.
- An oversized source retains roughly 75% of its available budget from the beginning and 25% from the end, separated by an internal omission marker. Inspect `source_intake_items.metadata_json->'page_document'` or `source_chunks.metadata_json->'page_document'` for original/stored token estimates and truncation counts.
- The independent cross-page request budgets remain separate: source summary `18000`, topic window `18000`, and source artifact extraction `22000` estimated input tokens by default.
- Changing this setting affects only future ingestion/rebuilds; it does not mutate active tenant knowledge. Run `corepack pnpm validate:knowledge-source-pages` before release.

## Realtime Prompt Layering
- Default: `OPENAI_REALTIME_LAYERED_PROMPT_ENABLED=true`.
- Immediate rollback: set `OPENAI_REALTIME_LAYERED_PROMPT_ENABLED=false` on the prompt-serving app and redeploy; this restores legacy tenant-first ordering without changing the canonical blueprint.
- Layer 1 contains no tenant values. Layer 2 contains Business Details, stored by-heart facts, persisted no-tool statement, and transfer rules. Layer 3 is empty.
- Verify `openai_realtime_session_start` reports `promptRenderMode=layered`, a canonical-prefix estimate above 1,024 tokens, and a stable tool-schema hash.

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
