# ADR 0001: Enforce Tenant Isolation in Application and Data Layers

- Status: accepted
- Date: 2026-02-24
- Owners: platform
- Related: AUTH-001, DATA-001

## Context
This platform serves multiple businesses on shared infrastructure. A single tenant data leak is unacceptable.

## Decision
Enforce tenant boundaries at all layers:
- All tenant-owned tables require non-null `tenant_id`.
- API middleware resolves tenant context before handler execution.
- Repository/query helpers require tenant-scoped predicates.
- Background jobs carry `tenant_id` and fail closed if missing.
- Integration tests include explicit cross-tenant access denial checks.

## Consequences
### Positive
- Strong default safety against accidental cross-tenant access.
- Easier compliance/audit posture.

### Negative
- More boilerplate in data access.
- Requires strict test discipline and shared helper usage.

## Alternatives considered
1. Database row-level security only - deferred for now; still possible later.
2. Soft tenant checks in handlers - rejected due to high regression risk.
