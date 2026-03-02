# PRD: Tenant Intake & Onboarding

## Summary
The intake process is a two‑step onboarding flow that collects business details, configures defaults, and creates the tenant workspace.

## Primary Users
- New tenant owners signing up for a trial

## Goals
- Collect core business details quickly.
- Auto‑configure defaults (industry prompts, FAQs, routing).
- Create initial admin user and session.

## Non‑Goals
- Long‑form onboarding or training
- Complex billing and subscriptions

## Flow Overview
1. **Step 1: Business Basics**
   - Business name, industry, owner details, credentials.
2. **Step 2: Operations**
   - Phone, address, service area, hours, goals, services offered.
3. **Submit**
   - Create tenant record.
   - Seed industry prompts/FAQs.
   - Create owner account and default agent config.
   - Redirect to client overview.

## Data / APIs
- `POST /api/v1/tenants/onboard`
- Seeds: `industry_prompts`, `industry_faqs`, `faqs`, `agents`

## Success Metrics
- Intake completion rate
- Time to first call handled

## Risks
- Incomplete business data leading to poor routing or tone.
- Industry mismatch with requested services.
