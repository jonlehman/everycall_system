# Manual Call Test Scripts

## Script Safety
- `scripts/validate-knowledge-receptionist-cutover.mjs` and `scripts/validate-voice-runtime-hardening.mjs` now fail closed unless both of these are set:
  - `EVERYCALL_ALLOW_SCHEMA_RESET=DROP_PUBLIC_SCHEMA`
  - and either `EVERYCALL_ALLOW_SCHEMA_RESET_TARGETS=<host/db>` or `EVERYCALL_ALLOW_SCHEMA_RESET_TARGET_FINGERPRINTS=<fingerprint>` matching the current `DATABASE_URL`
- `scripts/rebuild-creative-dynamic-harts.mjs` now fails closed unless `EVERYCALL_ALLOW_TENANT_BUILD_MUTATION=creative_dynamic` is set, and also requires `EVERYCALL_ALLOW_TENANT_ARTIFACT_DELETE=creative_dynamic` when cleanup is enabled.
- `scripts/validate-tool-dedupe-and-warranty.mjs` and `scripts/validate-source-summary-fallback.mjs` now fail closed unless `EVERYCALL_ALLOW_TENANT_BUILD_MUTATION=creative_dynamic` is set.
- `scripts/cleanup-qa-tenants.mjs` now fails closed unless `EVERYCALL_ALLOW_QA_TENANT_DELETE=DELETE_QA_TENANTS` is set.
- `scripts/test-client-ui-v2-e2e.mjs` should be run with `CLIENT_UI_TEST_DRY_RUN=1` by default; a real tenant-creating run now requires `EVERYCALL_ALLOW_TEST_TENANT_ONBOARD=1`.
- `scripts/smoke-production.mjs` is a read-only production regression script. It requires:
  - `EVERYCALL_ALLOW_PRODUCTION_REGRESSION=1`
  - `APP_BASE_URL=https://app.everycall.io` (or another target)
  - `PRODUCTION_SMOKE_TENANT_EMAIL` / `PRODUCTION_SMOKE_TENANT_PASSWORD`
  - `PRODUCTION_SMOKE_ADMIN_EMAIL` / `PRODUCTION_SMOKE_ADMIN_PASSWORD`
  - optional `CALL_GATEWAY_BASE_URL` to include a live gateway `/healthz` check

## Production Regression
- Run `corepack pnpm smoke:production` only with explicit approval env vars and production-safe credentials.
- The script logs into both a tenant and admin account, performs read-only page/API checks, verifies billing/dashboard/knowledge surfaces, and logs out.
- It does not create tenants, publish builds, send SMS, or modify live configuration.

## xAI Realtime Payload Validation
- Run `corepack pnpm --filter @everycall/call-gateway... build` before importing gateway dist helpers.
- Run `corepack pnpm validate:xai-realtime-payloads` after gateway build.
- The payload validator renders canonical receptionist v9 with all seven tenant values plus the automatic `core_facts_block` and compares the complete result byte-for-byte with the approved prompt. It also verifies the full by-heart section and its two references disappear when there are no pins, name precedes phone in callback capture, and transfer-enabled sessions receive the same `system_prompt` without hidden gateway text.
- Run `corepack pnpm validate:core-facts` to verify AI-at-creation rating fields, AI editorial ordering, exact rendered-line independent auditing with a required marketing-language classification and final known-leak fail-safe, missing-rating retry and fail-closed behavior, absence of numeric score cutoffs or score-order fallback, AI-ordered refinement, 600-token/20-pin defenses, instruction-like safety rejection, deletion-only atomic spoken rewrites limited to narrow comma-delimited trailing promotional clauses plus adversarial domain-term/embedded-qualifier/inversion cases, retrieval hysteresis, three-swap cap, idempotent migration, pin constraints, and continued vector indexing of every canonical fact.
- Before rollout, run `corepack pnpm audit:core-facts-rollout`; it reports migration names and v8/v9 override counts without printing tenant prompt text or secrets.
- Run `corepack pnpm validate:transfer-directory` after gateway build. It verifies exact name/extension lookup, natural-language transfer requests, general directory questions, and safe no-match behavior.
- Before changing existing tenant profiles, run `node scripts/migrate-xai-runtime-profiles.mjs` and review the dry-run rows.
- Apply the tenant profile migration only with `EVERYCALL_APPLY_XAI_PROFILE_MIGRATION=1`.

Use these after any change to prompts, knowledge lookup, or barge-in handling.

## Script 1: Emergency + Knowledge + Pre-Close
- "My water heater is leaking. Do you do emergencies?"
- "How soon can someone come out?"
- Name, phone, address, timing.
- Verify pre-close question is asked before closing.

## Script 2: Technical Question + Knowledge + Resume
- "Should I pour Drano?"
- "Do you take Apple Pay?"
- Provide name/phone/address/time.
- Verify technical deferral and grounded knowledge answer.

## Script 3: Off-Industry Request
- "I need house cleaning."
- Verify industry mismatch response.
- Confirm prompt does not proceed unless caller confirms correct service.

