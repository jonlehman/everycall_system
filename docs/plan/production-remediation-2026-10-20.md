# Production remediation

This work implements the findings from the website knowledge conformance review and the preceding production logic audit. The original design remains the acceptance boundary: preserve whole-page evidence, source authority, tenant ownership, staged compilation and validated publication. Later explicit decisions remain in effect; a Proposed specification alone does not authorize weakening a frozen requirement.

Starting commit: `6dd0d95`. Existing uncommitted worker startup/logging changes are preserved separately from remediation changes. Original conformance artifacts remain historical review records.

## Acceptance rules

- Add a regression for each concrete defect using actual handlers/helpers and isolated database/provider fixtures.
- Apply only reviewed additive migrations to the verified production database before code that requires them.
- Require fresh-context independent critical review of each release batch and resolve its findings before pushing.
- Verify the Vercel app, inbound gateway, isolated sales gateway and worker separately. A successful app deployment does not certify the other services or audible calls.
- Keep source-to-requirement mappings and the intended behavior visible. A change to implementation is not an automatic amendment to the original design.

## Work inventory

| ID | Finding | Status |
| --- | --- | --- |
| K01 | Tenant isolation for override and guardrail IDs | Verified; deployment pending |
| K02 | Factual text removed by call-to-action cleanup | Verified; deployment pending |
| K03 | Recoverable original source capture and provenance | Verified; deployment pending |
| K04 | Nested relative website and download links | Verified; deployment pending |
| K05 | Atomic rolling daily rebuild limit and privileged override | Verified; deployment pending |
| K06 | Known-good rollback target admission | Verified; deployment pending |
| K07 | Source authority and negative content penalties | Verified; deployment pending |
| K08 | Deterministic conflict resolution and content QA | Verified; deployment pending |
| K09 | Structured facts and universal object types | Verified; deployment pending |
| K10 | Schema migration removed from normal request paths | Verified; deployment pending |
| K11 | Configurable reviewed mode with distinct approver | Verified; deployment pending |
| K12 | Readiness, review and publication prerequisites | Verified; deployment pending |
| K13 | Completed source-channel inventory | Verified; deployment pending |
| K14 | Runnable multi-source and cross-vertical acceptance fixtures | Verified; deployment pending |
| K15 | Reconciled requirement inventories and ongoing CI/design guards | Verified; deployment pending |
| P01 | Bound, revocable and atomically consumed invitations | Verified; deployment pending |
| P02 | Recoverable inbound webhook processing | Verified; deployment pending |
| P03 | Provider and socket cleanup despite persistence failure | Verified; deployment pending |
| P04 | Recoverable, concurrency-safe Stripe processing | Verified; deployment pending |
| P05 | Recoverable worker claims, ownership fencing and shutdown | Verified; deployment pending |
| P06 | Retriable expired-trial number release and valid SQL | Verified; deployment pending |
| P07 | Onboarding slug collisions inside transactions | Verified; deployment pending |
| P08 | Exclusive prospect claims across sales operators | Verified; deployment pending |

## Verification and releases

Implementation and release evidence will be recorded here as each batch passes its gates. Pending work remains pending until its regression, independent review and applicable deployment checks are complete.

### Implementation and verification underway

The source-integrity, recovery and governance implementations are present but have not yet been released. First independent review found three additional races: legacy worker completion after token retirement, payment during asynchronous number deletion, and duplicate Stripe requests blocking before `NOWAIT`. Repairs now pass the expanded isolated regressions and real PostgreSQL 16 contention checks. The final integrated diff still requires independent critical review.

Primary browser QA exercised the actual page, API routes and disposable database for reviewed-mode opt-in, a draft policy downgrade, same-person rejection and second-person approval. Desktop and mobile rendering completed without page errors or horizontal overflow. This used synthetic users and no provider calls. Publication, provider acceptance and public production verification remain separate gates.

The Markdown matrix and CSV now both contain all 163 original requirements. Only missing rows were added; original requirement text and historical conformance evidence were preserved. CI checks inventory integrity and runs source, governance, recovery and separate-connection PostgreSQL regressions.

### Requirements and regression mapping

