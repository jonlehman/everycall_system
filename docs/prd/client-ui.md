# PRD: Client UI (Tenant Workspace) v2

## 1. Summary
The Client UI is the tenant-facing operations workspace for managing call handling, knowledge, and follow-up actions. It must be fast, clear, and safe for daily use by owners, managers, and dispatch staff.

## 2. Primary Users
- Owner: full tenant control, team and configuration authority.
- Manager: operational control of calls, routing, FAQs, and team activation/deactivation.
- Staff/Dispatcher: handle day-to-day calls and follow-up workflows.

## 3. Goals
- Provide a high-signal daily operating view with actionable call queues.
- Make core configuration (FAQ, routing, greeting/settings) editable without engineering help.
- Ensure call details and transcripts are easy to review and act on.
- Preserve tenant safety: role-based access, clear destructive-action controls, deterministic behavior.
- Gate assistant activation until setup readiness is complete and explicit.

## 4. Non-Goals
- Full CRM pipeline management.
- Forecasting/business intelligence suite.
- Cross-tenant or multi-brand management from client UI.

## 5. Usability Principles (Dead Obvious + Full Featured)
These principles are mandatory across all client UI screens.

1. One home, one job:
- `Overview` only answers: "What needs attention now?"
- Keep top-level actions limited and operational.

2. Single primary action per screen:
- Each screen has one dominant CTA users can identify instantly.
- Secondary actions are visually subordinate.

3. Progressive disclosure:
- Basic controls first.
- Advanced options behind explicit "Advanced" toggles.

4. Consistent screen template:
- Use: title -> status banner -> primary action -> content -> save feedback.
- Avoid custom layouts unless strictly necessary.

5. Task mode over menu mode:
- Provide checklist-driven onboarding/optimization tasks for owners/managers.
- Deep-link each checklist item to the exact edit destination.

6. Plain-language labels:
- Prefer action language over system terms.
- Labels should be understandable without training.

7. Explicit save feedback:
- Always show `Saving`, `Saved`, or actionable error.
- No silent failures and no ambiguous save state.

8. Global activation control:
- A single assistant `Enabled/Disabled` toggle is visible at top-right on all client screens.
- Toggle is grayed out and forced `Disabled` until setup readiness is complete.

## 6. UI Workflow (End-to-End)
This is the intended day-to-day workflow in the Client UI. Navigation, defaults, and calls-to-action should reinforce this sequence.

### 5.1 First Login Workflow (Post-Onboarding)
1. Land on `Overview`.
2. If forwarding is not configured:
- Show activation banner with clear action to complete forwarding setup.
3. Show global assistant toggle in `Disabled` state with unmet-checklist reasons.
4. Guide user to "minimum viable setup":
- `Settings` (confirm business profile + timezone/greeting)
- `FAQ` (review industry defaults, fill blanks, or delete unwanted items)
- `Routing` (confirm emergency/after-hours behavior)
5. Return user to `Overview` with confirmation that setup baseline is complete.
6. Enable toggle interaction only after all required setup items are complete.

Completion condition:
- Forwarding setup status is `acknowledged` or `configured`.
- Required Settings save completed.
- Required Routing save completed.
- No unresolved blank required FAQs remain (each blank was answered or item deleted).

### 5.2 Daily Operations Workflow
1. Start on `Overview` to triage:
- Review missed/urgent/callback metrics.
- Open highest-priority items from Action Queue.
2. Move to `Calls Inbox`:
- Filter calls by urgency/status/date.
- Open details/transcript.
- Decide follow-up action.
3. Execute follow-up:
- Resolve callback/dispatch directly in the Calls Inbox dispatch panel.
4. If repeated caller questions are observed:
- Update `FAQ` immediately.
5. If repeated escalation patterns are observed:
- Update `Routing`.

Completion condition:
- Action queue reduced and urgent callbacks addressed for the current shift.

### 5.3 Configuration Workflow (Owner/Manager)
1. Open `FAQ` to maintain answer quality.
2. Open `Routing` to adjust call-handling policy.
3. Open `Settings` for tenant profile or notification changes.
4. Open `Team` to invite/deactivate users and adjust role access.
5. Return to `Overview` and verify operational metrics after changes.

Completion condition:
- Saves are successful and reflected in subsequent call behavior/metrics.

### 5.4 Error/Recovery Workflow
1. Any save failure surfaces inline error + retry action.
2. Unauthorized action surfaces permission message and blocks write.
3. Session expiry redirects to login and returns user to intended screen after re-auth.
4. API outage shows explicit degraded state and retry option.

Completion condition:
- User can recover without data loss or ambiguous state.

