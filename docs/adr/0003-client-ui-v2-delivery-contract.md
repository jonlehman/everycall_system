# ADR 0003: Client UI V2 Delivery Contract

- Status: proposed
- Date: 2026-03-03
- Owners: platform
- Related: `docs/prd/client-ui.md`, `docs/SPECS/client-ui-v2.md`

## Context
The client workspace has grown feature-rich, but workflow clarity and consistency can regress without enforceable delivery standards. We need a stable contract for UX simplicity, role safety, and screen consistency.

## Decision
Adopt Client UI v2 with:
1. Mandatory UX rules (single primary CTA, progressive disclosure, explicit save feedback).
2. Screen-level contracts for Overview, Calls Inbox, Knowledge, Routing, Settings, Team.
3. Role matrix as an implementation guardrail.
4. Shared test matrix as a release gate.

No schema migration is required for this ADR by default; focus is UI/API contract enforcement and workflow clarity.

## Consequences
### Positive
- Clearer user journeys and lower training/support burden.
- More predictable implementation across screens.
- Reduced risk of hidden write failures or permission confusion.

### Negative
- Requires short-term refactor work across existing screens.
- May defer low-value visual customization in favor of consistency.

## Rollout Plan
1. Approve spec and plan.
2. Implement shared UI patterns first.
3. Refactor screens in phased order: Overview -> Calls -> Knowledge/Routing -> Settings/Team.
4. Run client-ui-v2 test matrix in staging.
5. Deploy with 7-day monitoring window.

## Alternatives considered
1. Incremental unstructured edits screen-by-screen.
- Rejected due to repeated UX drift risk.
2. Full redesign before contract definition.
- Rejected because it increases ambiguity and delivery risk.
