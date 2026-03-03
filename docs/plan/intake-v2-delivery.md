# Plan: Intake V2 Delivery

## Status
- Proposed
- Target Start: 2026-03-03
- Duration: 2 weeks (can compress with parallel staffing)

## Milestones

### M1: Contracts and Schema (Day 1-2)
- Owner: Backend
- Deliverables:
  - Finalize API request/response contract.
  - Add DB columns for forwarding setup fields.
  - Add idempotency storage mechanism.
  - Document error code catalog.
- Exit Criteria:
  - Migration applies on staging.
  - API contract reviewed and approved.

### M2: Backend Core Onboarding (Day 2-5)
- Owner: Backend
- Deliverables:
  - Refactor onboarding into transaction boundary.
  - Fix payload mapping (`phone` used as primary phone source).
  - Add deterministic tenant key collision handling.
  - Add idempotency-key handling.
  - Create owner session on success.
  - Return provisioning summary and `redirectTo`.
- Exit Criteria:
  - Integration tests pass for happy/failure paths.
  - No partial state after forced failure tests.

### M3: Intake UI and Activation UX (Day 4-7)
- Owner: Frontend
- Deliverables:
  - Align payload to canonical v2 contract.
  - Improve error mapping to field-level feedback.
  - Add post-success activation screen:
    - Show EveryCall number.
    - Show forwarding instructions.
    - Capture acknowledgment/do-later action.
  - Add status update call for forwarding setup changes.
- Exit Criteria:
  - E2E happy path passes.
  - Forwarding acknowledgment persists.

### M4: Verification, Rollout, and Cleanup (Day 7-10)
- Owner: QA + Platform
- Deliverables:
  - Run full intake v2 test matrix.
  - Update regression checklist.
  - Deploy to staging and run smoke.
  - Production rollout with monitoring window.
- Exit Criteria:
  - Zero P0/P1 defects.
  - Production onboarding completion rate stable.

## Work Breakdown

### Backend Tasks
1. Add migration for:
- `tenants.forwarding_setup_status`
- `tenants.forwarding_acknowledged_at`
- `tenants.forwarding_configured_at`
2. Add idempotency table and helper functions.
3. Update `/api/v1/tenants/onboard`:
- strict validation
- transaction usage
- collision-safe tenant key generation
- session creation
- canonical response shape
4. Add endpoint to update forwarding status.

### Frontend Tasks
1. Update intake form validation for required arrays/fields.
2. Submit `primaryGoals` consistently (rename from singular client key).
3. Handle deterministic error codes with user-friendly messages.
4. Replace immediate redirect with success/activation panel.
5. Capture forwarding acknowledgment and persist.

### QA Tasks
1. API integration tests for success/failure/idempotency.
2. E2E test for onboarding + authenticated redirect + activation prompt.
3. Regression suite updates for onboarding and auth flows.

## Risks and Mitigations
- Risk: transaction refactor introduces regressions.
- Mitigation: keep API surface stable during refactor and add snapshot tests.

- Risk: provisioning provider flakiness affects onboarding UX.
- Mitigation: treat provisioning as non-blocking with explicit status messaging.

- Risk: duplicate submits from impatient users.
- Mitigation: idempotency keys + disabled submit UI while pending.

## Dependencies
- Database migration deployment support.
- Existing session/auth utilities remain stable.
- Industry defaults data availability.

## Definition of Done
1. Spec requirements in `docs/SPECS/intake-onboarding-v2.md` are implemented.
2. `docs/TESTS-intake-v2.md` passes in staging.
3. Regression checklist onboarding section updated and passing.
4. Production deployment completed with 24-hour monitoring and no P0/P1.