## 7. Role Permissions (MVP)
| Capability | Owner | Manager | Staff |
|---|---|---|---|
| View overview/calls | Yes | Yes | Yes |
| Edit FAQ | Yes | Yes | No |
| Edit routing rules | Yes | Yes | No |
| Edit tenant settings | Yes | Yes | No |
| Manage team users/roles | Yes | Limited (status only) | No |
| Access audit-like admin controls | No | No | No |

Notes:
- "Limited" manager permissions can be expanded later, but default must be conservative.
- Server-side authorization is authoritative; UI role gating is presentation-level only.

## 8. Screen Descriptions (Simple + Full Featured)

### 7.1 Overview (Home)
Purpose:
- Give users one clear starting place for daily work.

Core layout:
- Global top bar with assistant `Enabled/Disabled` toggle (top-right, all screens).
- Top summary strip: Calls Today, Missed, Urgent, Callbacks Due.
- Recent Calls panel.
- Action Queue panel.

Primary actions:
- Open a call detail from Recent Calls.
- Open queued follow-up task from Action Queue.
- Jump to Calls Inbox for full triage.

Simplicity rules:
- No dense configuration controls on this screen.
- Keep to "what needs attention now."

### 7.2 Calls Inbox
Purpose:
- Process and review call records without clutter, with inline editing on a selected call.

Core layout:
- Left: filterable call log focused on time, caller/number, AI summary, status, urgency.
- Right: selected call detail with inline editable status, urgency, short AI summary, and notes.
- Transcript area below editable fields for context.

Primary actions:
- Filter by status/urgency/date.
- Review transcript and extracted details.
- Update status/urgency/summary inline.
- Write and save internal call notes inline.

Simplicity rules:
- One selected call at a time.
- Details remain readable on long transcripts.
- No separate modal for call edits or notes.

### 7.3 FAQ Manager
Purpose:
- Maintain answer quality and reduce repeated caller confusion.

Core layout:
- Searchable FAQ table/list.
- Inline edit/create form with category.

Primary actions:
- Create FAQ.
- Edit existing FAQ.
- Delete tenant-created FAQ (with confirm).

Simplicity rules:
- Clear save/cancel controls.
- Immediate feedback after save.

### 7.4 Routing Rules
Purpose:
- Control normal, emergency, and after-hours call behavior.

Core layout:
- Primary queue settings.
- Emergency behavior settings.
- After-hours behavior settings.
- Business hours editor.

Primary actions:
- Update routing rules.
- Save and verify effective behavior.

Simplicity rules:
- Guardrails for invalid/incomplete rule combinations.
- Confirmation for material routing changes.

### 7.5 Settings
Purpose:
- Manage tenant profile and operational defaults.

Core layout:
- Business profile block.
- Timezone and hours block.
- Notification/preferences block.

Primary actions:
- Update business metadata.
- Update operational defaults.

Simplicity rules:
- Group related fields.
- Preserve unsaved edits on API failure.

### 7.6 Team
Purpose:
- Keep access control manageable without admin overhead.

Core layout:
- Team user list.
- Invite user form.
- Role/status controls (permission-gated).

Primary actions:
- Invite team member.
- Change role/status (Owner/Manager only).
- Deactivate/reactivate users.

Simplicity rules:
- Confirm destructive actions.
- Explain permission boundaries clearly.

## 9. Key Screens and Acceptance Criteria

### 9.1 Overview
Purpose:
- Show current call health and immediate action needs.

Must provide:
- Calls today, missed, urgent, callbacks due.
- Recent calls list (at least last 5).
- Action queue with due/priority visibility.

Acceptance criteria:
- Loads with tenant-scoped data only.
- Empty state displayed when no calls exist.
- API failure state shown with retry action.
- Initial render target: <= 2.0s on standard broadband for cached users.
- Assistant toggle is disabled/grayed out until setup readiness checks pass.
- Toggle state is consistent across all client screens.

### 9.2 Calls Inbox
Purpose:
- Review all calls and inspect details/transcript quickly.

Must provide:
- Paginated call log with status/urgency/date filters.
- Call detail panel with editable status/urgency/summary.
- Inline notes field with explicit save action and feedback.
- Combined transcript for selected call.

Acceptance criteria:
- Filter/query state persists while navigating.
- Transcript render handles long content without layout break.
- Call detail edits persist without leaving the page.
- 404/permission errors handled with user-safe message.

### 9.3 FAQs
Purpose:
- Maintain deterministic answer quality.

Must provide:
- FAQ list, create/edit/delete controls (based on role).
- Category support and save confirmation.

Acceptance criteria:
- Save is idempotent and returns updated item state.
- Clear conflict/error messaging for failed saves.
- Changes visible immediately in list after save.

