# Spec: Account Management & Billing Implementation

## 1. Purpose
Implement the billing and account-lifecycle behavior defined in [account-management-billing.md](/home/jonle/everycall/docs/prd/account-management-billing.md) with concrete backend state, Stripe integration, scheduled jobs, middleware rules, and admin workflows.

This spec resolves the Stripe integration choice for:
- trial conversion before billing starts
- tenant-specific recurring amount overrides
- reactivation after deactivation

## 2. Stripe Recommendation
### 2.1 Recommended pattern
Use Stripe Checkout in `subscription` mode with:
- `payment_method_collection=always`
- `line_items[0][price_data]` for recurring monthly pricing
- `subscription_data.trial_end=<tenant trial end timestamp>` when the tenant converts before trial end

This gives EveryCall the desired behavior:
- no Stripe subscription at initial signup
- card collected at conversion
- Stripe subscription created immediately at conversion
- billing begins automatically when the existing trial ends

### 2.2 Why this pattern
- Stripe supports subscription creation with an explicit `trial_end` timestamp.
- Stripe Checkout supports recurring `price_data` inline for subscription mode.
- This keeps Stripe aligned with the real billing start date while avoiding clutter from many pre-created prices.

### 2.3 Stripe rules to implement
- Initial tenant signup:
  - no Stripe customer required
  - no Stripe subscription created
- Tenant converts before trial end:
  - create/reuse Stripe customer
  - create Checkout Session in `subscription` mode
  - send inline recurring `price_data`
  - set `subscription_data.trial_end = tenants.trial_end`
- Tenant converts after trial expired:
  - create/reuse Stripe customer
  - create Checkout Session in `subscription` mode
  - send inline recurring `price_data`
  - do not set a trial
- Admin reactivation:
  - no Stripe subscription created
  - tenant re-enters local trial state
  - tenant later converts through normal tenant-side checkout

## 3. State Model
### 3.1 Persisted tenant access fields
Store these independently:
- `billing_status`
- `service_access_status`
- `app_access_status`

They must not be collapsed into one field.

### 3.2 Billing statuses
- `trialing`
- `trial_expired`
- `active`
- `past_due`
- `unpaid`
- `canceled`
- `incomplete`
- `incomplete_expired`
- `deactivated`

### 3.3 Access statuses
- `service_access_status`
  - `enabled`
  - `restricted`
  - `disabled`
- `app_access_status`
  - `enabled`
  - `billing_locked`

## 4. Data Model
### 4.1 `tenants`
Add:
- `billing_status`
- `plan_code`
- `trial_started_at`
- `trial_end`
- `post_trial_access_ends_at`
- `billing_grace_ends_at`
- `service_access_status`
- `app_access_status`
- `deactivated_at`
- `billing_status_updated_at`
- `billing_lock_reason` nullable

### 4.2 `tenant_billing_accounts`
Add:
- `tenant_key` PK/FK
- `stripe_customer_id` unique nullable
- `stripe_subscription_id` unique nullable
- `stripe_product_id` nullable
- `stripe_price_id` nullable
- `monthly_amount_cents`
- `monthly_amount_override_cents` nullable
- `price_override_reason` nullable
- `price_override_cycles_remaining` nullable
- `current_period_start` nullable
- `current_period_end` nullable
- `cancel_at_period_end`
- `canceled_at` nullable
- `trial_end` nullable
- `last_invoice_id` nullable
- `updated_at`

### 4.3 `billing_events`
For Stripe webhook processing:
- `id`
- `tenant_key`
- `stripe_event_id` unique
- `event_type`
- `payload_json`
- `processed_at`
- `status`
- `error_message`

### 4.4 `billing_lifecycle_events`
For internal account/billing transitions:
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
- `created_by_type`
- `created_by_id` nullable
- `created_at`

### 4.5 `notification_channel_health`
Track tenant notification health:
- `tenant_key`
- `channel` (`email`/`sms`)
- `destination`
- `status` (`functioning`/`non_functioning`/`unknown`)
- `last_attempted_at`
- `last_succeeded_at` nullable
- `last_failed_at` nullable
- `last_error_code` nullable
- `last_error_message` nullable

Update on every attempted send.

## 5. Pricing Rules
### 5.1 Canonical amount source
EveryCall owns the recurring amount:
- default amount comes from plan configuration
- override amount comes from `tenant_billing_accounts.monthly_amount_override_cents`

### 5.2 Stripe request pattern
When creating Checkout Session:
- send recurring `price_data`
- use one stable product identity per plan family where practical
- set:
  - currency
  - recurring interval `month`
  - unit amount from effective amount

### 5.3 Override expiry
If `price_override_cycles_remaining` is:
- `null`: no override active
- `0`: override is indefinite
- `N > 0`: decrement once per successful billing cycle

When a successful invoice closes a cycle:
- decrement `N`
- if new value is `0`, revert future subscription pricing to default amount and clear override on the next cycle update

## 6. Trial and Post-Trial Jobs
Run a daily billing lifecycle job in system timezone.

### 6.1 Trial reminder job
For tenants in `trialing`:
- send reminders at:
  - `trial_end - 5 days`
  - `trial_end - 2 days`
  - `trial_end` final day
- use all active notification methods
- record send result in `notification_channel_health`

### 6.2 Trial expiry job
At midnight system time after the final trial day:
- if tenant has no active paid subscription:
  - set `billing_status='trial_expired'`
  - set `service_access_status='enabled'`
  - set `app_access_status='billing_locked'`
  - set `post_trial_access_ends_at = trial_end + interval '30 days'`
  - set `billing_lock_reason='trial_expired_unpaid'`
  - write `billing_lifecycle_events`

