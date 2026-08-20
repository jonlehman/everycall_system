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
- A v3 backfill must snapshot existing pins and clear their pin flags before writing rerated rows; otherwise the pin-completeness constraint correctly rejects an old pin whose new spoken form is blank.
- Verify an overlong generated company description ends at a complete sentence within 320 characters, never on a dangling conjunction or preposition, and website publication refreshes the company description and persisted no-tool statement from the same generated snapshot.
- Run `corepack pnpm validate:knowledge-build-leases` after changing knowledge-build scheduling or terminal-state handling. It verifies exclusive claims, heartbeats, expiry takeover, token-scoped release, and that published builds cannot be reclaimed.
- The validator reconstructs the pre-Grok OpenAI v3 section set and verifies its SHA-256 baseline, tool definitions, and sample phrases, then verifies the exact v11, v12, and v13 additions separately.
- With no pins, verify the entire by-heart section and every reference to it are absent. With pins, instruction-like text must be rejected, the rendered block must stay within 600 tokens and 20 facts, and tenant/build isolation must hold.
- Verify an unchanged rating-input hash causes zero OpenAI scoring calls and carries its saved score, spoken text, model, and rated timestamp forward. Changing the canonical claim, qualifiers, boundaries, or tenant scoring context must invalidate the hash and score only that fact.
- Verify the legacy backfill refuses missing-fact model calls unless `EVERYCALL_ALLOW_CORE_FACT_OPENAI_SCORING=1` is explicitly set.
- Verify deterministic score ordering and stable tie-breaking before the versioned AI set-curation pass; verify the set pass removes semantic duplicates without merging or inventing facts, selected facts receive spoken rewrites, and call startup injects only the saved checksummed database block.
- Verify every stored spoken pin uses `we`, `our`, or `us`. A third-person canonical business fact may be rewritten in first-person only when the model marks that subject change safe; supplier/manufacturer attribution must be rejected while the build continues.
- Verify the materialized section stores its set-selector version, model, reason, selected fact IDs, and checksum so call startup never needs to rerun curation.
- In a live canary, ask one question fully covered by a pin and verify there is no lookup. Then ask an adjacent unsupported question and verify `knowledge_lookup` still runs.

## Knowledge Source Page Documents
- Run `corepack pnpm validate:knowledge-source-pages` after changing website/document extraction, source normalization, evidence persistence, or compiler inputs.
- The validator confirms that short lines such as `Cashmere, WA 98815` survive website, demo, and plain-text extraction; footer contact content is retained; more than 4,000 lines are not silently cut off; and a normal page becomes exactly one page document with line breaks intact.
- It also verifies that a genuinely oversized source stays within its per-page token budget while retaining both its beginning and end, that repeat normalization is stable, and that short fallback facts survive while the internal omission marker cannot become a fact.
- This validator is included in `corepack pnpm validate:receptionist-v14`.

## Receptionist v13 Acceptance
- Run `corepack pnpm validate:receptionist-v13` for the exact v13 prompt rules, v3 scorer/v6 rewrite and stored set-curation invariants, profile sentence-boundary validation, and deterministic `finish_session` enforcement.
- With explicit OpenAI test-cost approval, run `EVERYCALL_RUN_RECEPTIONIST_V13_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v13:realtime`.
- Run capture, joke, pinned-fact, decline, cache, and adjacent-request cases under both `legacy` and `layered` ordering.
- Capture must show: callback offer, explicit caller yes, first-name echo, one surname-spelling request, exact spelled surname in silent `data_capture`, first-name-only address afterward, later phone request, number read-back as a question, caller confirmation, no narration or detail/phone recap in the close, closing without `finish_session`, caller goodbye, then `finish_session`.
- Record assistant words for every turn across the battery; the combined average must remain below 30. No name placeholder, removed realistic name example, or two-beat negative example may appear in assistant audio.
- Pinned-fact answers must use no lookup, no holding phrase, no marketing language, and no unprompted technology name.
- Decline must be warm, must not re-ask for a callback, and must not call `finish_session` immediately.
- Cache verification uses an identical-tenant pair for legacy and a cross-tenant pair for layered. Record input tokens, cached tokens, and hit rate; Realtime cache placement is best-effort, so retain the raw observation even when an identical legacy call misses.
- Payload validation verifies that the same normalized caller receives the same privacy-preserving Realtime safety identifier across calls and tenants, while different callers do not.
- v13 validation rejects any runtime-profile default path that calls build-derived AI generation during prompt loading; prompt assembly must read the persisted tenant snapshot.
- An adjacent request must produce a substantive first sentence and `knowledge_lookup` in the same model response, never a bare hold followed immediately by the answer. An unconfirmed result must lead to an honest callback offer.

