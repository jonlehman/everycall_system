# PRD: Tenant Intake & Onboarding

## Summary
The intake process starts with a lightweight business identity screen, then uses AI-assisted enrichment to prefill onboarding details, followed by activation guidance.

## Primary Users
- New tenant owners signing up for a trial

## Goals
- Collect core business details quickly.
- Auto‑configure defaults (industry prompts, FAQs, routing).
- Create initial admin user and session.
- Reduce manual form filling by pre-populating fields from trusted business data sources.

## Non‑Goals
- Long‑form onboarding or training
- Complex billing and subscriptions
- Fully autonomous publishing of generated FAQs without tenant review

## Flow Overview
1. **Step 0: Business Identity (Fast Start)**
   - Collect only: owner name, owner email, website, industry.
   - Attempt website auto-fill from owner email domain.
   - If email domain is consumer/free-mail (for example `gmail.com`, `yahoo.com`, `outlook.com`), do not auto-fill website and require manual website entry.
2. **AI Enrichment (Draft)**
   - Load default industry FAQ questions first.
   - Fetch website content and available Google Business Profile data.
   - For each default industry FAQ, generate an answer only when an explicit supporting statement is found in source data.
   - Leave FAQ answers blank when explicit evidence is not found.
   - Generate suggested onboarding defaults from the same source set.
   - Mark all generated fields as draft/pending review.
3. **Step 1: Business + Ops Review**
   - Show generated values for review/edit before submit.
   - Require user confirmation for critical fields (phone, address, service area, services, hours).
4. **Submit**
   - Create tenant + owner + defaults in one transaction.
   - Seed industry prompts/FAQs and default agent config.
   - Persist generated FAQ drafts only after tenant confirmation.
   - Create authenticated owner session cookie.
   - Attempt voice number provisioning (non-blocking).
   - Return canonical response including `redirectTo` and provisioning status.
5. **Activation Prompt**
   - Show assigned EveryCall number.
   - Instruct tenant to route overflow/no-answer calls to this number.
   - Capture forwarding status: `not_started`, `acknowledged`, or `configured`.
   - Continue to client overview.

## Procedure Controls (V2)
1. Deterministic validation with stable error codes and field-level errors.
2. Transactional core writes with full rollback on failure.
3. Idempotent submit handling via `Idempotency-Key` for safe retries.
4. Number provisioning treated as non-blocking with explicit `voiceStatus`.
5. Forwarding setup state persisted with acknowledgment/configured timestamps.

## Procedure Controls (AI Enrichment)
1. Website auto-fill from email domain is best-effort and never forced.
2. Generated FAQ answers must be reviewable/editable before publish.
3. FAQ answer generation requires explicit source evidence; otherwise answer remains blank.
4. Prefer source order: official website, then Google Business Profile data.
5. Store source attribution per generated FAQ answer (`sourceType`, `sourceUrl`, `retrievedAt`) for auditability.
6. If enrichment confidence is low or sources are missing, fall back to manual entry.

## Data / APIs
- `POST /api/v1/tenants/onboard`
- `POST /api/v1/tenants/forwarding-status`
- `POST /api/v1/tenants/enrichment/preview` (proposed)
- Seeds: `industry_prompts`, `industry_knowledge_entries`, `industry_guardrail_question_templates`, `knowledge_entries`, `guardrail_question_tests`, `agents`

## Success Metrics
- Intake completion rate
- Time to first call handled

## Risks
- Incomplete business data leading to poor routing or tone.
- Industry mismatch with requested services.
