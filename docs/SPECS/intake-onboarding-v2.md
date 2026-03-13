# SPEC: Intake Onboarding V2

## Status
- Implemented (production)
- Owner: Platform
- Last Updated: 2026-03-05
- Rollout Note: API + E2E intake v2 tests passed in production at commit `4966b73`; monitoring window remains active.

## Scope
Defines the v2 onboarding contract for `/api/v1/tenants/onboard`, including fast-start identity capture, AI knowledge enrichment, validation, transactional behavior, session creation, and forwarding-setup guidance.

## Goals
- Complete onboarding in one deterministic flow with no partial tenant state.
- Create tenant owner user + active session on success.
- Seed tenant defaults (routing, agent, knowledge entries, guardrail questions, industry prompt baseline).
- Expose and persist call-forwarding setup status so tenant activation is explicit.

## Non-Goals
- Billing/subscription workflows.
- Multi-owner setup in onboarding.
- Full carrier-specific forwarding wizard.

## User Flow
1. Step 0 (Business Identity)
- Collect owner name, owner email, website, and industry.
- Attempt website auto-fill from owner email domain (best effort).
2. AI Enrichment (Draft)
- Load default industry knowledge sections and guardrail questions first.
- Populate knowledge entries and guardrail answers only when explicit supporting evidence is found in official website content or Google Business Profile data.
- Fall back to industry defaults when site evidence is weak or missing.
- Mark all generated values for tenant review before submit.
3. Step 1 (Business + Ops Review)
- Collect and confirm remaining onboarding fields.
- Validate required fields and password policy before final submit.
4. Submit
- Execute onboarding transaction.
- Attempt voice number provisioning (non-blocking for core onboarding success).
- Create owner session cookie.
- Return `redirectTo=/client/overview`.
5. Activation Prompt
- Show assigned EveryCall number.
- Show forwarding instruction: route overflow/no-answer calls to this number.
- Require acknowledgment or explicit "do later" choice.

## API Contract

### Endpoint
- `POST /api/v1/tenants/onboard`
- `POST /api/v1/tenants/enrichment/preview` (proposed)

### Request (canonical)
```json
{
  "businessName": "Acme Plumbing",
  "industry": "plumbing",
  "ownerName": "Jane Smith",
  "ownerEmail": "jane@acme.com",
  "password": "secret1234",
  "phone": "+12065551234",
  "address": "123 Main St, Seattle, WA 98101",
  "serviceArea": "Seattle + Eastside",
  "timezone": "America/Los_Angeles",
  "businessHours": "Mon-Fri 8 AM - 6 PM",
  "averageCallsPerDay": 12,
  "emergencyServices": true,
  "servicesOffered": ["Drain cleaning", "Water heater repair"],
  "primaryGoals": ["reduce_missed_calls", "book_more_jobs"]
}
```

### Validation Rules
- Required: `businessName`, `industry`, `ownerName`, `ownerEmail`, `password`, `serviceArea`.
- Required arrays: `servicesOffered.length >= 1`, `primaryGoals.length >= 1`.
- `ownerEmail`: normalized lowercase, valid format.
- `password`: min 8 chars (policy can expand later).
- `averageCallsPerDay`: integer >= 0 when present.
- `industry`: must exist and be active in `industries`.

### Success Response
```json
{
  "ok": true,
  "tenantKey": "acme_plumbing",
  "redirectTo": "/client/overview",
  "provisioning": {
    "voiceStatus": "active",
    "voiceNumber": "+12065550123"
  }
}
```
- Server sets authenticated session cookie for tenant owner.

### Error Response
```json
{
  "ok": false,
  "error": "email_exists",
  "message": "An account with this email already exists.",
  "fieldErrors": {
    "ownerEmail": "Already in use"
  }
}
```

### Error Codes
- `missing_fields`
- `invalid_email`
- `weak_password`
- `invalid_industry`
- `invalid_payload`
- `email_exists`
- `tenant_key_conflict`
- `onboarding_error`

## Transaction and Consistency
- All core writes run inside one DB transaction:
  - `tenants`
  - `tenant_users`
  - `onboarding_intake`
  - `routing_rules`
  - `tenant_settings`
  - `agents`
  - `agent_versions`
  - `knowledge_entries`
  - `guardrail_question_tests`
  - `provisioning_jobs`
  - `audit_log`
- On failure: full rollback.
- Session creation occurs only after successful commit.

## Idempotency
- Client sends `Idempotency-Key` header (UUID recommended).
- Server stores key + final outcome for a TTL window (24h).
- Replayed request with same key returns same terminal result and does not duplicate tenant/user creation.

## Tenant Key Strategy
- Base key: slugified `businessName`.
- Collision strategy: append numeric suffix (`_2`, `_3`, ...), bounded retry.
- If retries exhausted: return `tenant_key_conflict`.

## Number Provisioning
- Area-code source priority: `phone` then address parse.
- Provisioning failure does not roll back core onboarding.
- Persist status: `active | unavailable | failed`.
- Always return provisioning status in response.

## Forwarding Activation Requirements
- On successful onboarding UI must show:
  - Assigned EveryCall number.
  - "Route overflow/no-answer calls from your main line to this number."
- Capture and persist:
  - `forwarding_setup_status`: `not_started | acknowledged | configured`
  - `forwarding_acknowledged_at` (nullable timestamp)
  - `forwarding_configured_at` (nullable timestamp)

## Data Model Changes
- `tenants.forwarding_setup_status TEXT NOT NULL DEFAULT 'not_started'`
- `tenants.forwarding_acknowledged_at TIMESTAMPTZ`
- `tenants.forwarding_configured_at TIMESTAMPTZ`

## Security
- Hash passwords with bcrypt (existing policy baseline).
- Never log plaintext password.
- Enforce tenant scoping across all generated records.

## Observability
- Emit events/logs:
  - `onboarding.started`
  - `onboarding.submitted`
  - `onboarding.succeeded`
  - `onboarding.failed`
  - `onboarding.forwarding_acknowledged`
  - `onboarding.forwarding_configured`

## Acceptance Criteria
1. Successful intake creates tenant, owner, defaults, and owner session.
2. Failed intake leaves no partial tenant state.
3. Duplicate email returns deterministic conflict.
4. Tenant key collision handled deterministically.
5. UI shows EveryCall number + forwarding instruction on success.
6. Forwarding acknowledgment is persisted and queryable.
7. Industry default knowledge and guardrail questions are loaded before enrichment and preserved unless tenant edits them.
8. AI grounds reviewed answers in explicit evidence and falls back to industry defaults when evidence is weak.
