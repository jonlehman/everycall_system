# PRD: Account Management & Billing (Stripe)

## 1. Summary
EveryCall needs a complete account management and subscription billing capability for tenant owners and platform admins. This includes paid plan signup, payment method management, invoice visibility, cancellation and reactivation, and account lifecycle controls aligned with Stripe.

This PRD defines product behavior, API surface, state transitions, and operational guardrails for MVP.

## 1.1 MVP Defaults (Implementation Quick Reference)
- Billing access:
  - Tenant Owner: allowed
  - Tenant Manager: not allowed
  - Admin/Super-admin: allowed by admin RBAC
- Grace policy:
  - Duration: 7 calendar days
  - Starts on first `past_due` transition after failed invoice payment
  - Ends in `service_access_status='restricted'` if unresolved
- Cancellation policy:
  - Default: `cancel_at_period_end`
  - Immediate cancel: allowed only with typed confirmation `CANCEL`
  - API default when `immediate` omitted: `false`
- Source of truth:
  - Stripe webhook payload is authoritative for subscription status/period fields
  - Local corrections only via webhook processing or explicit audited admin override

## 2. Primary Users
- Tenant Owner: buys plan, updates payment method, manages cancellation/reactivation.
- Tenant Manager: no billing access in MVP (owner/admin only).
- Platform Admin: support actions, billing status visibility, overrides where required.
- Finance/Support Ops: audit and reconciliation support.

## 3. Goals
- Enable self-serve subscription checkout using Stripe for tenants.
- Give tenant owners clear billing controls in Client UI.
- Give platform admins safe support controls and visibility in Admin UI.
- Keep subscription state deterministic in EveryCall DB using Stripe webhooks as source of truth.
- Prevent accidental service loss from payment issues by using explicit dunning/grace policies.

## 4. Non-Goals (MVP)
- Usage-based metering and overage billing.
- Multi-product bundles or per-seat billing.
- In-app tax engine customization beyond Stripe defaults.
- Custom invoicing terms (net 30, PO workflows).

## 5. Scope (MVP)
### 5.1 Client (Tenant-facing)
- Billing page in Client UI (`Owner` access required).
- Start paid subscription from trial or no-plan state.
- Manage payment method via Stripe Billing Portal link.
- View current plan, amount, renewal date, trial end, invoice history.
- Cancel subscription:
  - `Cancel at period end` (default).
  - Immediate cancel (only with explicit warning + confirmation).
- Reactivate subscription before cancellation effective date.

### 5.2 Admin (Platform-facing)
- Admin tenant billing panel:
  - Stripe customer/subscription IDs.
  - Current status, plan, next invoice date, delinquency state.
  - Recent billing events and webhook delivery status.
- Admin support actions (permission-gated):
  - Open Stripe customer in dashboard (deep link).
  - Trigger billing portal session on behalf of tenant (audited).
  - Mark account for manual review / temporary grace extension.

### 5.3 System
- Stripe Checkout Session creation for new subscriptions.
- Stripe Customer Portal session creation.
- Webhook ingestion for billing events.
- Account lifecycle sync to local tables.
- Audit log entries for all billing-changing actions.