| Findings | Frozen requirements | Regression evidence |
| --- | --- | --- |
| K01: tenant-owned configuration | REQ-OVR-001, REQ-OVR-003; PRD tenant isolation | Knowledge integrity and governance fixtures exercise foreign artifact/session IDs. |
| K02–K04: source capture, cleanup and links | REQ-PIPE-002, REQ-PIPE-005, REQ-PIPE-006, REQ-PIPE-007 | Source-page and integrity fixtures retain factual CTA lines, original captures and nested-link provenance. |
| K05: daily rebuild allocation | REQ-PIPE-004 | Integrity and PostgreSQL contention fixtures exercise allocation, rollback and trusted overrides; every new build kind is covered. |
| K06: rollback safety | REQ-PIPE-016 | Integrity fixture rejects unpublished or blocked targets. |
| K07–K09: authority, conflicts and fact contracts | REQ-PIPE-010, REQ-PIPE-011, REQ-PIPE-013, REQ-PIPE-015, REQ-PIPE-021, REQ-PIPE-022; REQ-RULE-004 through REQ-RULE-013 | Integrity and governance fixtures exercise normalized structured values, source precedence, conflicting claims, provenance and content blockers. |
| K10: explicit schema lifecycle | REQ-PIPE-017 | Runtime schema fixtures check actual unstripped request helpers, read-only probes, fresh bootstrap and transactional deployment receipts. |
| K11–K12: approval, readiness and publication | REQ-OVR-008; REQ-OPS-001, REQ-OPS-005, REQ-OPS-006, REQ-OPS-007; REQ-PIPE-015, REQ-PIPE-016 | Governance fixtures, actual-enqueue attribution, publication rollback and browser owner/reviewer flows. |
| K13: captured-channel inventory | REQ-PIPE-021 | Integrity fixtures distinguish requested inputs from captured channels, including queued/failed builds. |
| K14: multi-source acceptance | REQ-QA-007 | Safe offline compiler fixtures cover interview-only and website-plus-upload inputs across synthetic industries; model/provider acceptance remains separate. |
| K15: design inventory guard | All 163 original requirements and the frozen index | Inventory validator compares both inventories, manifest and original requirement text; CI runs it. |
| P01–P08: production recovery | AGENTS tenant boundaries, idempotency/retries and audit; system overview service contracts | Production recovery, worker, real PostgreSQL contention, call recovery, Sales and managed Live validators. |

Final independent review identified and is checking repairs for creator attribution, partial conflict loss, hidden request-time DDL, visible review diffs and the all-build daily cap. Tests document their scope; this mapping does not claim exhaustive semantic conformance or an audible production acceptance call.

### Final local release gates

Fresh independent reviews covered knowledge/schema governance and all eight production findings. The final [targeted repair review](../reviews/production-remediation-2026-10-20.md) found no additional concrete blocker in the repaired scope; its functional hashes identify the inspected files. All confirmed review findings were repaired, including original-capture preservation during metadata edits, creator attribution, partial conflict blocking, request-path DDL, complete review reports, all-build quota enforcement, retained Sales reservations after provider setup, actual persistence retry propagation and trusted recovery URL startup.

Passed on the final implementation: production web build; repository typecheck; source preservation/integrity/governance; runtime-schema checks (PGlite and isolated PostgreSQL); separate-connection job/Stripe/allocation contention; call recovery/release; worker release-artifact checks; source-page/rescan/lease/transaction; core facts/Part 9/pricing; Sales system; managed Live/brief/settings/client-readiness. Primary and independent desktop/mobile browser checks exercised actual API/database approval/readiness flows and inspected complete change/quality downloads and conflict evidence. External providers/models were substituted; no audible call or live-model semantic acceptance is claimed.

Production preflight verified the expected database fingerprint and migration receipt through0050, zero unended sales sessions and no duplicate active prospect reservations. No production migration or code deployment has been performed for this release. Render authorization is still unavailable; migration0054 requires gateway drain and the sales gateway requires a manual single-instance rollout. Hold production-triggering main pushes until those prerequisites can be completed. Do not bulk replay the97 historical dead-letter jobs or assume historical processed billing events were semantically correct. Existing worker WIP and untracked artifacts remain excluded from the release.
