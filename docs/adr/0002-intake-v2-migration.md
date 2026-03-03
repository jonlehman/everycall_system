# ADR 0002: Intake V2 Migration and Activation State

- Status: proposed
- Date: 2026-03-03
- Owners: platform
- Related: `docs/SPECS/intake-onboarding-v2.md`, ADR 0001

## Context
Current onboarding behavior is not fully aligned with product requirements:
- session creation is not guaranteed in onboarding response flow
- onboarding writes are not atomic
- forwarding activation status is not modeled
- payload/field drift exists between intake UI and onboarding API

This onboarding path is business-critical and must be deterministic.

## Decision
Adopt intake v2 with:
1. Canonical onboarding request/response contract.
2. Transactional core onboarding writes.
3. Session creation immediately after successful commit.
4. Forwarding activation state persisted on tenant.
5. Idempotent submit handling for retry safety.

Schema changes:
- Add to `tenants`:
  - `forwarding_setup_status TEXT NOT NULL DEFAULT 'not_started'`
  - `forwarding_acknowledged_at TIMESTAMPTZ`
  - `forwarding_configured_at TIMESTAMPTZ`

Operational changes:
- Introduce idempotency storage and request replay behavior.
- Standardize onboarding errors to stable codes.

## Consequences
### Positive
- Clear, reliable onboarding with fewer support escalations.
- Better activation tracking (forwarding setup visibility).
- Safer retry behavior and reduced duplicate tenant creation.

### Negative
- Slightly more complexity in onboarding endpoint.
- Additional schema maintenance and migration rollout steps.

## Migration Plan
1. Deploy additive schema changes first.
2. Deploy backend v2 onboarding logic behind optional flag.
3. Update intake UI to consume v2 contract.
4. Enable v2 path in staging, run full test matrix.
5. Enable in production and monitor onboarding/error metrics.

## Backfill
- Existing tenants default to `forwarding_setup_status='not_started'`.
- No destructive migrations.

## Rollback
- Keep additive columns in place.
- Roll back app logic to previous endpoint behavior if needed.
- Do not drop new columns during rollback window.

## Alternatives considered
1. Keep onboarding non-transactional and patch individual failures.
- Rejected due to persistent partial-state risk.
2. Track forwarding activation in a separate table.
- Rejected for now; tenant-level state is sufficient and simpler.
