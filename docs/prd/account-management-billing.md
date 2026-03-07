# PRD: Account Management & Billing (Stripe)

## 1. Summary
EveryCall needs a complete account management and subscription billing capability for tenant owners and platform admins. This includes paid plan signup, payment method management, invoice visibility, cancellation and reactivation, and account lifecycle controls aligned with Stripe.

This PRD defines product behavior, API surface, state transitions, and operational guardrails for MVP.

## 1.1 MVP Defaults (Implementation Quick Reference)
- Billing access:
  - Tenant Owner: allowed
  - Tenant Manager: not allowed
  - Admin/Super-admin: allowed by admin RBAC
- Trial policy:
  - Duration: 30 calendar days
  - Starts at: tenant signup / account creation / phone number creation
  - Time basis: system timezone
  - Credit card required at trial start: no
  - Reminder emails: 5 days before trial end, 2 days before trial end, and on the final trial day
  - Trial badge: top-right app chrome badge when no active card/subscription is present, with days remaining countdown
  - Post-trial lead-capture-only window: 30 calendar days
  - Shutdown warning email: 5 days before post-trial window ends
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
- Allow a full 30-day trial with no card required at signup.
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
- During trial with no active card/subscription:
  - App chrome shows a top-right `Trial` badge with days remaining.
  - Billing page clearly shows trial end date and CTA to add payment method / start paid plan.
- After trial expires without paid subscription:
  - Login succeeds, but app access is billing-locked to the payment page only.
  - All non-billing application routes redirect to billing/paywall.
  - Tenant cannot view lead details in app until billing is activated.

### 5.2 Admin (Platform-facing)
- Admin tenant billing panel:
  - Stripe customer/subscription IDs.
  - Current status, plan, next invoice date, delinquency state.
  - Recent billing events and webhook delivery status.
- Admin support actions (permission-gated):
  - Open Stripe customer in dashboard (deep link).
  - Trigger billing portal session on behalf of tenant (audited).
  - Mark account for manual review / temporary grace extension.
  - Super-admin only: override tenant monthly subscription amount and billing-cycle reversion window (audited, permission-gated).

### 5.3 System
- Stripe Checkout Session creation for new subscriptions.
- Stripe Customer Portal session creation.
- Webhook ingestion for billing events.
- Account lifecycle sync to local tables.
- Audit log entries for all billing-changing actions.
- Trial reminder email scheduling and delivery.
- Post-trial lead-capture-only mode:
  - Calls still answer normally.
  - Lead data is still collected and saved.
  - User notifications use all active notification methods in the system.
  - New lead notifications use teaser-only messaging: `New lead: <5-7 word description with no contact info>. Activate billing to access it.`
  - This mode lasts for 30 calendar days after trial expiration if unpaid.
  - At 5 days before that window ends, send shutdown notice warning that the phone number will be disconnected if billing is not activated.
  - After that window ends, disconnect the purchased phone number and deactivate the account; retained leads and related data remain stored.

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
- If no active paid subscription/card exists, show a persistent top-right trial badge in the app shell:
  - Format: `Trial: <N> days left`
  - Show on all tenant app screens until paid billing becomes active
- On or after trial expiration without paid activation:
  - Replace normal app destination with billing/paywall destination after login.
  - Show clear explanation that new leads are still being captured, but access requires subscription activation.
  - Billing-locked experience allows only billing, help, and logout routes.
  - After post-trial shutdown, login shows: `Please email support@everycall.io to reactivate your account.`

### 6.2 Admin UI: Tenant Billing Panel
- Read-first design with clear badge states.
- Display webhook freshness (`last processed event at`).
- Display warning banner when local state and Stripe state are out of sync.
- Permission model:
  - Admin can view all.
  - Support role can trigger portal and add grace note.
  - Only super-admin can force account suspension override and manage tenant price overrides.

MVP access defaults:
- Tenant billing UI/API access: `Owner` only.
- Tenant `Manager` billing access: disabled.
- Admin access follows existing admin RBAC (`admin`/`super-admin`).

## 7. Lifecycle & States
### 7.1 Canonical billing states
- `trialing`
- `trial_expired`
- `active`
- `past_due`
- `unpaid`
- `canceled`
- `incomplete`
- `incomplete_expired`

### 7.2 Service access policy
- `trialing`, `active`: full service.
- `trial_expired`: telephony remains active, but tenant UI access is billing-locked and lead details are hidden until subscription starts.
- `trial_expired` is limited to a 30-day post-trial retention window.
- `deactivated`: post-trial shutdown complete; tenant phone number is released, account login shows support reactivation message, and data remains soft-retained.
- `past_due`: full service during grace window.
- `unpaid`: restricted service (new calls may be disabled by policy flag).
- `canceled`: service ends at effective cancellation date.
- `incomplete`/`incomplete_expired`: no activation until payment completion.

MVP trial defaults:
- Trial duration: 30 calendar days from tenant signup / account creation / phone number creation.
- Trial end enforcement flips at midnight system time on the day after the final trial day.
- No payment method required to start trial.
- Reminder emails are sent at:
  - 5 days before `trial_end`
  - 2 days before `trial_end`
  - 0 days before `trial_end` (final day reminder)
