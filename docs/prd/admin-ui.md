# PRD: Admin UI (Platform Operations)

## Summary
The admin UI is the internal platform console for managing tenants, industries, system prompts, and platform health.

## Primary Users
- Platform admins
- Support and operations staff

## Goals
- Create and manage tenants efficiently.
- Maintain industry defaults for prompts and knowledge seeds.
- Monitor platform health and incidents.

## Non‑Goals
- Billing management
- Automated compliance workflows

## Key Screens / Flows
1. **Platform Overview**
   - Active tenants, call volume, error rate, latency.
   - Recent incidents.
2. **Tenants**
   - Create/edit tenant profile.
   - View status and number assignments.
3. **Industries**
   - Seed and update industry prompts/knowledge defaults.
   - Apply prompt/knowledge updates to all tenants in an industry.
4. **System Config**
   - Global prompts (personality, confirmation rules, knowledge usage).
5. **Audit / Jobs**
   - Audit logs, provisioning jobs.

## Data / APIs (High‑level)
- `GET /api/v1/admin/overview`
- `POST /api/v1/admin/industries?mode=seedAll`
- `GET/POST /api/v1/system/config`
- `GET /api/v1/admin/tenants`
- `GET /api/v1/admin/audit`

## Success Metrics
- Time to onboard a new tenant
- Platform incident response time
- Prompt/knowledge updates propagate reliably

## Risks
- Seeded defaults overwriting tenant customizations unintentionally
- Misconfiguration of system prompts affecting tone globally