## Receptionist v14 Acceptance
- Run `corepack pnpm validate:receptionist-v14` for all v13 invariants plus silent `knowledge_lookup` prompt and tool-schema rules.
- With explicit OpenAI test-cost approval, run `EVERYCALL_RUN_RECEPTIONIST_V14_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v14:realtime`.

## Receptionist v15 Acceptance
- Run `corepack pnpm validate:receptionist-v15` to verify the exact condensed template, legacy variable injection, byte-stable layered prefix, Business Details bindings, empty volatile layer, zero-fact hygiene, and silent tool rules.
- With explicit OpenAI test-cost approval, run `EVERYCALL_RUN_RECEPTIONIST_V15_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v15:realtime` in both legacy and layered prompt modes.
- The full behavioral battery covers capture, joke handling, pinned-fact answers, callback decline, cache usage, adjacent requests, exact surname capture, no phone recap, and average assistant turns below 30 words.
- An adjacent request must emit a silent function-call-only `knowledge_lookup` response before the direct answer. No assistant audio may announce or narrate checking, searching, looking, thinking, or waiting. An unconfirmed result must still lead to an honest callback offer.

## Receptionist v17 Acceptance
- Run `corepack pnpm validate:receptionist-v17` for the condensed-prompt invariants, smooth first-name usage, the deterministic immediate-closing sequence, and the prohibition on jumping from `data_capture` directly to closing.
- With explicit OpenAI test-cost approval, run `EVERYCALL_RUN_RECEPTIONIST_V17_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v17:realtime` in both legacy and layered prompt modes.
- Name capture must begin the surname-spelling question with the caller's first name. It must not say `Thanks` before the name or put a comma, dash, or deliberate pause immediately after it. After spelling, the surname is never spoken and the first name is not used as a routine acknowledgment or in the closing.
- Before ending, the assistant must ask exactly `Do you have any other questions?`, stop, and wait. A question in response is answered before the checkpoint is asked again.
- After the caller says no or clearly says they are finished, the final turn must contain exactly `Thanks for calling. Goodbye.` plus `finish_session`. It must not wait for another caller goodbye. The behavioral battery verifies the checkpoint; the gateway treats the Realtime model's `finish_session` invocation as authoritative and never rejects it from transcript-derived state.

## Receptionist v18 Acceptance
- Run `corepack pnpm validate:receptionist-v18` for every v17 invariant plus the first-name close and the prohibition on a function-call-only `finish_session` response.
- With explicit OpenAI test-cost approval, run `EVERYCALL_RUN_RECEPTIONIST_V18_REALTIME_ACCEPTANCE=1 corepack pnpm acceptance:receptionist-v18:realtime` in both legacy and layered prompt modes.
- After the caller answers the required other-questions checkpoint with no, the same model response must say exactly `Thanks for calling, FIRSTNAME. Have a good one.` and emit `finish_session`. If no confirmed first name is known, the exact fallback is `Thanks for calling. Have a good one.` The surname, phone number, recap, and narration remain forbidden.

Use these after any change to prompts, knowledge lookup, or barge-in handling.

The second 8/19 WVG call contained one possible early VAD handoff (“Got it—a cracked pane” before the caller had finished). Record recurrence during canaries; do not retune turn detection from this single observation.

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
- For the Wenatchee Valley Glass low-reasoning trial, verify `openai_realtime_session_start` reports `reasoningEffort=low` and the outbound `session.update` contains `reasoning.effort=low`.
- Verify `call_gateway_started` reports `outboundBufferFrames=13` and `outboundBufferMs=260`, then listen for mid-sentence pauses or brief pitch artifacts during a normal caller canary.
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
