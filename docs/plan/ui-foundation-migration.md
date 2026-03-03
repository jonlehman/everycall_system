# Plan: Tailwind + shadcn/ui Migration

## Objective
Migrate the entire web application UI to Tailwind + shadcn/ui with minimal feature disruption.

## Decision Link
- ADR: `docs/adr/0004-tailwind-shadcn-ui-standard.md`
- Spec: `docs/SPECS/ui-foundation-tailwind-shadcn.md`

## Phase 0: Foundation Setup
Deliverables:
- Install and configure Tailwind in Next.js app.
- Add shadcn/ui base setup.
- Create initial theme tokens and base utility docs.
- Add shared primitives folder for common UI components.

Exit criteria:
- Build passes with Tailwind pipeline enabled.
- New sample component renders using shadcn primitive.

## Phase 1: Canonical Screen Migration (Calls)
Deliverables:
- Migrate `/client/calls` wrapper/layout/forms/actions to Tailwind/shadcn patterns.
- Preserve existing behavior for filters, inline editing, notes, and save status.
- Keep MUI DataGrid temporarily if needed.

Exit criteria:
- UX parity verified against current calls workflow.
- No visual regressions on desktop/mobile breakpoints.

## Phase 2: Client Surface Migration
Targets:
- `/client/overview`
- `/client/setup`
- `/client/faq`
- `/client/routing`
- `/client/settings`
- `/client/team`

Exit criteria:
- All client routes use shared Tailwind/shadcn primitives.
- Legacy client-specific inline style usage removed or minimized.

## Phase 3: Admin Surface Migration
Targets:
- `/admin/overview`
- `/admin/tenants*`
- `/admin/users`
- `/admin/audit`
- `/admin/jobs`
- `/admin/system`
- `/admin/industries`

Exit criteria:
- Admin routes aligned to same primitive set and tokens.
- No new legacy global style dependencies introduced.

## Phase 4: Cleanup + Enforcement
Deliverables:
- Remove unused selectors from `public/assets/app.css`.
- Add lint/PR guidance to block non-standard styling additions.
- Document component usage patterns for future work.

Exit criteria:
- Legacy CSS debt reduced to exceptions only.
- Team docs updated and enforced in code review.

## Risk Controls
- Keep behavior-first regression checks on Calls workflows.
- Migrate screen-by-screen, not big-bang.
- Run `corepack pnpm build` after each migration chunk.
- Keep PRs scoped to single surface area where possible.

## Definition of Done
- Tailwind + shadcn/ui is the default for new UI work.
- Existing client/admin screens migrated and stable.
- Shared component patterns documented and reused.
- Production build and smoke tests pass post-migration.
