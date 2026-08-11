# Runbook

## Deployments
- Admin/client app: Vercel
- Call gateway: Render
- Outbound sales call gateway: separate Render service `everycall-sales-call-gateway`, exactly one instance
- Live web demo: pinned `grok-voice-think-fast-2.0` with the `ara` voice.

## Logs
- Render service logs for call-gateway
- Look for: `xai_realtime_session_updated`, `assistant_response_canceled`, `xai_realtime_response_done`
- For audio that stops and resumes, filter one call ID across
  `assistant_audio_gap`, `assistant_audio_pump_trace`, and
  `assistant_barge_in_decision`:
  - `assistant_audio_gap` plus nonzero `underrunCount`/`reprimeCount` means the
    Telnyx output queue ran dry while xAI was still producing the response.
  - `assistant_barge_in_decision` with `decision=clear_applied` and
    `clearSent=true` means playback was deliberately cleared after xAI reported
    caller speech.
  - `decision=clear_not_sent` means local audio state was interrupted but the
    Telnyx media WebSocket was not open, so no carrier clear command was sent.
  - `terminalGapCount` is queue-empty time that ended without playback resuming;
    it is intentionally excluded from `underrunCount`.
  - High `maxTimerLateMs` without an underrun points to gateway event-loop delay.
  - `xai_realtime_response_done` with `audioReceived=false` points to a
    tool-only or empty response; high `pendingPlaybackMs` means xAI finished
    while Telnyx audio was still queued.
- Tool-related silence can be isolated with
  `xai_realtime_tool_response_requested`, `xai_realtime_tool_response_created`,
  and `xai_realtime_tool_response_first_audio`.
- `assistant_finish_session_rejected` means the model tried to end the call
  before speaking the configured closing. The gateway leaves the call active
  and returns control to the assistant; correlate the event with the transcript
  to determine whether a declined callback or transfer was mistaken for a
  goodbye.
- `caller_transcript_turn_coalesced` confirms that cumulative xAI transcription
  snapshots were folded into one caller transcript row. `snapshotsReceived`
  may be greater than one; `snapshotsCollapsed` should then equal one less.
  This event includes counts and character length only, never transcript text.
- For a slow `knowledge_lookup`, correlate `knowledge_lookup_timing` with those
  response events:
  - `endpointToToolCallReadyMs` measures how long xAI took after caller
    endpointing to finish selecting and constructing the tool call.
  - `knowledgeRuntimeWallClockMs` and its planner/embedding/retrieval components
    measure the tenant knowledge runtime itself.
  - `toolCallReadyToXAiResultDispatchMs` measures the complete gateway tool
    path, while `endpointToXAiResultDispatchMs` measures endpointing through the
    dispatch attempt. `appToolResultForwardMs` is the separate EveryCall app
    callback; `appToolResultForwardOutcome` says whether it was configured and
    succeeded. `xaiSocketOpenAtResultDispatch` confirms whether the xAI socket
    was open when the result was dispatched.
  - `xai_realtime_tool_response_created.waitMs` and
    `xai_realtime_tool_response_first_audio.responseCreatedToFirstAudioMs`
    measure xAI after the lookup result was returned.
- For diagnosis, enable `REALTIME_TRACE=true` only on staging and confirm `xai_realtime_session_start` reports `model=grok-voice-think-fast-2.0`.

