# Spec: EveryCall-Owned Coupons And Free Trials

## Status
- Proposed
- Owner: Platform
- Last Updated: 2026-04-06

## Scope
Define a coupon and free-trial system owned by EveryCall rather than exposed directly through Stripe Checkout.

This spec covers:
- one-time global-use coupon codes
- plan-scoped coupon eligibility
- separate discount percentages for:
  - base monthly subscription
  - call overage charges
- optional coupon-based free trial days with no card required during the trial
- coupon redemption and expiration behavior
- how EveryCall and Stripe should interact

This spec is intentionally aligned to the current billing implementation:
- base subscriptions are billed through Stripe
- overages are calculated inside EveryCall and added as Stripe invoice items
- billing periods already center on Stripe periods when available
- EveryCall already has tenant-specific billing state and plan overrides

## Goals
- Let admins create one-time coupon codes from the EveryCall admin UI.
- Let a coupon apply to one or more standard EveryCall plans.
- Let a coupon independently discount:
  - the recurring monthly subscription
  - call overage charges
- Let a coupon optionally grant a no-card free trial for a configurable number of days.
- Ensure a coupon can be redeemed by only one tenant total.
- Keep coupon entry and validation inside EveryCall, not inside Stripe-hosted Checkout.
- Keep overage discount logic inside EveryCall.
- Keep billing behavior auditable and deterministic.

## Non-Goals
- No customer-facing Stripe promotion-code field.
- No dependency on Stripe-native promo codes as the source of truth.
- No support for arbitrary stackable coupons in v1.
- No support for multiple active coupons per tenant in v1.
- No support for coupon scoping to arbitrary Stripe product IDs in v1.
- No generic public coupon management UI for customers beyond redeeming a code in EveryCall.

## Product Model

### Coupon
A coupon is an EveryCall-owned billing object with:
- a code
- plan eligibility
- a monthly subscription discount percentage
- an overage discount percentage
- a free-trial duration in days
- a discount duration in days
- one-time global redemption behavior

### Redemption
When a tenant redeems a coupon successfully:
- the coupon becomes unavailable to any other tenant
- the coupon terms are snapshotted onto a tenant-specific redemption record
- the redemption drives:
  - trial behavior
  - monthly discount behavior
  - overage discount behavior

### Trial vs Discount Window
If a coupon includes both:
- `freeTrialDays`
- `discountDurationDays`

then they should be treated as separate windows:
- free-trial window starts at redemption
- discount window starts when paid billing begins

Reason:
- customers should not lose discount time while still in a free trial

## Core Decisions

### 1. EveryCall owns coupon logic
Stripe should not be the source of truth for coupon redemption.

Reason:
- EveryCall needs plan scoping
- EveryCall needs overage discounts
- EveryCall needs single-use-across-the-system enforcement
- EveryCall needs free-trial logic not limited to Stripe’s native duration rules

Stripe may still be used as a billing execution layer for the base monthly discount after EveryCall has validated a coupon.

### 2. Hide coupon entry from Stripe Checkout
Customers should not type a coupon into Stripe Checkout.

Instead:
- the user enters the code inside EveryCall
- EveryCall validates and redeems it
- Stripe Checkout is created without `allow_promotion_codes`

Reason:
- keeps one source of truth
- avoids Stripe-side promo-code behavior bypassing EveryCall rules

### 3. One active coupon redemption per tenant
For v1:
- a tenant may have at most one active coupon redemption at a time

Reason:
- simplifies pricing math
- simplifies support and invoicing
- avoids stacked-discount edge cases

### 4. Coupons apply to EveryCall plans, not arbitrary Stripe products
For v1, a coupon should be scoped by EveryCall plan code:
- `starter`
- `growth`
- `pro`
- optionally `custom` later if needed

Reason:
- cleaner alignment with EveryCall’s billing model
- avoids tightly coupling admin coupon setup to Stripe object IDs

### 5. Free trial does not require a card
If a coupon grants `freeTrialDays > 0`:
- the tenant can enter trial without entering a payment method
- the tenant remains in an EveryCall-managed trial state until the trial ends

Reason:
- matches the product requirement directly
- avoids forcing a card during “free trial”