## 6. UX Requirements
### 6.1 Client UI: Billing & Account
- Show a single current status card:
  - `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `incomplete`.
- Show clear next action:
  - Trialing: "Start paid plan now".
  - Past due/unpaid: "Update payment method".
  - Canceling: "Ends on <date>" + "Reactivate".
- Show invoice list with date, amount, paid/open/failed, downloadable invoice link.
- All destructive actions require typed confirmation (`CANCEL`) for immediate cancellation.

### 6.2 Admin UI: Tenant Billing Panel
- Read-first design with clear badge states.
- Display webhook freshness (`last processed event at`).
- Display warning banner when local state and Stripe state are out of sync.
- Permission model:
  - Admin can view all.
  - Support role can trigger portal and add grace note.
  - Only super-admin can force account suspension override.

MVP access defaults:
- Tenant billing UI/API access: `Owner` only.
- Tenant `Manager` billing access: disabled.
- Admin access follows existing admin RBAC (`admin`/`super-admin`).

## 7. Lifecycle & States
### 7.1 Canonical billing states
- `trialing`
- `active`
- `past_due`
- `unpaid`
- `canceled`
- `incomplete`
- `incomplete_expired`

### 7.2 Service access policy
- `trialing`, `active`: full service.
- `past_due`: full service during grace window.
- `unpaid`: restricted service (new calls may be disabled by policy flag).
- `canceled`: service ends at effective cancellation date.
- `incomplete`/`incomplete_expired`: no activation until payment completion.

MVP grace defaults:
- Grace duration: 7 calendar days.
- Grace start trigger: first transition to `past_due` after a failed invoice payment.
- Grace end timestamp persisted in `tenants.billing_grace_ends_at`.
- At grace expiry, if still `past_due`/`unpaid`: set `service_access_status='restricted'`.
- If payment succeeds before expiry: clear `billing_grace_ends_at` and set `service_access_status='enabled'`.

### 7.3 Cancellation policy (MVP default)
- Default: cancel at period end.
- Optional immediate cancellation allowed with explicit confirmation.
- Reactivation allowed before effective end date.
- If canceled and period ended, reactivation creates new subscription (not state flip).

MVP cancellation defaults:
- UI default action is always `cancel_at_period_end`.
- Immediate cancellation remains available only after typed confirmation `CANCEL`.
- API default for omitted `immediate` is `false`.

## 8. Stripe Integration Requirements
### 8.1 Stripe objects
- Customer: 1:1 with tenant.
- Subscription: 1 active subscription per tenant in MVP.
- Price: mapped to EveryCall plan catalog (e.g. `starter`, `growth`, `pro`).
- Invoice + PaymentIntent handled by Stripe default billing workflows.

### 8.2 Required webhook events (MVP)
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `customer.deleted` (defensive handling)

### 8.3 Webhook rules
- Verify Stripe signatures.
- Store `event_id` and enforce idempotency.
- Process events transactionally.
- Record processing outcome + error details.
- Retry-safe: duplicate webhook deliveries must be no-op.

## 9. Data Model (MVP)
Add billing fields/tables (names illustrative; final in spec/migration):

- `tenants`
  - `billing_status`
  - `plan_code`
  - `billing_grace_ends_at`
  - `service_access_status` (`enabled`/`restricted`/`disabled`)
  - `billing_status_updated_at`

- `tenant_billing_accounts`
  - `tenant_key` (PK/FK)
  - `stripe_customer_id` (unique)
  - `stripe_subscription_id` (nullable, unique)
  - `stripe_price_id`
  - `current_period_start`
  - `current_period_end`
  - `cancel_at_period_end`
  - `canceled_at`
  - `trial_end`
  - `last_invoice_id`
  - `updated_at`

- `billing_events`
  - `id`
  - `tenant_key`
  - `stripe_event_id` (unique)
  - `event_type`
  - `payload_json`
  - `processed_at`
  - `status` (`processed`/`failed`)
  - `error_message`

- `audit_log` (existing table)
  - include billing action entries (`billing.checkout.created`, `billing.canceled`, `billing.reactivated`, etc.)

Plan mapping (MVP default):
- Stripe `price_id` is the source-of-truth for billing plan.
- `plan_code` stores normalized app plan code: `starter | growth | pro`.
- Existing tenant `plan` display labels map as:
  - `Trial` -> trial state only (no paid `plan_code`)
  - `Growth` -> `growth`
- Unknown legacy values map to nearest valid `plan_code` during migration and log an admin warning event.

## 10. API Contracts (MVP)
All endpoints require authenticated session unless webhook/internal.

### 10.1 Tenant-facing
- `GET /api/v1/billing`
  - Returns billing summary, plan, status, renewal/cancel dates, invoices.
- `POST /api/v1/billing/checkout`
  - Creates Stripe Checkout Session for selected plan.
- `POST /api/v1/billing/portal`
  - Creates Stripe Billing Portal session.
- `POST /api/v1/billing/cancel`
  - Body: `{ immediate: boolean }`
  - If `immediate` omitted, server treats as `false`.
- `POST /api/v1/billing/reactivate`
  - Reactivates cancel-at-period-end subscription if still active in Stripe period.

### 10.2 Admin-facing
- `GET /api/v1/admin/tenants/:tenantKey/billing`
  - Billing status, Stripe IDs, recent event health.
- `POST /api/v1/admin/tenants/:tenantKey/billing/portal`
  - Creates portal session for support-assisted workflow (audited).
- `POST /api/v1/admin/tenants/:tenantKey/billing/grace`
  - Set temporary grace end date and note (permission-gated, audited).

### 10.3 Webhook/Internal
- `POST /api/v1/stripe/webhook`
  - Signature verification required.
  - Idempotent event processing required.

## 11. Security & Compliance
- Never store raw card PAN/CVC in EveryCall.
- Store only Stripe IDs and minimal invoice metadata needed for UI.
- Enforce RBAC on all billing endpoints.
- Log all privilege and billing state changes.
- Require CSRF protection/session validation for portal and cancellation actions.

## 12. Notifications
- Email (MVP optional if infrastructure exists):
  - Payment failed.
  - Trial ending soon.
  - Cancellation scheduled.
  - Cancellation effective.
- In-app banners are required even if email is deferred.

## 13. Error Handling
- Stripe API failure: return deterministic error and keep local state unchanged.
- Webhook processing failure: log failure and retry; flag tenant billing health in admin panel.
- State mismatch (`local != Stripe`): surface warning in admin and tenant billing page with support guidance.

Deterministic reconciliation rule (MVP):
- For subscription status and period fields, Stripe webhook payload is authoritative.
- Local state may be corrected only by webhook processing or explicit admin override actions (audited).

## 14. Metrics & Success Criteria
- Checkout start-to-complete conversion rate.
- Trial-to-paid conversion rate.
- Payment failure recovery rate (within 7 days).
- Cancellation rate and reactivation rate.
- Billing support tickets per 100 tenants.
- Webhook processing success rate and median lag.

## 15. Rollout Plan
1. Schema + webhook ingest + read-only billing summary.
2. Tenant checkout + portal + status banners.
3. Cancellation/reactivation flows.
4. Admin billing panel + support actions.
5. Grace policy enforcement and operational alerts.

## 16. Acceptance Criteria (MVP)
1. Tenant owner can subscribe via Stripe Checkout and become `active` after successful payment.
2. Tenant owner can access portal, update payment method, and see updated status in app.
3. Cancellation at period end and immediate cancellation both work as designed with confirmation safeguards.
4. Reactivation works when subscription has not yet fully ended.
5. Stripe webhooks are signature-verified, idempotent, and persist processing outcomes.
6. Admin can view tenant billing state and webhook health.
7. All billing-changing actions generate audit entries.
8. No card data is stored in EveryCall databases or logs.