## Barge-In Test
- Interrupt the assistant mid-sentence with "Sorry—one sec."
- Verify assistant speech stops immediately.

## Grok Voice Think Fast 2.0 Calls
- Verify `xai_realtime_session_start` reports `model=grok-voice-think-fast-2.0`.
- Verify `xai_realtime_session_updated` reports `voice=ara`, `reasoningEffort=high`, `turnDetection.type=server_vad`, `turnDetection.threshold=0.9`, `inputAudioFormat=audio/pcmu`, and `outputAudioFormat=audio/pcmu` before the forced tenant greeting.
- Verify the opening is one interruptible `force_message`, matches the tenant’s configured greeting verbatim, is not followed by a greeting `response.create`, and never contains another tenant’s identity.
- Compare endpoint-to-first-audio latency at `high` reasoning against the previous `none` baseline while repeating the same conversation-continuity and tool-use scenarios.
- Verify no `modalities`, `max_response_output_tokens`, `eagerness`, `create_response`, or `interrupt_response` fields are sent on the inbound xAI session.
- For a tenant with an eligible directory entry, verify xAI's accepted session includes `lookup_transfer_target` and `transfer_call` alongside the knowledge and data tools.
- Verify the model-facing system instructions begin with `Who You Are`, use the tenant's seven configured values, render pinned facts as plain `Title: spoken fact` lines, and contain no gateway-appended transfer section.
- Ask one question fully covered by a pinned core fact and verify the assistant answers immediately without `knowledge_lookup`. Ask an adjacent unsupported question and verify it still calls `knowledge_lookup` instead of stretching the pinned fact.
- Verify first assistant audio arrives and outbound audio stays clear over Telnyx.
- Verify a knowledge lookup does not mention tool names, packets, scores, or system logic.
- Verify a knowledge lookup either runs silently or follows only a self-contained holding phrase; the assistant must not begin a substantive answer, pause for the lookup, and then continue it.
- Describe a project in stages and verify the assistant asks relevant follow-up questions and reflects the need before offering a callback; a plausible fit or one answered question is not enough.
- Decline an offered callback with “No thanks” and verify the assistant does not call `finish_session`, repeat the offer, or assume the call is over. It should continue helping and close only after a clear mutual ending.
- After a project-related answer, verify the assistant naturally continues the caller’s current thread when more understanding would help instead of stopping or jumping directly to a callback offer.
- Verify data capture happens only after the caller provides the value.
- Verify transfer lookup asks for confirmation before transfer.
- Verify silence and uncertain answers end with a clear next step.
- Read an alphanumeric value such as `A7K-92Q`, then verify the assistant repeats and captures every character in order.
- Pause briefly with ordinary background noise present; verify there is no spurious caller turn, duplicate response, or premature close.
- Place a speakerphone call at normal volume; verify Ara does not treat her own playback as caller speech, while a clearly spoken caller interruption still stops playback.
- Interrupt the assistant mid-sentence; verify xAI handles model-side barge-in, EveryCall sends Telnyx `clear`, and the assistant handles the new utterance without replaying stale audio.
- Verify `xai_realtime_turn_latency` records endpoint-to-first-audio timing for ordinary caller turns and turns with tool calls.
- Verify `telnyx_call_control_answer_requested` occurs before prompt/bootstrap completion and records a low `webhookToAnswerRequestMs`; confirm the PSTN call is answered on the first ring.
- Speak one sentence slowly enough to produce multiple xAI transcription updates. Verify the saved and exported transcript contains one complete caller line for that VAD turn, and verify Render emits `caller_transcript_turn_coalesced` with multiple snapshots but no transcript text.

## Outbound Sales System
- Run `corepack pnpm validate:sales-system`.
- Run `corepack pnpm typecheck` and `corepack pnpm build`.
- The sales validator suite covers CSV permission parsing, the 11-record warm queue, 30-day demo expiry, outcome advancement, durable Smartlead jobs, separate phone/email suppression, signup-token open/consume semantics, browser call options, gateway authentication, webhook signature checks and replay handling, parked-leg fail-safe behavior, conference controls, exact demo greeting, pause audio clearing, teardown, and database-backed integration.
- Browser verification must use a disposable database and confirm `/admin/sales` renders the current prospect, next prepared prospects, website facts, call readiness, conversion controls, and a visible provider-configuration error when credentials are intentionally absent.
- Before pilot traffic, make one controlled live provider call and verify:
  - the operator leg is parked on the dedicated sales connection
  - the prospect and AI standby dial concurrently
  - `AI Ready` requires both the accepted xAI session and the Telnyx AI leg
  - `Start Demo` joins the existing AI leg and begins with the configured business greeting
  - operator audio stays live, `Pause AI` cancels speech and clears buffered audio, and `End Demo` removes only the AI
  - duplicate Telnyx/xAI webhooks do not repeat commands
  - ending either human leg tears down the conference and unused AI standby
