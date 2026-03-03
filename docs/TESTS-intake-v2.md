# Intake V2 Test Matrix

Use this for staging signoff and pre-production verification of onboarding v2.

## Quick Run Commands
- API integration checks:
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:intake:v2:api`
- E2E session + activation checks:
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:intake:v2:e2e`
- Dry run (no network calls):
  - `INTAKE_TEST_DRY_RUN=1 corepack pnpm test:intake:v2:api`
  - `INTAKE_TEST_DRY_RUN=1 corepack pnpm test:intake:v2:e2e`

## 1. API Integration Tests

### Happy Path
1. Submit valid payload.
2. Assert `200 { ok: true }`.
3. Assert tenant/user/default rows exist.
4. Assert session cookie is set.
5. Assert response includes `redirectTo` and provisioning status.

### Validation Failures
1. Missing required fields -> `400 missing_fields`.
2. Invalid industry -> `400 invalid_industry`.
3. Weak password -> expected validation error code.
4. `servicesOffered=[]` -> validation error.
5. `primaryGoals=[]` -> validation error.

### Conflict and Idempotency
1. Duplicate owner email -> deterministic conflict (`409 email_exists` preferred).
2. Tenant slug collision -> suffix strategy or explicit conflict per spec.
3. Replay same request with same `Idempotency-Key` -> no duplicate rows; same response body.

### Rollback Safety
1. Inject failure after tenant insert.
2. Assert transaction rollback leaves no tenant/user/default residues.

### Provisioning Resilience
1. Simulate Telnyx failure.
2. Assert onboarding still succeeds.
3. Assert `provisioning.voiceStatus=failed` is persisted and returned.

## 2. UI / E2E Tests

### Happy Path
1. Open `/intake`.
2. Complete Step 1 with valid data and continue.
3. Complete Step 2 with required selections and submit.
4. Verify success/activation panel displays assigned EveryCall number.
5. Verify forwarding instruction text is present.
6. Acknowledge forwarding setup.
7. Verify redirect to `/client/overview` as authenticated user.

### Error Handling
1. Submit with duplicate email.
2. Verify user-friendly error appears and form data is preserved.

### Retry Behavior
1. Trigger network timeout on submit.
2. Retry with same payload.
3. Verify single tenant is created.

## 3. Data Integrity Checks
1. `tenants.forwarding_setup_status` starts as `not_started`.
2. Acknowledgment updates status -> `acknowledged` and sets timestamp.
3. Mark configured updates status -> `configured` and sets timestamp.
4. Industry defaults seeded as expected.
5. Routing and agent defaults seeded as expected.

## 4. Security Checks
1. Password is stored hashed only.
2. Unauthorized calls to onboarding-admin paths are denied.
3. Tenant data cannot be accessed cross-tenant after onboarding.

## 5. Manual Signoff Checklist
- Onboarding completion rate test run complete.
- Time-to-complete measured and within expected threshold.
- Forwarding activation message reviewed for clarity.
- Production support notes prepared for common onboarding failures.
