# Plan: Client UI V2 Delivery

## Status
- Proposed
- Target Start: 2026-03-03
- Duration: 2-3 weeks

## Milestones

### M1: Contracts and UX Baseline (Day 1-3)
- Owner: Frontend
- Deliverables:
  - Approve `docs/SPECS/client-ui-v2.md`.
  - Create shared page template and save-state component pattern.
  - Define plain-language label glossary.
- Exit Criteria:
  - UX baseline approved and reusable in all screens.

### M2: Core Screen Refactor (Day 3-8)
- Owner: Frontend
- Deliverables:
  - Overview and Calls Inbox aligned to new workflow and CTA rules.
  - Knowledge and Routing screens aligned to save-state and validation standards.
  - Settings and Team role-gated actions aligned with matrix.
- Exit Criteria:
  - Each screen meets spec contract and UX state requirements.

### M3: API and Role Enforcement Hardening (Day 6-10)
- Owner: Backend
- Deliverables:
  - Standardize API error envelopes.
  - Add missing role checks for mutating endpoints.
  - Add pagination metadata where needed.
- Exit Criteria:
  - Contract tests pass for all client endpoints.

### M4: Test, Rollout, and Monitoring (Day 10-15)
- Owner: QA + Platform
- Deliverables:
  - Execute full `docs/TESTS-client-ui-v2.md`.
  - Update regression checklist for client UI v2 behaviors.
  - Staging rollout and production release.
- Exit Criteria:
  - No P0/P1 defects.
  - Monitoring baseline captured for 7 days.

## Work Breakdown

### Frontend Tasks
1. Build shared page shell and status banner pattern.
2. Enforce one-primary-CTA hierarchy on all client screens.
3. Add loading/empty/error/permission states to all screens.
4. Implement owner setup checklist and deep links.
5. Apply plain-language labels.

### Backend Tasks
1. Normalize error payload formats for client APIs.
2. Validate role checks on all mutating client endpoints.
3. Add/confirm pagination + filter contracts.

### QA Tasks
1. Run API contract suite for client endpoints.
2. Run E2E critical workflows (triage, faq save, routing save, team updates).
3. Validate session-expiry recovery behavior.

## Risks and Mitigations
- Risk: UI inconsistency across screens during refactor.
- Mitigation: shared template and component contracts before feature edits.

- Risk: Permission regressions.
- Mitigation: role matrix tests for each write endpoint.

- Risk: Feature creep.
- Mitigation: keep scope bound to six core screens and workflow clarity.

## Definition of Done
1. Spec acceptance criteria met.
2. `docs/TESTS-client-ui-v2.md` passes in staging.
3. Regression checklist includes client-ui v2 items and passes.
4. Production rollout complete with monitoring window active.
