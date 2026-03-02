# PRD: Client UI (Tenant Workspace)

## Summary
The client UI is the tenant-facing workspace for configuring the AI receptionist and reviewing call activity. It focuses on operational clarity: recent calls, action queue, FAQs, routing rules, and team settings.

## Primary Users
- Tenant owners and managers
- Call center/dispatch staff

## Goals
- Provide a clear daily operating view of call volume and action items.
- Enable tenants to configure prompts, FAQs, and routing without engineering help.
- Surface call details and transcripts for follow‑up.

## Non‑Goals
- Full CRM replacement
- Complex analytics or forecasting

## Key Screens / Flows
1. **Overview**
   - Calls today, missed, urgent, callbacks due.
   - Recent calls table with summary.
   - Action queue for callbacks.
2. **Calls Inbox**
   - List and detail view of calls.
   - Combined transcripts.
3. **FAQs**
   - View/edit FAQs for tenant.
4. **Routing**
   - Configure routing rules and dispatch.
5. **Settings**
   - Tenant profile details, notification settings.
6. **Team**
   - Users, roles, access management.

## Data / APIs (High‑level)
- `GET /api/v1/overview` for stats and recent calls
- `GET /api/v1/calls` and `GET /api/v1/dashboard/calls` for call data
- `GET/POST /api/v1/faq` for tenant FAQs
- `GET/POST /api/v1/routing` for routing rules
- `GET/POST /api/v1/settings` for tenant settings
- `GET/POST /api/v1/tenant/users` for team management

## Success Metrics
- Time to first configuration (FAQ + greeting + routing)
- Call follow‑up completion rate
- Reduced missed calls

## Risks
- Over‑complex settings causing misconfiguration.
- Lack of deterministic FAQ enforcement leading to inconsistent answers.
