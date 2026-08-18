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

## Realtime 2 Payload Validation
- Run `corepack pnpm --filter @everycall/call-gateway... build` before importing gateway dist helpers.
- Run `corepack pnpm validate:realtime2-payloads` after gateway build.
- Before changing existing tenant profiles, run `node scripts/migrate-realtime2-runtime-profiles.mjs` and review any `manual_review` rows.
- Apply the tenant profile migration only with `EVERYCALL_APPLY_REALTIME2_PROFILE_MIGRATION=1`.

## What You Know By Heart
- Run `corepack pnpm validate:core-facts` after building `@everycall/contracts`. This verifies that factual-importance scoring is independent of source wording, the stability/safety/40-point gates are separate, and spoken rewrite failures do not erase importance scores.
- A v2 backfill must snapshot existing pins and clear their pin flags before writing rerated rows; otherwise the pin-completeness constraint correctly rejects an old pin whose new spoken form is blank.
- Verify an overlong generated company description ends at a complete sentence within 320 characters, never on a dangling conjunction or preposition, and website publication refreshes the company description and persisted no-tool statement from the same generated snapshot.
- Run `corepack pnpm validate:knowledge-build-leases` after changing knowledge-build scheduling or terminal-state handling. It verifies exclusive claims, heartbeats, expiry takeover, token-scoped release, and that published builds cannot be reclaimed.
- The validator reconstructs the pre-Grok OpenAI v3 section set and verifies its SHA-256 baseline, tool definitions, and sample phrases, then verifies the exact v11 additions separately.
- With no pins, verify the entire by-heart section and every reference to it are absent. With pins, instruction-like text must be rejected, the rendered block must stay within 600 tokens and 20 facts, and tenant/build isolation must hold.
- Verify an unchanged rating-input hash causes zero OpenAI scoring calls and carries its saved score, spoken text, model, and rated timestamp forward. Changing the canonical claim, qualifiers, boundaries, or tenant scoring context must invalidate the hash and score only that fact.
- Verify the legacy backfill refuses missing-fact model calls unless `EVERYCALL_ALLOW_CORE_FACT_OPENAI_SCORING=1` is explicitly set.
- Verify deterministic score-descending selection, stable tie-breaking, deletion-only reranking without OpenAI, pin-only spoken rewrites, materialized-section checksums, and call-start injection from the saved database block.
- Verify a rewrite that introduces `we`, `our`, or `us` when the canonical supplier fact is third-person is rejected. If both the initial and repair rewrites remain unsafe, verify only that fact is excluded and the build continues.
- In a live canary, ask one question fully covered by a pin and verify there is no lookup. Then ask an adjacent unsupported question and verify `knowledge_lookup` still runs.

## Receptionist v11 Acceptance
- Run `corepack pnpm validate:receptionist-v11` for exact prompt rules and deterministic `finish_session` enforcement.
- With explicit OpenAI test-cost approval, run `EVERYCALL_RUN_RECEPTIONIST_V11_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v11:realtime`.
- Run capture, joke, pinned-fact, decline, and cache cases under both `legacy` and `layered` ordering.
- Capture must show: callback offer, explicit caller yes, name request, later phone request, number read-back as a question, caller confirmation, optional-note wait if used, closing without `finish_session`, caller goodbye, then `finish_session`.
- Pinned-fact answers must use no lookup, no holding phrase, no marketing language, and no unprompted technology name.
- Decline must be warm, must not re-ask for a callback, and must not call `finish_session` immediately.
- Cache verification uses an identical-tenant pair for legacy and a cross-tenant pair for layered. Record input tokens, cached tokens, and hit rate; Realtime cache placement is best-effort, so retain the raw observation even when an identical legacy call misses.

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

## GPT-Realtime-2.1 Canary Calls
- Verify `openai_realtime_session_start` reports `model=gpt-realtime-2.1` and `apiShape=realtime2`.
- Verify first assistant audio arrives and outbound audio stays clear over Telnyx.
- Verify a knowledge lookup does not mention tool names, packets, scores, or system logic.
- Verify data capture happens only after the caller provides the value.
- Verify transfer lookup asks for confirmation before transfer.
- Verify silence and uncertain answers end with a clear next step.
- Read an alphanumeric value such as `A7K-92Q`, then verify the assistant repeats and captures every character in order.
- Pause briefly with ordinary background noise present; verify there is no spurious caller turn, duplicate response, or premature close.
- Interrupt the assistant mid-sentence; verify audio stops promptly and the assistant handles the new utterance without replaying stale audio.

## Outbound Sales System
- Run `corepack pnpm validate:sales-system`.
- Run `corepack pnpm typecheck` and `corepack pnpm build`.
- The sales validator suite covers CSV permission parsing, the 11-record warm queue, 30-day demo expiry, outcome advancement, durable Smartlead jobs, separate phone/email suppression, signup-token open/consume semantics, browser call options, gateway authentication, webhook signature checks and replay handling, parked-leg fail-safe behavior, conference controls, exact demo greeting, pause audio clearing, teardown, and database-backed integration.
- Browser verification must use a disposable database and confirm `/admin/sales` renders the current prospect, next prepared prospects, website facts, call readiness, conversion controls, and a visible provider-configuration error when credentials are intentionally absent.
- Before pilot traffic, make one controlled live provider call and verify:
  - the operator leg is parked on the dedicated sales connection
  - the prospect and AI standby dial concurrently
  - `AI Ready` requires both the accepted OpenAI session and the Telnyx AI leg
  - `Start Demo` joins the existing AI leg and begins with the configured business greeting
  - operator audio stays live, `Pause AI` cancels speech and clears buffered audio, and `End Demo` removes only the AI
  - duplicate Telnyx/OpenAI webhooks do not repeat commands
  - ending either human leg tears down the conference and unused AI standby