### 6.3 Post-trial shutdown warning job
At `post_trial_access_ends_at - 5 days`:
- send warning on all active notification methods
- content warns that the phone number will be disconnected in 5 days if billing is not activated
- record send result in `notification_channel_health`

### 6.4 Post-trial shutdown job
At `post_trial_access_ends_at`:
- if still unpaid and no active paid subscription:
  - release Telnyx number
  - clear tenant phone-number assignment fields
  - set `billing_status='deactivated'`
  - set `service_access_status='disabled'`
  - set `app_access_status='billing_locked'`
  - set `deactivated_at=now()`
  - set `billing_lock_reason='post_trial_shutdown'`
  - retain all leads/calls/transcripts as soft-retained
  - write `billing_lifecycle_events`

## 7. Web Access Locking
### 7.1 Tenant middleware rules
If tenant `app_access_status='billing_locked'`:
- allow:
  - billing routes
  - help/support routes
  - logout
- redirect all other tenant routes to billing page

If tenant `billing_status='deactivated'`:
- login succeeds
- tenant dashboard is replaced with:
  - `Please email support@everycall.io to reactivate your account.`

### 7.2 Data visibility
When tenant is `trial_expired` or `deactivated`:
- tenant cannot view leads, calls, transcripts, recordings, or summaries
- admins can still view data
- background retention remains intact

## 8. Telephony Behavior
### 8.1 Trialing
- full call handling
- full lead capture

### 8.2 Trial expired
- continue answering calls
- continue lead capture
- continue teaser-only lead alerts

### 8.3 Deactivated
- telephony disabled
- purchased number released from Telnyx
- no new inbound lead intake on old number

## 9. Notifications
### 9.1 Trial-expired teaser alert
Format:
- `New lead: <5-7 word description with no contact info>. Activate billing to access it.`

Do not include:
- caller phone
- caller email
- service address
- transcript

### 9.2 Channel health rules
`functioning` means:
- channel exists in tenant record
- latest provider send attempt succeeded

`non_functioning` means:
- no destination exists
- provider reports bounce/failure/invalid destination

Status is updated on every attempted send.

### 9.3 Admin reporting
Admin report must show:
- trials ending in next 7 days
- post-trial shutdowns in next 7 days
- email channel status
- SMS channel status
- last send error for each channel

## 10. Admin Workflows
### 10.1 Price override
Role:
- `super-admin` only

Inputs:
- override amount
- reason
- cycles until revert

Effects:
- store override on tenant billing account
- apply to future checkout/subscription update flows
- log to `audit_log`
- write `billing_lifecycle_events` or explicit override event metadata

### 10.2 Reactivate tenant
Roles:
- `admin`
- `super-admin`

Inputs:
- remaining free trial days

Effects:
- set tenant back to `trialing`
- compute new `trial_end`
- clear `deactivated_at`
- set `service_access_status='enabled'`
- set `app_access_status='enabled'`
- provision new Telnyx number
- do not create Stripe subscription
- write `audit_log`
- write `billing_lifecycle_events`

## 11. Tenant Billing APIs
### 11.1 `GET /api/v1/billing`
Return:
- billing status
- service/app access status
- plan code
- effective monthly amount
- override details if present
- trial end
- post-trial access end
- current period dates
- cancellation dates
- recent invoices

### 11.2 `POST /api/v1/billing/checkout`
Behavior:
- if `billing_status='trialing'` and now < `trial_end`:
  - create subscription-mode Checkout Session
  - `payment_method_collection=always`
  - inline recurring `price_data`
  - `subscription_data.trial_end = tenants.trial_end`
- otherwise:
  - create subscription-mode Checkout Session
  - `payment_method_collection=always`
  - inline recurring `price_data`
  - no trial

### 11.3 `POST /api/v1/billing/portal`
Create Stripe Billing Portal session for the tenant customer.

### 11.4 `POST /api/v1/billing/cancel`
Default:
- cancel at period end

Immediate cancel:
- only with typed confirmation

### 11.5 `POST /api/v1/billing/reactivate`
Tenant-side endpoint only for cancel-at-period-end subscriptions that are still restorable in Stripe.

Do not use this endpoint for `deactivated` trial accounts.

## 12. Admin APIs
### 12.1 `GET /api/v1/admin/tenants/:tenantKey/billing`
Return:
- tenant billing summary
- Stripe IDs
- lifecycle state
- override state
- channel health
- recent lifecycle events
- recent Stripe webhook outcomes

### 12.2 `POST /api/v1/admin/tenants/:tenantKey/billing/price-override`
Super-admin only.

Body:
- `monthly_amount_override_cents`
- `price_override_cycles_remaining`
- `reason`

### 12.3 `POST /api/v1/admin/tenants/:tenantKey/reactivate`
Admin or super-admin.

Body:
- `remaining_trial_days`

Effects:
- re-enable tenant
- provision new number
- start local trial

## 13. Stripe Webhook Processing
Process:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

Rules:
- Stripe is source of truth for subscription period and Stripe status
- local lifecycle state is derived and written transactionally
- each meaningful state transition writes `billing_lifecycle_events`

## 14. Recommended Implementation Order
1. Migrations for billing state, lifecycle logs, channel health, and override fields
2. Tenant middleware for billing-lock behavior
3. Trial/post-trial daily lifecycle job
4. Stripe Checkout creation using inline recurring `price_data`
5. Stripe webhook ingestion and state reconciliation
6. Admin billing read APIs
7. Super-admin override API
8. Admin reactivation API and Telnyx reprovisioning
9. Trial/shutdown notifications and channel health reporting
