# Manual Call Test Scripts

## Script Safety
- `scripts/validate-knowledge-receptionist-cutover.mjs` and `scripts/validate-voice-runtime-hardening.mjs` now fail closed unless `EVERYCALL_ALLOW_SCHEMA_RESET=DROP_PUBLIC_SCHEMA` is set.
- `scripts/rebuild-creative-dynamic-harts.mjs` now fails closed unless `EVERYCALL_ALLOW_TENANT_BUILD_MUTATION=creative_dynamic` is set, and also requires `EVERYCALL_ALLOW_TENANT_ARTIFACT_DELETE=creative_dynamic` when cleanup is enabled.
- `scripts/validate-tool-dedupe-and-warranty.mjs` and `scripts/validate-source-summary-fallback.mjs` now fail closed unless `EVERYCALL_ALLOW_TENANT_BUILD_MUTATION=creative_dynamic` is set.
- `scripts/cleanup-qa-tenants.mjs` now fails closed unless `EVERYCALL_ALLOW_QA_TENANT_DELETE=DELETE_QA_TENANTS` is set.
- `scripts/test-client-ui-v2-e2e.mjs` should be run with `CLIENT_UI_TEST_DRY_RUN=1` by default; a real tenant-creating run now requires `EVERYCALL_ALLOW_TEST_TENANT_ONBOARD=1`.

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
