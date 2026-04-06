# Spec: Call-Based Billing With Included Usage And Overage

## 1. Purpose
Replace the current lead-based billing estimate model with a call-based billing model:
- each pricing tier includes a fixed number of calls per billing period
- calls over the included allowance are billed as overages
- the base monthly subscription remains in Stripe
- overages are auditable, frozen per period, and invoiced as a simple Stripe invoice item

This spec is intentionally aligned to the current EveryCall billing implementation:
- billing periods already center on Stripe subscription periods when available
- Stripe currently owns the recurring base subscription
- EveryCall already maintains tenant-level pricing and billing state server-side

This spec does **not** introduce real-time Stripe metered billing.

## 2. Core Decisions
### 2.1 Billing model
Each pricing tier has:
- `monthlyAmountCents`
- `includedCallCount`
- `callOverageRateCents`

### 2.2 Billable call definition
For v1, a call counts toward usage when:
- the receptionist actually answered and handled the call

For v1, a call does **not** count toward usage when:
- it was never answered
- it was a technical failure
- it was a very short abandon / immediate hangup
- it was an internal test call
- it was manually excluded by ops

Recommended v1 product rule:
- spam and wrong-number calls still count if the receptionist answered and handled them

Reason:
- they still consume system capacity
- the rule is simple to explain and defend

### 2.3 Separation of concerns
The system must separate:
1. **Call classification**
   - why this call is billable or non-billable
2. **Billing period assignment**
   - whether that eligible call landed inside included usage or overage for the period

This prevents invoice drift and keeps disputes explainable.

### 2.4 Period source of truth
Use the tenant’s actual billing period boundaries:
- if the tenant has a Stripe subscription, use Stripe current period start/end
- otherwise, use a locally created internal period for trial / unpaid tracking

Do **not** use tenant-local midnight as the billing boundary.

### 2.5 Pricing changes
Pricing changes apply to the **next** billing period by default.

Reason:
- avoids re-rating past calls
- avoids mid-period invoice confusion
- keeps support explanations simple

### 2.6 Stripe strategy
Keep the current Stripe monthly subscription for the base plan.

At billing-period close:
- calculate overage calls
- if overage exists, create a single Stripe invoice item for that period

Do **not** implement Stripe metered usage in v1.

## 3. Current Code Impact
The current system is lead-oriented in these places:
- plan pricing in [billing.js](/home/jonle/everycall/pages/api/_lib/billing.js)
- invoice estimate logic in [leadBilling.js](/home/jonle/everycall/lib/leadBilling.js)
- tenant billing summary in [index.js](/home/jonle/everycall/pages/api/v1/billing/index.js)
- dashboard billing summary in [dashboard.js](/home/jonle/everycall/pages/api/v1/client/dashboard.js)
- client billing UI in [page.jsx](/home/jonle/everycall/app/client/account/billing/page.jsx)
- admin system pricing defaults in [page.jsx](/home/jonle/everycall/app/admin/system/page.jsx)
- admin tenant pricing editor in [page.jsx](/home/jonle/everycall/app/admin/tenants/[tenantKey]/page.jsx)

This feature replaces the billing meaning of:
- `leadRateCents`
- `includedCount`
- `billableLeadCount`
- `leadChargesCents`

with call-based counterparts.

## 4. Data Model
### 4.1 `billing_call_types`
Static lookup table describing how a call should be treated for billing.

Columns:
- `billing_call_type_id` PK
- `code` unique
- `label`
- `short_description`
- `long_description`
- `counts_toward_usage` boolean
- `display_order` integer
- `is_system` boolean default true
- `active` boolean default true
- `created_at`
- `updated_at`

Seed rows for v1:
- `answered_handled`
- `short_abandon`
- `never_answered`
- `technical_failure`
- `test_call`
- `manual_exclusion`

Suggested seed semantics:
- `answered_handled` => `counts_toward_usage=true`
- all others => `counts_toward_usage=false`

### 4.2 `calls` additions
Add:
- `billing_call_type_id` FK nullable
- `billing_evaluated_at` TIMESTAMPTZ nullable
- `billing_notes_json` JSONB nullable

Purpose:
- persist immutable per-call billing classification
- keep the call record auditable even if rating rules evolve later

### 4.3 `billing_periods`
One row per tenant per billing cycle.

Columns:
- `billing_period_id` PK
- `tenant_key`
- `period_start`
- `period_end`
- `status` (`open`, `finalized`, `invoiced`, `credited`)
- `source` (`stripe`, `internal`)
- `billing_rule_version`
- pricing snapshot:
  - `plan_code`
  - `monthly_amount_cents`
  - `included_call_count`
  - `call_overage_rate_cents`
