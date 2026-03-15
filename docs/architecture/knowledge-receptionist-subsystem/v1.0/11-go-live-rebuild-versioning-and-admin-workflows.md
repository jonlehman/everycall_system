# 11 Go-Live, Rebuild, Versioning, and Admin Workflows

Status: Frozen handoff baseline
## Purpose

This document defines how the subsystem moves from draft configuration to an active, production-ready tenant deployment.

## Core principles

- no tenant should go live on an incomplete build
- published builds are immutable
- rebuilds are manual and rate-limited
- rollback must always be possible
- pack maturity and tenant readiness are separate concepts

## Build lifecycle statuses

Recommended build statuses:
- `draft`
- `running`
- `failed`
- `compiled_unpublished`
- `qa_blocked`
- `ready_to_publish`
- `published`
- `superseded`
- `rolled_back`

## Pack maturity statuses

### `new`
- canonical pack exists
- additional scrutiny required
- stricter acceptance criteria before tenant go-live

### `established`
- production-tested
- standard acceptance criteria apply

## Tenant readiness statuses

Recommended readiness states:
- `not_started`
- `in_progress`
- `blocked`
- `ready_for_review`
- `ready_for_go_live`
- `live`

## Not-ready-for-go-live switch

This existing EveryCall concept should remain the final activation gate.

The switch should remain OFF until the required readiness checklist passes.

## Required readiness checklist

### Domain/business behavior
- Business Call Intent Card exists
- at least one domain/subdomain assignment exists
- stage playbook is configured
- disclosure strategy is configured
- preferred outcomes are configured

### Operational facts
- hours confirmed or overridden
- address/location details confirmed or overridden
- phone/transfer routing confirmed
- after-hours behavior configured
- service-area behavior configured where relevant

### Knowledge build
- at least one approved-source build completed successfully
- current build published
- no unresolved high-severity conflicts
- minimum viable knowledge coverage met

### Guardrails / overrides
- dangerous-question playbook reviewed
- hard overrides reviewed
- temporary notices checked
- approved answer snippets reviewed if used

### Setup interview readiness
- if setup interview mode is used, required interview stages are complete
- critical operational facts captured during the interview are confirmed
- incomplete interviews do not satisfy readiness

### Runtime / QA
- sample call simulations passed
- handoff/callback path tested
- outcome capture tested
- any required pack-level eval suites passed

## Manual rebuild workflow

1. tenant initiates rebuild
2. system checks once-per-day eligibility
3. source-intake / compile pipeline runs
4. quality report is generated
5. diff vs current build is presented
6. admin/tenant reviews blockers and warnings
7. build is published or rejected
8. prior build remains available for rollback

## Rebuild rate-limiting

### Required rule
- maximum one rebuild initiation per tenant per rolling 24-hour window unless a privileged admin override exists

### Why
- cost control
- avoids thrash
- encourages deliberate review
- reduces accidental publish churn

## Publish workflow

### Preconditions
- build status is `ready_to_publish`
- schema validation passed
- readiness blockers cleared
- reviewer has proper permission

### Publish actions
- set new build as active
- mark prior active build as superseded
- persist publish metadata
- record diff summary
- emit audit log event

## Rollback workflow

### Allowed reasons
- newly discovered contradiction
- runtime regressions
- bad crawl scope capture
- customer complaint about factual correctness
- pack regression

### Rollback rules
- rollback should restore the most recent known-good build
- rollback must not require a fresh crawl
- rollback should preserve audit trace

## Versioning model

### Pack versioning
Semantic-ish versioning is recommended:
- major = incompatible pack behavior changes
- minor = additive/behavior-improving changes
- patch = bugfixes or wording/weight adjustments without conceptual contract changes

### Build versioning
Builds should have immutable IDs and timestamped publish metadata.  
They should also record:
- pack versions used
- source snapshot ID
- artifact counts
- warnings
- supersedes pointer


## Configuration review workflow

The architecture must support both immediate-save and approval-required models for high-impact tenant changes.

### High-impact change classes
- hard overrides
- temporary operational notices
- dangerous-question rules
- approved answer snippets
- Business Call Intent Card changes
- source-authority promotions for uploaded docs
- confirmation promotions for owner-interview facts

### Workflow rule
- if tenant/org policy does not require review, these changes may go live immediately with audit logging
- if review is required, these changes remain in draft until approved by a second qualified tenant admin or an EveryCall admin
- review-required mode must be compatible with go-live/readiness checks and build publication

## Admin roles and responsibilities

### Tenant admin
Can typically:
- request rebuild
- edit Business Call Intent Card
- edit hard overrides and soft guidance
- review build warnings
- manage dangerous-question rules

### EveryCall admin
Can additionally:
- manage domain/subdomain packs
- override rebuild limits
- publish/rollback across tenants
- inspect internal quality diagnostics
- promote packs from `new` to `established`

## Audit requirements

The system should audit:
- who initiated rebuild
- who edited overrides/guardrails
- who changed business call intent
- who published/rolled back builds
- when go-live status changed

## Operational non-goals

This subsystem should not:
- auto-publish silent website changes
- rebuild continuously without review
- allow go-live solely because a crawl succeeded
- merge pack and tenant readiness into one ambiguous status

## Recommended review artifacts for UI

- current build summary
- diff vs previous build
- blocker list
- warning list
- artifact counts
- top changed cards
- changed operational facts
- outstanding dangerous-question gaps
