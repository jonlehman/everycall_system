# SPEC: Client UI V2 (Tenant Workspace)

## Status
- Proposed
- Owner: Platform
- Last Updated: 2026-03-03

## Scope
Defines implementation requirements for the tenant-facing Client UI, including role-aware behavior, UX structure, API integration contracts, and operational workflows.

## Goals
- Make daily call operations obvious at first glance.
- Keep full configuration capability without overwhelming users.
- Enforce safe role-based write behavior.
- Standardize loading/empty/error/save feedback across all client screens.
- Expose one global assistant `Enabled/Disabled` control with deterministic setup gating.

## Non-Goals
- CRM replacement features.
- Cross-tenant management.
- Advanced analytics beyond operational KPI summaries.

## Mandatory UX Rules
1. One primary CTA per screen.
2. Progressive disclosure for advanced options.
3. Consistent page skeleton: title -> status -> CTA -> content -> save state.
4. Explicit save state (`Saving`, `Saved`, actionable error).
5. Plain-language labels over system jargon.
6. Global assistant toggle at top-right on all client screens.
7. Toggle remains disabled/grayed-out until setup readiness checks pass.

## Role Contract
| Capability | Owner | Manager | Staff |
|---|---|---|---|
| View overview/calls | Yes | Yes | Yes |
| Edit Knowledge | Yes | Yes | No |
| Edit routing | Yes | Yes | No |
| Edit settings | Yes | Yes | No |
| Manage team roles | Yes | Limited | No |

Server authorization is authoritative; UI gating is supplementary.

## Screen Contracts

### 1) Overview
Purpose:
- Triage and prioritize work for current shift.

Required modules:
- Global top bar showing assistant `Enabled/Disabled` toggle and readiness status.
- KPI cards: calls today, missed, urgent, callbacks due.
- Recent calls list.
- Action queue.

Required actions:
- Open urgent call.
- Open callback task.
- Open full Calls Inbox.
- Open unresolved setup checklist items when toggle is disabled.

Setup readiness gate (toggle unlock conditions):
- Forwarding setup is `acknowledged` or `configured`.
- Required Settings section has a successful save.
- Required Routing section has a successful save.
- No unresolved blank guardrail answers remain.

### 2) Calls Inbox
Purpose:
- Process call records quickly with inline call outcome updates.

Required modules:
- Filterable/paginated call list.
- Call detail panel with inline editable `status`, `urgency`, and short AI summary.
- Inline editable internal notes field with explicit save state.
- Transcript viewer for selected call.

Required actions:
- Apply filters (status/urgency/date).
- Open call details.
- Edit status/urgency/summary/notes directly in-page.
- Save call detail edits without leaving the screen.

### 3) Knowledge
Purpose:
- Keep tenant knowledge and high-risk answers deterministic and current.

Required modules:
- Knowledge entry editor.
- Guardrail Questions review.
- Ask-the-assistant preview and feedback routing.

Required actions:
- Edit and save knowledge entries.
- Approve or adjust guardrail answers.
- Review, approve, or reject pending fact corrections.

### 4) Routing
Purpose:
- Configure normal/emergency/after-hours handling.

Required modules:
- Primary routing target.
- Emergency behavior.
- After-hours behavior.
- Business hours.

Required actions:
- Save valid configuration only.
- Confirm material behavior changes.

### 5) Settings
Purpose:
- Update tenant profile and operating defaults.

Required modules:
- Business profile.
- Timezone/hours.
- Notification and call preference fields.

Required actions:
- Save scoped edits with inline validation.

### 6) Team
Purpose:
- Manage workspace access safely.

Required modules:
- User list.
- Invite form.
- Role/status controls (permission-gated).

Required actions:
- Invite user.
- Update role/status.
- Deactivate/reactivate with confirmation.

## UI State Requirements
Each screen must implement:
- Loading state.
- Empty state.
- Error state with retry.
- Permission-denied state for unauthorized writes.

No blank states on API failure.

## API Integration Requirements
Required endpoints:
- `GET /api/v1/overview`
- `GET /api/v1/calls`
- `GET /api/v1/dashboard/calls`
- `GET/POST /api/v1/knowledge`
- `GET/POST /api/v1/routing`
- `GET/POST /api/v1/settings`
- `GET/POST /api/v1/tenant/users`

Contract requirements:
- Stable error shape (`error`, `message`, optional field-level errors).
- Tenant scoping on all reads/writes.
- Pagination metadata for list endpoints where applicable.

## Performance Requirements (MVP)
- Overview first meaningful render <= 2.0s on broadband.
- Route transitions <= 500ms perceived delay where cached.
- Save action response <= 1.5s median for knowledge/routing/settings.

## Security Requirements
- Auth-required access to all client routes and APIs.
- Role checks for all mutating endpoints.
- Safe confirmation for destructive actions.
- Session expiry recovery path to login + return-to-screen.

## Telemetry Requirements
Track:
- Page views by role and screen.
- API errors by endpoint and code.
- Save success/failure by feature area.
- Time to first successful config after onboarding.

## Acceptance Criteria
1. All six screens match contracts above.
2. Mandatory UX rules are implemented consistently.
3. Role gating and backend authorization are aligned.
4. Required UI states exist on all screens.
5. Regression and E2E test matrix passes in staging.
6. Global assistant toggle is visible on all client screens and is state-consistent.
7. Toggle cannot be enabled until setup readiness gate conditions are met.