- summary snapshot:
  - `eligible_call_count`
  - `included_call_count_used`
  - `overage_call_count`
  - `overage_amount_cents`
- Stripe linkage:
  - `stripe_subscription_id`
  - `stripe_invoice_id`
  - `stripe_invoice_item_id`
- `finalized_at`
- `invoiced_at`
- `created_at`
- `updated_at`

Constraints:
- unique tenant + period_start + period_end

### 4.4 `billing_period_call_assignments`
Source of truth for whether an eligible call consumed included usage or became overage.

Columns:
- `billing_period_call_assignment_id` PK
- `billing_period_id` FK
- `call_sid` FK
- `billing_call_type_id` FK
- `charge_bucket` (`excluded`, `included`, `overage`)
- `sequence_number` integer nullable
- `assigned_at`

Constraints:
- unique (`billing_period_id`, `call_sid`)

### 4.5 `billing_period_adjustments`
Separate table for credits / debits that are not intrinsic call classification.

Columns:
- `billing_period_adjustment_id` PK
- `billing_period_id` FK
- `adjustment_type` (`credit`, `debit`)
- `reason_code`
- `description`
- `amount_cents`
- `metadata_json`
- `created_by_type`
- `created_by_id`
- `created_at`

Reason:
- do not overload call types with financial corrections

## 5. Pricing Model Changes
### 5.1 Replace lead pricing fields
Replace logical pricing meaning from:
- `leadRateCents`
- `includedCount`

to:
- `callOverageRateCents`
- `includedCallCount`

Monthly base pricing remains:
- `monthlyAmountCents`

### 5.2 Billing config object
Current `billing_plans_json` should evolve to:
- `code`
- `label`
- `monthlyAmountCents`
- `includedCallCount`
- `callOverageRateCents`

Tenant custom pricing should support overrides for:
- `monthlyAmountCents`
- `includedCallCount`
- `callOverageRateCents`

### 5.3 Existing fields
For rollout simplicity, existing DB columns may be repurposed temporarily:
- `lead_rate_cents` -> call overage rate
- `included_lead_count` -> included call count
- `lead_rate_override_cents` -> call overage rate override

But code and UI naming must switch to call terminology.

Longer-term, dedicated call-named columns are cleaner.

## 6. Rating Logic
### 6.1 Call classification
After each call completes, classify it into one `billing_call_type_id`.

Recommended classifier inputs:
- call status
- answer/completion timestamps
- duration
- telephony failure indicators
- explicit internal/test flags if present later

Persist:
- `calls.billing_call_type_id`
- `calls.billing_evaluated_at`
- optional `billing_notes_json`

### 6.2 Eligibility
A call is usage-eligible only when:
- its `billing_call_type` has `counts_toward_usage=true`

### 6.3 Assignment into included vs overage
Assignment occurs against a specific billing period.

For each open or closing period:
1. gather all eligible calls whose start time falls inside the period
2. sort chronologically by call start time, then `call_sid` for tie-break
3. first `included_call_count` eligible calls => `included`
4. remaining eligible calls => `overage`

### 6.4 Period-close rule
Calls are assigned to the period in which they **started**.

This handles edge cases like long calls spanning a boundary.

### 6.5 Rule versioning
Persist `billing_rule_version` on `billing_periods`.

Reason:
- future changes to the billable-call definition must not retroactively reinterpret old periods

## 7. Concurrency And Idempotency
### 7.1 Assignment workflow
Use a worker/background job to finalize open periods or re-rate periods when needed.

### 7.2 Locking
When finalizing a billing period:
- lock the target `billing_periods` row with `SELECT ... FOR UPDATE`
- delete/rebuild assignments inside one transaction, or use deterministic upserts

### 7.3 Idempotency
The worker must be safe to rerun:
- unique (`billing_period_id`, `call_sid`) on assignments
- finalization should be deterministic from the underlying call set and pricing snapshot

## 8. Stripe Flow
### 8.1 Base plan
Keep the existing Stripe recurring monthly subscription for the base plan.

### 8.2 Overage billing
At period close:
- compute `overage_call_count`
- compute `overage_amount_cents`
- if zero, do nothing
- if greater than zero, create one Stripe invoice item linked to the tenant customer/subscription

Suggested invoice description:
- `27 call overages × $2.50 = $67.50 (included limit: 100)`

### 8.3 Timing
Preferred flow:
- finalize the period first
- then create the Stripe invoice item once
- persist Stripe invoice item / invoice IDs back to `billing_periods`

### 8.4 Trial behavior
During trial:
- still classify calls
- still track internal periods and usage
- do not create Stripe overage invoice items