- Day after `trial_end`, if no paid subscription is active:
  - Set `billing_status='trial_expired'`
  - Keep `service_access_status='enabled'` for telephony capture
  - Set app access/paywall flag so login lands on billing page only
  - Keep notifications running on all active notification methods, but only send teaser lead alerts without exposing contact info
  - Start `post_trial_access_ends_at = trial_end + 30 days`
- 5 days before `post_trial_access_ends_at`, if still unpaid:
  - Send shutdown warning on all active notification methods stating that the tenant phone number will be disconnected in 5 days if billing is not activated
- At `post_trial_access_ends_at`, if still unpaid:
  - Set `billing_status='deactivated'`
  - Set `service_access_status='disabled'`
  - Keep `app_access_status='billing_locked'`
  - Release/disconnect the purchased phone number assigned to the tenant
  - Keep leads, transcripts, summaries, and related account data as soft-retained records
  - Show support reactivation message on login: `Please email support@everycall.io to reactivate your account.`
- On successful paid activation after trial expiry:
  - Clear paywall restriction
  - Restore normal app access
  - Preserve captured leads for later access
  - Cancel any pending shutdown workflow
  - If already deactivated, reactivation is admin-assisted and provisions a new phone number rather than restoring the released one

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
- Subscription: 1 active subscription per tenant in MVP. On conversion before trial end, create the Stripe subscription immediately with `trial_end` set to the tenant's existing local trial end timestamp so card is collected now and billing begins automatically at trial end.
- Subscription creation rule:
  - During normal signup: no Stripe subscription is created.
  - During conversion before trial end: create Stripe Checkout in subscription mode, require payment method collection, and create the subscription with `trial_end = tenant.trial_end`.
  - During conversion after trial expiration: create the subscription with no trial and bill immediately.
  - During admin reactivation: no Stripe subscription is created until the tenant later converts by entering a valid card.
- Price: amount is stored in EveryCall and sent server-side at order time using inline recurring `price_data`, rather than maintaining a large catalog of fixed Stripe prices.
- Admin override price: super-admin can set tenant-specific amount and optional reversion cycle count.
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

### 8.4 Price override behavior
- Default monthly amount comes from EveryCall plan configuration.
- Super-admin may set:
  - `monthly_amount_override_cents`
  - `price_override_cycles_remaining`
  - `price_override_reason`
- `price_override_cycles_remaining` semantics:
  - `0` means indefinite override
  - positive integer means decrement once per successful billing cycle
  - when counter reaches zero after decrement, future billing reverts to default plan amount
- Override values are owned by EveryCall and passed to Stripe as server-generated recurring pricing during checkout/subscription update flows.

### 8.5 Reactivation billing rule
- Admin or super-admin may reactivate a deactivated tenant by:
  - setting account state back to trialing
  - entering remaining free trial days
  - provisioning a new phone number
- Reactivation does not create a Stripe customer or subscription unless/until the tenant later converts with a valid card.

## 9. Data Model (MVP)
Add billing fields/tables (names illustrative; final in spec/migration):

- `tenants`
  - `billing_status`
  - `plan_code`
  - `trial_started_at`
  - `trial_end`
  - `post_trial_access_ends_at`
  - `billing_grace_ends_at`
  - `service_access_status` (`enabled`/`restricted`/`disabled`)
  - `app_access_status` (`enabled`/`billing_locked`)
  - `deactivated_at`
  - `billing_status_updated_at`

- `tenant_billing_accounts`
  - `tenant_key` (PK/FK)
  - `stripe_customer_id` (unique)
  - `stripe_subscription_id` (nullable, unique)
  - `stripe_price_id`
  - `stripe_override_price_id` (nullable)
  - `monthly_amount_override_cents` (nullable)
  - `price_override_reason` (nullable)
  - `price_override_cycles_remaining` (nullable, `0` = indefinite)
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

- `billing_lifecycle_events`
  - `id`
  - `tenant_key`
  - `event_type`
  - `from_billing_status`
  - `to_billing_status`
  - `from_service_access_status`
  - `to_service_access_status`
  - `from_app_access_status`
  - `to_app_access_status`
  - `reason`
  - `metadata_json`
  - `created_by_type` (`system`/`stripe_webhook`/`tenant_user`/`admin`)
  - `created_by_id` (nullable)
  - `created_at`

- `audit_log` (existing table)
  - include billing action entries (`billing.checkout.created`, `billing.canceled`, `billing.reactivated`, etc.)
  - include price override and retention shutdown entries (`billing.price_override.updated`, `billing.post_trial_shutdown_scheduled`, `billing.post_trial_shutdown_executed`)

Plan mapping (MVP default):
- Stripe amount configuration originates in EveryCall.
- Per-tenant override is allowed with a tenant-specific override amount and optional cycle countdown before reverting to the default amount.
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
  - Includes contact-channel health for trial ending / post-trial shutdown notifications.
- `POST /api/v1/admin/tenants/:tenantKey/billing/portal`
  - Creates portal session for support-assisted workflow (audited).
