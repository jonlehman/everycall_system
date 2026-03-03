# ADR 0004: Tailwind + shadcn/ui as UI Standard

- Status: accepted
- Date: 2026-03-03
- Owners: Platform, Client UI

## Context
The app UI currently mixes:
- Global CSS (`public/assets/app.css`)
- Per-page inline style objects in React components
- MUI DataGrid usage for dense tables

This creates inconsistent spacing, typography, and component behavior across admin and client screens. It also slows iteration because styles are not tokenized in a single system.

## Decision
Adopt **Tailwind CSS + shadcn/ui** as the default UI foundation for the entire web application (admin + client surfaces).

Standard direction:
- Tailwind utility classes for layout, spacing, typography, color, state.
- shadcn/ui components as the baseline primitive library.
- Centralized design tokens in Tailwind theme + CSS variables.
- New UI work must use Tailwind/shadcn patterns by default.

Transitional exception:
- MUI DataGrid may remain temporarily where replacing it would increase delivery risk, but wrappers around table containers, filters, and side panels should still use Tailwind/shadcn styling.

## Consequences
Positive:
- Faster UI iteration and cleaner consistency across screens.
- Better composability and fewer one-off CSS rules.
- Clear reusable patterns for forms, cards, status banners, and navigation.

Costs:
- Initial setup and migration effort across all screens.
- Temporary mixed-mode period while legacy CSS is removed.
- Team must align on class conventions and component usage boundaries.

## Alternatives Considered
1. Continue with current custom CSS:
- Rejected: too much drift and repeated ad-hoc styling.

2. MUI-only migration:
- Rejected: would require broader component rewrites and conflicts with current layout approach.

3. Mantine:
- Rejected for now: good DX, but less aligned with desired low-level style control and existing team preference for utility-first workflows.