## 9. API Changes
### 9.1 Billing summary APIs
Update:
- [index.js](/home/jonle/everycall/pages/api/v1/billing/index.js)
- [dashboard.js](/home/jonle/everycall/pages/api/v1/client/dashboard.js)
- [billing.js](/home/jonle/everycall/pages/api/v1/admin/tenants/[tenantKey]/billing.js)

Replace lead-oriented response sections with:
- `callPricing`
- `callUsage`
- `invoiceEstimate`

Suggested fields:
- `includedCallCount`
- `eligibleCallCount`
- `includedCallCountUsed`
- `overageCallCount`
- `callOverageRateCents`
- `overageAmountCents`
- `totalEstimatedInvoiceCents`

### 9.2 Admin pricing save API
Update the admin tenant pricing path to save:
- base monthly amount
- included call count
- call overage rate

### 9.3 Future admin period detail API
Add a period drill-down endpoint later:
- list period assignments
- show why each call counted or did not count
- show credits/debits

## 10. UI Changes
### 10.1 Admin system pricing defaults
Update [page.jsx](/home/jonle/everycall/app/admin/system/page.jsx):
- 3 tiers remain
- fields become:
  - monthly amount
  - included calls
  - overage per call

### 10.2 Admin tenant pricing
Update [page.jsx](/home/jonle/everycall/app/admin/tenants/[tenantKey]/page.jsx):
- tier selector
- custom monthly amount
- custom included calls
- custom overage rate
- `Custom` badge/display state when overridden

### 10.3 Client billing page
Update [page.jsx](/home/jonle/everycall/app/client/account/billing/page.jsx):
- remove lead wording
- show:
  - base subscription
  - included calls
  - calls used
  - overage calls
  - overage rate
  - current estimated invoice

### 10.4 Dashboard billing summary
If billing summary remains visible on the dashboard, update it to use call billing terminology and values.

## 11. Migration Strategy
### 11.1 No historical rebilling
Do not backfill historical invoices into the new model.

### 11.2 Clean cutover
At rollout:
1. add new schema
2. seed `billing_call_types`
3. preserve existing lead-billing data for historical reference only
4. create current `billing_periods` for active tenants
5. classify calls only from the cutover point forward, or optionally for the current open period

### 11.3 Existing billing config
Existing pricing config can be migrated mechanically:
- `leadRateCents` becomes `callOverageRateCents`
- `includedCount` becomes `includedCallCount`

The numbers will need product review before go-live.

## 12. Monitoring And Operations
### 12.1 Alerts
Add a simple daily audit job for:
- open periods with unusually high overage
- periods finalized but not invoiced
- Stripe invoice-item creation failures

### 12.2 Auditability
Support should be able to answer:
- why did this call count?
- why was this call included vs overage?
- what pricing snapshot applied?
- what Stripe invoice item was created for this period?

The schema above is designed for exactly that.

## 13. Testing Requirements
### 13.1 Unit tests
Focus first on rating logic:
- period boundary behavior
- included allowance exhaustion
- zero included calls
- custom pricing snapshot
- excluded call types
- deterministic chronological assignment

### 13.2 Integration tests
Required:
- finalize period -> create Stripe invoice item
- rerun finalization -> no duplicate assignment rows
- rerun Stripe invoice-item flow -> no duplicate invoice items

### 13.3 UI tests
Verify:
- admin system pricing save
- admin tenant custom pricing save
- client billing summary wording/values

## 14. Implementation Order
1. Add schema:
   - `billing_call_types`
   - `billing_periods`
   - `billing_period_call_assignments`
   - `billing_period_adjustments`
   - call-level billing columns
2. Seed billing call types
3. Build call classification helper and persist `billing_call_type_id`
4. Replace pricing config and estimate helpers from leads to calls
5. Build billing period creation/finalization logic
6. Build Stripe overage invoice-item creation
7. Update admin pricing UI
8. Update client billing/dashboard UI
9. Roll out cutover and monitor

## 15. Open Decisions
These should be confirmed before implementation starts:
- exact threshold for `short_abandon` (recommended: `< 10 seconds`)
- whether spam/wrong-number answered calls count toward usage (recommended: yes)
- whether trial-period call usage is shown in the client UI before conversion (recommended: yes, clearly labeled as not yet invoiced)
- whether current lead-billing fields are repurposed or replaced with call-named columns immediately

## 16. Recommendation
Proceed with this as the implementation direction.

It preserves the current Stripe subscription approach, fits the current EveryCall billing architecture, and gives a clean audit model without introducing Stripe metering complexity.
