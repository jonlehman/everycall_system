# EveryCall Regression Checklist

Run this after major changes or before release. Mark each item pass/fail.

## Admin Console
- Login as admin
- Tenants list loads
- Manage tenant: update status/plan/region/industry
- Import industry prompt + FAQs works
- System config saves (including Telnyx SMS fields)

## Client Workspace
- Login as client
- Overview loads
- Global assistant enabled/disabled toggle is visible at top-right across client screens
- Calls page loads and list displays
- Knowledge screen loads and can edit/save
- Team Users: invite, update status, delete
- SMS opt‑in flow (set phone, request opt‑in)
- Client UI v2 page scaffold present (title, status banner, primary action)
- Client UI v2 states validated (loading, empty, error, permission-denied where applicable)
- Setup checklist (`/client/setup`) loads and deep links to Knowledge/Team/Routing/Settings
- Overview triage actions work (urgent calls, callbacks, inbox)
- Calls Inbox filter/detail workflow works end-to-end
- Routing and Settings show explicit save state (`Saving`, `Saved`, error)
- Role-gated write actions behave correctly for restricted users

## Onboarding
- Intake page submit creates tenant + user
- Intake submit creates authenticated owner session and lands in client workspace
- Tenant receives industry defaults (prompt + FAQs)
- Industry default guardrail questions load before AI enrichment answers are applied
- AI leaves guardrail answers blank when no explicit website/Google Business Profile evidence exists
- Telnyx voice number auto‑provisioning succeeds
- Post-intake activation screen shows EveryCall number and forwarding instruction
- Forwarding acknowledgment/configured status persists on tenant
- Assistant toggle remains disabled until setup items are complete, including resolving blank required FAQs (answer or delete)

## SMS Alerts
- Shared SMS number set in system config
- Opt‑in: user replies YES and gets confirmation
- Opt‑out: user replies STOP and gets confirmation
- Call summary triggers SMS alert to opted‑in users

- Call gateway `/healthz` ok

## Security
- Unauthorized API access returns 401/403
- Session expires correctly after TTL
