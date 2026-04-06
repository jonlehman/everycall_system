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
