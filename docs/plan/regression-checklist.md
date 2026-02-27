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
- Calls page loads and list displays
- FAQ Manager loads and can edit/save
- Team Users: invite, update status, delete
- SMS opt‑in flow (set phone, request opt‑in)

## Onboarding
- Intake page submit creates tenant + user
- Tenant receives industry defaults (prompt + FAQs)
- Telnyx voice number auto‑provisioning succeeds

## SMS Alerts
- Shared SMS number set in system config
- Opt‑in: user replies YES and gets confirmation
- Opt‑out: user replies STOP and gets confirmation
- Call summary triggers SMS alert to opted‑in users

## Voice Services
- Call gateway `/healthz` ok
- AI orchestrator `/healthz` ok
- Voice service `/healthz` ok

## Security
- Unauthorized API access returns 401/403
- Session expires correctly after TTL