### 6. Trial and discount duration use days
EveryCall should support:
- `freeTrialDays`
- `discountDurationDays`

Stripe-native coupon duration should not be treated as the source of truth for these windows.

Reason:
- Stripe repeating durations are month-based
- the product requirement is day-based

## Current System Constraints

### Stripe today
Current checkout in:
- [checkout.js](/home/jonle/everycall/pages/api/v1/billing/checkout.js)
- [stripe.js](/home/jonle/everycall/pages/api/_lib/stripe.js)

uses:
- standard tier Stripe price IDs when configured
- inline price creation for custom monthly pricing

Current Checkout does **not** expose a promo-code box because:
- no app-side coupon field exists
- `allow_promotion_codes` is not set

### Billing today
Current call-based billing already separates:
- monthly subscription billing in Stripe
- overage charges in EveryCall + Stripe invoice items

That means:
- monthly coupon discounts can be mirrored into Stripe behavior
- overage coupon discounts must stay inside EveryCall billing logic

## Data Model

### `billing_coupons`
Master admin-defined coupon records.

Fields:
- `billing_coupon_id` PK
- `code` TEXT unique, case-insensitive in app logic
- `status` TEXT
  - `active`
  - `disabled`
  - `redeemed`
  - `expired`
- `monthly_discount_percent` NUMERIC(5,2) NOT NULL DEFAULT 0
- `overage_discount_percent` NUMERIC(5,2) NOT NULL DEFAULT 0
- `discount_duration_days` INTEGER NOT NULL DEFAULT 0
- `free_trial_days` INTEGER NOT NULL DEFAULT 0
- `single_use_global` BOOLEAN NOT NULL DEFAULT TRUE
- `max_redemptions` INTEGER NOT NULL DEFAULT 1
- `redeem_by` TIMESTAMPTZ NULL
- `notes` TEXT NULL
- `created_by_admin_user_id` BIGINT NULL
- `created_at`
- `updated_at`

Rules:
- `0` duration means unlimited
- `monthly_discount_percent` and `overage_discount_percent` must be between `0` and `100`
- `free_trial_days` and `discount_duration_days` must be `>= 0`

### `billing_coupon_plan_scopes`
Defines which EveryCall plans the coupon applies to.

Fields:
- `billing_coupon_plan_scope_id` PK
- `billing_coupon_id` FK
- `plan_code` TEXT
- `created_at`

Constraint:
- unique (`billing_coupon_id`, `plan_code`)

### `billing_coupon_redemptions`
Tenant-specific snapshot of the coupon at redemption time.

Fields:
- `billing_coupon_redemption_id` PK
- `billing_coupon_id` FK
- `tenant_key`
- `status` TEXT
  - `active`
  - `expired`
  - `revoked`
  - `consumed`