## Common Issues
- Assistant interrupts caller: check barge-in cancel logic and audio queue clearing.
- Missing pre-close question: verify deterministic enforcement.
- Repeated growing caller lines in a transcript: verify the deployed gateway
  handles both `conversation.item.input_audio_transcription.updated` and
  `.completed`, then look for `caller_transcript_turn_coalesced`. Historical
  staircase rows are collapsed by the shared transcript reader and do not
  require destructive database cleanup.
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
- Canonical receptionist v9 is seeded automatically and leaves v8 archived for rollback. Its seven tenant values come from the tenant prompt profile, while `core_facts_block` comes from automatic pins on the active knowledge build. The gateway sends the resulting `system_prompt` unchanged; the forced tenant greeting and tool definitions remain separate session fields.
- Configure `XAI_API_KEY` and `XAI_REALTIME_AUDIO_RATE_PER_MINUTE_USD=0.05`. The inbound default voice is the runtime-profile value, with `ara` as the code-owned fallback.
- Apply `migrations/0033_xai_realtime_cutover.sql` through `migrations/0039_automatic_core_fact_pins.sql` in order. Canonical prompt version initialization copies valid tenant section overrides forward transactionally.
- Audit the target first with `corepack pnpm audit:core-facts-rollout`. In environments with a clean migration ledger, use the normal migrator. If the audit reveals older ledger drift, apply only this additive migration with `EVERYCALL_APPLY_CORE_FACT_MIGRATION=1 corepack pnpm migrate:core-facts`; do not replay the historical backlog blindly.
- After migration 0039, dry-run existing active-build pins and spoken company-description rewrites with `corepack pnpm backfill:core-facts`. Review every proposed fact ID against its canonical claim before applying. Apply only with `EVERYCALL_APPLY_CORE_FACT_BACKFILL=1 corepack pnpm backfill:core-facts`; the normal apply path skips builds that already have pins.
- To replace an earlier automatic selection after a selector change, add `EVERYCALL_RESELECT_EXISTING_CORE_FACTS=1`. Limit a staged run with `EVERYCALL_CORE_FACT_BACKFILL_SCOPE=core_facts` or `company_descriptions`, and target one tenant with `EVERYCALL_CORE_FACT_BACKFILL_TENANT=<tenant_key>`; the default scope is `all`.
- Core-fact relevance is AI-selected, not rules-ranked. New knowledge builds have AI score every fact during extraction, then send every stable fact with a safe complete line to an AI editorial selection and a separate AI audit of the exact rendered title and sentence. Existing builds receive the same AI scoring during backfill. No numeric score cutoff or score ordering is applied in code. Weekly refinement sends every retrieval-eligible candidate plus every incumbent to AI, which selects and orders the complete set; code only enforces eligibility, hysteresis, the three-swap cap, and the token ceiling. If any AI stage is incomplete or invalid, the selector fails closed and preserves the existing pins.
- Dry-run output includes each proposed title and exact spoken line. Review those rendered lines, not only their canonical fact IDs. The canonical fact is never modified; a spoken line may only delete one narrowly allowlisted trailing promotional clause introduced by a comma. Isolated words and embedded or restrictive phrases are never safe to delete across tenants; every other deletion is unsafe by default, the retained prefix must be textually unchanged, and every number, negation, limit, exception, and modal qualifier must remain.
- If a specific finalist's AI rewrite violates those constraints, that fact is listed in `droppedUnsafeRewriteFactIds` and omitted before the independent audit. An incomplete or failed rewrite call still fails the entire replacement closed.
- The hourly `/api/cron/knowledge-core-facts` job evaluates at most one due tenant. A tenant becomes due weekly or after 50 completed calls. Eligibility requires at least four retrievals and a three-retrieval lead over an incumbent; AI then judges all eligible candidates with the incumbents, chooses the final relevance order, and may make no more than three swaps per cycle.
- The browser demo token endpoint returns an xAI ephemeral token, WebSocket URL, subprotocol, and `session.update` event.
- Configure the sales gateway with `SALES_XAI_API_KEY`, `SALES_XAI_PHONE_NUMBER`, and the one-time `SALES_XAI_WEBHOOK_SECRET` returned when registering the Direct SIP number.
- Before production rollout, run:
  - `corepack pnpm --filter @everycall/call-gateway... build`
  - `corepack pnpm validate:xai-realtime-payloads`
  - `corepack pnpm validate:core-facts`
  - `corepack pnpm validate:demo-realtime-session`
  - tenant profile dry run: `node scripts/migrate-xai-runtime-profiles.mjs`
- Apply existing profile migration only after reviewing dry-run output:
  - `EVERYCALL_APPLY_XAI_PROFILE_MIGRATION=1 node scripts/migrate-xai-runtime-profiles.mjs`
- Manual canary calls must cover the exact forced tenant greeting, direct question, knowledge lookup, data capture, transfer lookup/confirmation, alphanumeric readback, barge-in during the greeting and ordinary turns, silence/background noise, and tool failure.
- During a canary, verify `xai_realtime_session_updated` reports `voice=ara`, `reasoningEffort=high`, and xAI-native `server_vad` with `threshold=0.9` and `silence_duration_ms=200`; verify `xai_realtime_turn_latency` is emitted from speech endpoint to first audio and compare it with the previous `none` baseline.
- Verify `telnyx_call_control_answer_requested` is emitted before session bootstrap completes and use `webhookToAnswerRequestMs` / `webhookToAnswerAcceptedMs` to investigate any call that rings more than once.

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