- `POST /api/v1/admin/tenants/:tenantKey/billing/grace`
  - Set temporary grace end date and note (permission-gated, audited).
- `POST /api/v1/admin/tenants/:tenantKey/billing/price-override`
  - Super-admin only. Set or clear tenant-specific recurring amount override and cycles-until-revert value (permission-gated, audited).
- `POST /api/v1/admin/tenants/:tenantKey/reactivate`
  - Admin-assisted reactivation flow that re-enables the account and provisions a new phone number if the old one was released.

### 10.3 Webhook/Internal
- `POST /api/v1/stripe/webhook`
  - Signature verification required.
  - Idempotent event processing required.

## 10.4 Lifecycle Transition Table
| Current state | Event | Next state | Actions taken |
| --- | --- | --- | --- |
| `trialing` | Trial reaches final day, then midnight passes without paid conversion | `trial_expired` | Lock app to billing/help/logout, keep telephony enabled, start `post_trial_access_ends_at`, continue teaser-only lead alerts, write lifecycle event |
| `trialing` | Tenant converts before trial end | `trialing` until trial end, then `active` | Create Stripe Checkout in subscription mode, collect payment method, create subscription with `trial_end = tenant.trial_end`, write lifecycle event |
| `trial_expired` | Tenant converts and payment succeeds before shutdown date | `active` | Unlock app, keep preserved data accessible, cancel pending shutdown workflow, write lifecycle event |
| `trial_expired` | Post-trial access window reaches end unpaid | `deactivated` | Disable telephony, release Telnyx number, keep data soft-retained, show support reactivation message on login, write lifecycle event |
| `deactivated` | Admin reactivates with remaining trial days | `trialing` | Set new trial end from remaining days, provision new phone number, keep billing local until tenant enters card and converts, write lifecycle event |
| `active` | Stripe invoice payment fails and subscription transitions `past_due` | `past_due` | Start grace window if first failed-payment transition, keep service enabled during grace, notify tenant, write lifecycle event |
| `past_due` | Payment succeeds before grace end | `active` | Clear grace end, keep service enabled, write lifecycle event |
| `past_due` or `unpaid` | Grace window expires unpaid | `unpaid` | Restrict service per policy, keep billing warning visible, write lifecycle event |
| `active` | Tenant requests cancel at period end | `active` until end date, then `canceled` | Set `cancel_at_period_end`, show effective end date, allow reactivation before end, write lifecycle event |
| `active` | Tenant requests immediate cancellation | `canceled` | Cancel immediately after confirmation, update service by policy, write lifecycle event |
| `canceled` | Tenant reactivates before effective end date | `active` | Remove scheduled cancellation in Stripe, restore normal billing path, write lifecycle event |

## 11. Security & Compliance
- Never store raw card PAN/CVC in EveryCall.
- Store only Stripe IDs and minimal invoice metadata needed for UI.
- Enforce RBAC on all billing endpoints.
- Log all privilege and billing state changes.
- Require CSRF protection/session validation for portal and cancellation actions.

## 12. Notifications
- Email:
  - Payment failed.
  - Trial ending soon.
  - Cancellation scheduled.
  - Cancellation effective.
- Trial reminder cadence is required in MVP:
  - `trial_end - 5 days`
  - `trial_end - 2 days`
  - `trial_end` (final day)
- Post-trial without payment:
  - Continue sending new-lead alert notifications on all active notification methods
  - Format: `New lead: <5-7 word description with no contact info>. Activate billing to access it.`
- 5 days before post-trial shutdown:
  - Send warning on all active notification methods that EveryCall will disconnect the tenant phone number in 5 days if billing is not activated
- Admin reporting is required for upcoming trial expirations and shutdowns, including whether tenant phone and email channels are functioning or non-functioning.
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
1. Tenant can start a 30-day trial with no credit card required.
2. Tenant app shows a top-right trial badge with remaining days until paid activation.
3. Trial reminder emails are sent 5 days before, 2 days before, and on the final day of trial.
4. When trial expires without paid subscription, calls and lead capture continue for 30 additional days, but tenant app is billing-locked to billing/help/logout only and lead access is blocked.
5. Five days before the post-trial access window ends, the tenant receives shutdown warnings on all active notification methods.
6. When the 30-day post-trial window ends without payment, telephony is disabled for that tenant, the purchased phone number is disconnected, the account is deactivated, and retained data remains soft-stored.
7. A deactivated tenant who attempts login sees: `Please email support@everycall.io to reactivate your account.`
8. Tenant owner can subscribe via Stripe Checkout and become `active` after successful payment.
9. Tenant owner can access portal, update payment method, and see updated status in app.
10. Cancellation at period end and immediate cancellation both work as designed with confirmation safeguards.
11. Reactivation works when subscription has not yet fully ended.
12. Stripe webhooks are signature-verified, idempotent, and persist processing outcomes.
13. Admin can view tenant billing state, webhook health, and contact-channel health for upcoming trial/shutdown notifications.
14. Super-admin can apply or clear a tenant-specific monthly amount override, including cycles-until-revert, through an audited flow.
15. All billing-changing actions generate audit entries.
16. No card data is stored in EveryCall databases or logs.