- `redeemed_at`
- `trial_starts_at`
- `trial_ends_at` NULL when `free_trial_days = 0`
- `discount_starts_at` NULL until paid billing begins
- `discount_ends_at` NULL when `discount_duration_days = 0`
- `snapshot_plan_code`
- `snapshot_monthly_discount_percent`
- `snapshot_overage_discount_percent`
- `snapshot_discount_duration_days`
- `snapshot_free_trial_days`
- `stripe_discount_id` NULL
- `stripe_coupon_id` NULL
- `metadata_json` JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at`
- `updated_at`

Constraints:
- unique active redemption per tenant
- global redemption uniqueness enforced when coupon is single-use

Purpose:
- freeze coupon terms for auditability
- prevent later coupon edits from changing existing redemptions

### `tenant_billing_accounts` additions
Add nullable references:
- `active_coupon_redemption_id`
- `coupon_trial_ends_at`
- `coupon_discount_starts_at`
- `coupon_discount_ends_at`

Purpose:
- make current active discount/trial state cheap to read

## Redemption Rules

### Eligibility checks
When a user enters a coupon code, the system must validate:
- coupon exists
- coupon is `active`
- coupon has not expired by `redeem_by`
- tenant has no conflicting active coupon redemption
- tenant’s selected or effective plan is in scope
- coupon has not already been redeemed when `single_use_global = true`

### Concurrency
Coupon redemption must happen in a transaction with row-level locking on the coupon row.

Reason:
- prevent two tenants redeeming the same one-time coupon simultaneously

### Redemption outcomes
If valid:
- create redemption row
- mark coupon unavailable to everyone else
- snapshot coupon terms
- attach redemption to the tenant billing account
- if `free_trial_days > 0`, set trial state immediately
- if `free_trial_days = 0`, allow the coupon to affect checkout immediately

## Trial Behavior

### Coupon-based free trial
If `freeTrialDays > 0`:
- tenant enters an EveryCall-managed free trial
- card is not required during the trial
- service remains active during the trial

Recommended state transitions:
- `billing_status = trialing`
- `app_access_status = active`
- `service_access_status = active`
- `trial_end = redeemed_at + freeTrialDays`

### Stripe during trial
Recommended v1 approach:
- do **not** create the Stripe subscription at redemption time
- create the Stripe subscription only when:
  - customer starts paid billing
  - or support/admin activates billing explicitly

Reason:
- keeps no-card trial simple
- avoids half-configured Stripe subscriptions without payment methods
- uses the billing lifecycle system that already exists in EveryCall

### Trial end
When trial ends:
- if no payment method / no Stripe subscription exists, tenant must complete checkout to continue paid service
- if checkout is completed later, discount duration begins at the time paid billing begins

## Discount Timing Rules

### Trial window
- starts at `redeemed_at`
- ends at `trial_ends_at`

### Discount window
- starts when paid billing starts, not when coupon is redeemed
- ends:
  - `NULL` if `discount_duration_days = 0`
  - otherwise `discount_starts_at + discount_duration_days`

This rule should be explicitly visible in admin and billing UI.

## Monthly Subscription Discount

### Source of truth
EveryCall redemption state determines whether the tenant currently has a valid monthly discount.

### Stripe execution strategy
Recommended v1:
- apply the monthly discount programmatically when creating paid billing
- Stripe should not expose customer-entered promo-code UI

Two implementation options:

1. Create a Stripe-side discount object when the paid subscription starts
- likely via a programmatically created Stripe coupon or discount
- cleaner customer invoice for base monthly subscription

2. Replace the standard price with a custom discounted monthly amount
- simpler if the discount is effectively permanent or unlimited
- less expressive for time-limited discount windows

Recommended direction:
- if discount is time-bound, prefer a Stripe discount/coupon object created by EveryCall
- if discount is unlimited and tenant-specific, a custom discounted recurring amount is also acceptable

### Expiration
When discount duration ends:
- EveryCall should stop treating the redemption as active for monthly discounts
- if Stripe has an attached discount that outlives the intended window, EveryCall must remove or replace it

This requires background synchronization logic.

## Overage Discount

### Source of truth
Overage discount is always calculated inside EveryCall billing logic.

### Application
At billing-period close:
- calculate raw overage calls and raw overage amount
- if tenant has active coupon redemption and current time is within the coupon discount window:
  - reduce overage amount by `snapshot_overage_discount_percent`
- create Stripe invoice item using the discounted overage amount

### Invoice text
Invoice item descriptions should make the discount visible.

Example:
- `EveryCall call overage: 27 calls × $2.50 = $67.50, discounted 50% = $33.75`

## Admin UX

### Admin system page
Add a `Coupons` section to:
- [page.jsx](/home/jonle/everycall/app/admin/system/page.jsx)

Fields:
- code
- status
- allowed plans
- monthly discount %
- overage discount %
- free trial days
- discount duration days
- redeem by optional
- notes

Views:
- active coupons
- redeemed coupons
- disabled / expired coupons

Columns to show:
- code
- plans
- monthly discount
- overage discount
- free trial
- duration
- redeemed by tenant
- redeemed at
- active / expired / revoked

### Tenant admin page
On:
- [page.jsx](/home/jonle/everycall/app/admin/tenants/[tenantKey]/page.jsx)

show:
- active coupon redemption
- trial end
- discount end
- admin ability to revoke coupon benefits if needed

V1 optional:
- admin manual apply/revoke may be phase 2 rather than phase 1

## Client UX

### Where the user enters the coupon
Coupon entry should happen in EveryCall before Stripe Checkout.

Recommended location:
- [page.jsx](/home/jonle/everycall/app/client/account/billing/page.jsx)

Behavior:
- coupon code input
- `Apply Code`
- immediate validation response
- show what the coupon does:
  - free trial days
  - monthly discount
  - overage discount
  - duration

### Stripe Checkout
Stripe Checkout should not show coupon entry.

Implementation rule:
- do **not** set `allow_promotion_codes` on Checkout Sessions

### Trial UX
If a coupon grants free trial:
- user can activate the account without entering a card
- billing page should clearly show:
  - `Trial active until ...`
  - `Discount starts when paid billing begins`

## API Changes

### Admin
Add coupon CRUD endpoints, for example:
- `GET /api/v1/admin/billing/coupons`
- `POST /api/v1/admin/billing/coupons`
- `PATCH /api/v1/admin/billing/coupons/[couponId]`
- `POST /api/v1/admin/billing/coupons/[couponId]/disable`

### Client
Add coupon redemption / preview endpoints, for example:
- `POST /api/v1/billing/coupons/redeem`
- `GET /api/v1/billing/coupons/active`

### Checkout
Update:
- [checkout.js](/home/jonle/everycall/pages/api/v1/billing/checkout.js)

to:
- consult tenant active coupon redemption before creating Checkout
- keep Stripe promo-code UI disabled
- apply the correct monthly billing behavior based on active coupon state

## Stripe Behavior Rules

### Do not rely on native Stripe duration as source of truth
Stripe coupon durations are month-based.

EveryCall coupon timing is day-based.

Therefore:
- EveryCall must own the authoritative trial/discount window timestamps
- Stripe artifacts, if created, are implementation details and must be kept in sync

### Standard plan compatibility
If the tenant is on a standard plan:
- coupon logic should still work with canonical Stripe price IDs

### Custom pricing compatibility
If the tenant is on custom pricing:
- coupon logic should still work
- monthly discounts may be applied against the custom monthly amount

## Audit And Reporting

Audit events to log:
- `billing.coupon.created`
- `billing.coupon.updated`
- `billing.coupon.disabled`
- `billing.coupon.redeemed`
- `billing.coupon.revoked`
- `billing.coupon.expired`
- `billing.coupon.monthly_discount_applied`
- `billing.coupon.overage_discount_applied`

Billing reporting should show:
- active coupon
- trial window
- discount window
- discounted monthly amount
- discounted overage amount per period

## Rollout Plan

### Phase 1
- coupon schema
- admin coupon CRUD
- client coupon entry on billing page
- one-time redemption with locking
- EveryCall-managed free trial without card
- overage discount application
- billing page visibility

### Phase 2
- monthly Stripe discount synchronization
- auto-expiry cleanup jobs
- admin manual apply/revoke
- richer historical coupon reporting

### Phase 3
- optional better Stripe-side alignment for existing subscriptions
- optional support tooling for coupon recovery and dispute handling

## Testing Requirements

### Unit tests
- coupon eligibility checks
- redemption locking logic
- plan-scope validation
- free-trial and discount window calculations
- overage discount application

### Integration tests
- redeem one-time coupon successfully
- second tenant cannot redeem same coupon
- coupon with free trial creates no-card trial state
- checkout created during active discount window does not expose Stripe promo field
- overage invoice item reflects discounted amount

### Manual test scenarios
- free-trial-only coupon
- discount-only coupon
- coupon with both trial and discount
- unlimited discount duration
- expired coupon
- wrong-plan coupon
- revoked coupon

## Recommended Defaults
- coupon codes should be case-insensitive
- one-time global-use should be default behavior
- `0` days means unlimited for:
  - free trial days
  - discount duration days
- discount duration starts when paid billing begins

## Open Questions
- Should admins be able to manually redeem a coupon on behalf of a tenant in phase 1 or phase 2?
- Should coupons ever be valid for `custom` plan tenants by default?
- Should a tenant be allowed to replace one active coupon with another, or must support/admin revoke the first one first?
- Should monthly discounts on already-active Stripe subscriptions be applied immediately or only on next billing period?
