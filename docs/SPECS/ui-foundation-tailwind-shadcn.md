# SPEC: UI Foundation Migration (Tailwind + shadcn/ui)

## Status
- Proposed
- Last Updated: 2026-03-03

## Purpose
Define implementation rules for migrating all web UI surfaces to Tailwind + shadcn/ui.

## In Scope
- `app/client/**`
- `app/admin/**`
- shared layout shells and navigation
- shared UI primitives (buttons, cards, form fields, status messages, dialogs)

## Out of Scope (Initial)
- Major IA/navigation restructuring
- New product features unrelated to UI foundation

## Required Standards
1. Styling source of truth:
- Tailwind classes + shared utility helpers.
- Avoid new page-specific global CSS unless unavoidable.

2. Component source of truth:
- Use shadcn/ui primitives for buttons, inputs, selects, dialogs, cards, badges, tooltips, and tabs.
- Extend via composition, not forked style variants per page.

3. Tokens:
- Define semantic tokens for background, foreground, muted, border, brand, success, warning, danger.
- Keep light/dark readiness in tokens even if only light mode ships now.

4. Accessibility:
- All interactive controls keyboard reachable.
- Focus-visible states must be obvious.
- Color choices meet minimum contrast for text and controls.

5. Responsive behavior:
- Layouts must support desktop and mobile breakpoints without horizontal overflow.
- Dense tables require overflow handling and readable control layouts.

6. Legacy CSS retirement:
- No net-new styles in `public/assets/app.css` for migrated screens.
- Replace inline style objects with Tailwind classes where practical.

## Calls Page Contract (First Canonical Target)
For `/client/calls`, migration must preserve:
- Calls table with status + urgency badges.
- Inline editable details and notes.
- Compact filter controls in the calls card.
- Collapsible left navigation behavior.

## Engineering Constraints
- MUI DataGrid may remain in place during Phase 1.
- Wrap DataGrid with Tailwind-styled containers and controls.
- If DataGrid is replaced later, use a dedicated follow-up ADR.

## Acceptance Criteria
1. Tailwind and shadcn/ui installed and configured in the app.
2. Shared primitives documented and used by both admin and client pages.
3. Calls page migrated as reference implementation.
4. At least 80% of admin/client screens migrated off legacy layout CSS.
5. Regression build and smoke tests pass.