### 9.4 Routing
Purpose:
- Configure how calls are handled in normal, emergency, and after-hours scenarios.

Must provide:
- Primary queue, emergency behavior, after-hours behavior, business hours.

Acceptance criteria:
- Validation prevents invalid/empty required rule sets.
- Save requires explicit confirmation if routing behavior changes materially.
- Successful save shows timestamped confirmation.

### 9.5 Settings
Purpose:
- Manage tenant profile and operational preferences.

Must provide:
- Tenant profile data, timezone, notification preferences, voice/greeting config as available.

Acceptance criteria:
- Edits are field-validated with inline feedback.
- Failed saves preserve unsaved user input.

### 9.6 Team
Purpose:
- Manage tenant users and access safely.

Must provide:
- User list, invite flow, status changes, role updates (role-limited).

Acceptance criteria:
- Invite duplicates return deterministic conflict message.
- Deactivate/reactivate actions require confirmation.
- Role changes logged to audit trail.

## 10. UX State Requirements
Each screen must implement:
- `loading` state (skeleton/spinner with clear context).
- `empty` state (explain why no data and what to do next).
- `error` state (short message + retry button).
- `permission denied` state (action not allowed for role).

No silent failures. No blank screens on API errors.

## 11. API Contracts (MVP)
This PRD defines required behavior. Endpoint schemas should be documented in corresponding API specs.

Required endpoints:
- `GET /api/v1/overview`
  - Returns stats + recent calls + action queue for session tenant.
- `GET /api/v1/calls`
  - Supports pagination/filtering by status/urgency/date.
- `GET /api/v1/dashboard/calls`
  - Dashboard-optimized call feed.
- `GET/POST /api/v1/faq`
  - Tenant FAQ read/write with validation.
- `GET/POST /api/v1/routing`
  - Routing rules read/write.
- `GET/POST /api/v1/settings`
  - Tenant settings read/write.
- `GET/POST /api/v1/tenant/users`
  - Team management with role checks.

Contract requirements:
- Stable error codes and user-safe messages.
- Tenant scoping enforced server-side.
- Pagination metadata where list size can exceed one page.

## 12. Security and Compliance Requirements
- All UI data access requires authenticated session.
- Strict tenant isolation: no cross-tenant data access.
- Role checks enforced on write endpoints.
- Session expiry must redirect to login with clear recovery path.
- Sensitive actions require explicit confirmation (delete/deactivate/routing changes).

## 13. Observability
Track:
- page_view by screen and role.
- API error rates by endpoint and error code.
- Save success/failure for FAQ, routing, settings, team actions.
- Time to first successful configuration after onboarding.

## 14. Success Metrics and Targets
- Time to first configuration (FAQ + routing + greeting/settings):
  - Target: median <= 15 minutes from first login.
- Call follow-up completion rate:
  - Target: +20% relative improvement over current baseline.
- Missed calls:
  - Target: -20% relative within 30 days of active use.
- UX reliability:
  - Target: <1% client-UI API request failure rate (excluding 4xx user errors).

## 15. Risks and Mitigations
- Risk: Over-complex settings cause misconfiguration.
  - Mitigation: progressive disclosure, inline validation, safer defaults.
- Risk: Non-deterministic FAQ behavior reduces trust.
  - Mitigation: explicit FAQ editor workflow + save confirmations + API enforcement.
- Risk: Role confusion leads to accidental privilege exposure.
  - Mitigation: role matrix, server-side permission checks, test coverage.
- Risk: Session expiry disrupts workflows.
  - Mitigation: clear redirect and re-auth recovery UX.

## 16. Testing Requirements
- Unit tests for client state reducers/helpers where used.
- API integration coverage for each write surface.
- End-to-end coverage for:
  - Login -> Overview load.
  - FAQ edit/save flow.
  - Routing update flow.
  - Team invite/status update flow.
- Regression checklist execution before release.

## 17. Definition of Done
1. All six core screens meet acceptance criteria.
2. Role gating and server authorization match permission matrix.
3. Required loading/empty/error states implemented on each screen.
4. Success metrics instrumentation is in place.
5. Regression checklist passes in staging and production smoke.

## 18. Implementation Checklist (Usability)
- Overview shows only high-priority metrics and action links.
- Each screen has one clear primary CTA.
- Advanced settings are hidden by default and grouped.
- All screens follow the same visual/interaction skeleton.
- Owner/manager checklist is visible and actionable.
- System jargon in labels is replaced with plain-language alternatives.
- Save lifecycle UI is explicit (`Saving` -> `Saved` or actionable error).
