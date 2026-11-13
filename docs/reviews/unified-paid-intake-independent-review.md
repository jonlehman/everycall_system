# Unified paid intake and billing — independent review

The opening review is historical. Current source closure and schema-only verification are recorded at the end; full canonical release remains held.

Review date: November 13, 2026 UTC. Independent Astra review of the uncommitted application changes based on `45a1a68` and website changes in `/tmp/everycall-website-upib` based on `05f212c`. Implementation continued during this review; the findings below identify the inspected behavior, not a final immutable release revision. **Not approved for release.**

Authority: [UPIB-001–014](../SPECS/unified-paid-intake-and-billing.md), the five core application documents, and the frozen knowledge subsystem safeguards. No production, provider, catalog, migration, charge, refund, deployment, or repository publication was performed by this reviewer. Unrelated CSV files were excluded.

## Scope and evidence

Inspected the application and website diffs, all new `paid*.js` helpers, support sessions, intake/billing APIs, webhook and gateway integration, migrations 0063/0064, scoped migration runner, relevant preexisting billing/Sales/auth/knowledge paths, frontend contracts, and the new tests. Core constraints remain payment/owner/consent before conversion; monthly usage separate from base terms; fixed grace; annual included-call admission before answering; immutable financial/source evidence; and explicit validated publication.

The independent native PostgreSQL fixture `/tmp/upib-independent-review.mjs` used a disposable schema and no real providers. It reproduced a renewal-call/plan-change race and historical schedule identity overwrite. During review the author fixed checked-out client handling; the fixture verified that subscription synchronization now preserves its caller's transaction and rolls back with it. This fixture is diagnostic evidence, not a committed regression or provider acceptance test.

The new HTTP test exercises the disabled release gate, anonymous access and retired onboarding. The browser test uses API doubles. Billing/intake fixtures use native PostgreSQL with provider doubles. These are useful local checks, but none demonstrates real Stripe collection, recurring consent, schedules, payment-method inheritance, test-clock anniversaries or webhook delivery.

## Finding log

Latest closure status after independent native fixtures (`/tmp/upib-independent-review-fixed.mjs` and `/tmp/upib-final-independent.mjs`): findings 2, 3, 4, 6, 10, 11 and 12 pass their targeted failure scenarios. Findings 7 and 9 have the trusted bound quote, explicit consent, server attribution and frontend invalidation/token gates in source; the final browser contract suite belongs to the parent QA evidence. Finding 8 has source-reviewed expiry/hash validation and rotation. Findings 1 and 5 have source corrections (original-anniversary subscription parameters and frozen explicit payment method), but remain provider acceptance gates. Finding 12 is closed by the source-reviewed durable phase claims, fair attempt rotation, bounded retry delays and explicit review states; the independent reproduction and all seven committed native fairness scenarios now pass. No identified source defect remains open in this reviewed working snapshot; this is not provider or deployment acceptance. The descriptions below retain the original failure scenarios for regression traceability.

1. **P1 — Original anniversary is lost in Stripe (UPIB-007/008/009).** Inspected `pages/api/_lib/paidPurchaseEvents.js:39–46` sets only `trial_end` to the included-month end; `paidIntake.js` creates the subscription with the same approach. A January 31 payment becomes a February 28/29 provider anchor, so March renewal falls on the 28th/29th while the application usage boundary remains March 31. This also makes the valid provider renewal fail the application's usage-boundary assertion for a plan change. Stripe documents that the trial end becomes the default billing-cycle anchor: [billing renewal dates](https://docs.stripe.com/billing/subscriptions/billing-cycle). Establish and persist the original calendar rule at the provider and verify January 31, leap years, annual renewal and every offered transition with sandbox test clocks. A proposed payment-mode Checkout plus durable subscription-establishment workflow received conditional design approval only: conversion must remain blocked until verified payment, explicit selected recurring terms and exactly one verified subscription all exist. Saving a card alone is not recurring-plan consent.

2. **P1 — First call at renewal can permanently block a scheduled plan change (UPIB-008/009).** Inspected `paidSubscriptionSync.js:27–37` rejects a new plan if the new window has an admitted/answered call. `reserve_paid_call` originally created that window using the old local plan before the asynchronous subscription event. The independent PostgreSQL fixture reproduced the rejection after one admission. Use the persisted authorized transition at the admission boundary or hold admission until canonical reconciliation; do not answer/rate under the old snapshot and then require manual repair. A new pending-transition admission fence appeared during review and requires a final transaction/concurrency regression, including delayed and out-of-order events.

3. **P1 — Historical schedule event can replace a restarted subscription (UPIB-004/012).** Inspected `billing.js:1060–1090` unconditionally copied a schedule's subscription/customer to the account. The webhook finds the tenant by customer when the old subscription no longer matches. A delayed released schedule for the canceled subscription therefore overwrote the new paid subscription identity. Independently reproduced in PostgreSQL. A paid-specific schedule handler appeared during review; verify stale schedule events cannot rebind identity or clear the current pending transition, including current/old customer and mode mismatches.

4. **P1 — Action-required invoices bypass grace and recovery notices (UPIB-010/011).** Inspected `paidBillingLifecycle.js:95–98` only treats `invoice.payment_failed` and `invoice.marked_uncollectible` as a new debt episode. An `invoice.payment_action_required` event for an open renewal with no previous debt is skipped; expired base coverage then causes immediate suspension with no five-day deadline or recovery notice. An annual overage requiring authentication remains absent from the debt/restriction ledger. Reconcile action-required amounts into the same fixed episode and test subsequent success and stale action-required delivery. Stripe defines these as distinct event types: [event reference](https://docs.stripe.com/api/events/retrieve).

5. **P1 — Standalone usage invoices have no established payment-method source (UPIB-008/010).** Inspected `paidUsageInvoices.js:29–30` creates a customer-only invoice without a subscription or explicit default payment method. A subscription's saved Checkout method is not automatically the default of a separate customer invoice. A valid signup card can therefore pay base renewal while monthly usage collection fails. Bind the owner-authorized method correctly and preserve later payment-method updates. Verify actual collection, not just invoice creation/finalization: [invoice creation/default payment method](https://docs.stripe.com/api/invoices/create). The proposed payment refactor may address this; it still needs a provider test.

6. **P1 — Accepted manual adjustments are omitted from paid invoices (UPIB-008/013; preserved billing behavior).** Inspected `callBilling.js:1094` continues after paid usage collection, bypassing `createAdjustmentInvoiceItemsForPeriod`. `paidUsageInvoices.js` snapshots only overage amount, while the existing admin adjustments endpoint accepts credits/debits and the paid estimate includes them. An approved credit appears in the estimate but the customer is charged full overages. Collect immutable adjustment lines with once-only receipts, or explicitly reject unsupported paid-account adjustment writes and remove the misleading estimate until supported. Never silently accept an ineffective money decision.

7. **P1 — Final Go amount disagrees with authorized special/reused purchases (UPIB-001/003/007).** Inspected intake UI originally hardcoded `$100 due now`; reference/status APIs omitted the trusted resolved amount. The server can actually charge a frozen $1 live-test reservation or use a verified historical payment with $0 setup due. Trusted quote display and explicit consent were subsequently added. **Remaining binding issue:** editing the website after verification does not refresh/invalidate that quote, while Go rematches the edited website and can resolve a different historical payment/amount. Refresh the server quote after identity edits and bind the reviewed identity, amount and terms to Go; reject stale quotes before provider effects. Cover $100/$1/$0 and edit-after-verification with a real frontend/API contract test.

8. **P2 — Expired Sales links cannot be renewed (UPIB-004).** Inspected `paidIntake.js:70–73` returns any stored intake URL before inspecting its server reference expiry/revocation. After fourteen days the recipient gets 410, while a rep resend returns the same expired URL. Securely reconcile and rotate expired unrevoked references under the checkout lock, preserving existing purchase authority. Revoked paid references require owner recovery, not regenerated prospect credentials.

9. **P2 — Cross-browser verification loses stored attribution (UPIB-001/002).** `createIntakeDraft` stores trusted Sales attribution, but `beginPaidCheckout` overwrites it from the request body. The UI's verification response handler restores form fields without restoring attribution; opening the email in a different browser submits an empty attribution object. Preserve server-owned attribution and merge only allowed values. Harmless return/query attribution changes must not make an otherwise valid reserved Checkout unusable through payload deep-equality checks.

10. **P1 — Multiple owners can reserve the same unconverted prospect (UPIB-002/004).** The inspected 0063 indexes uniquely bind setup to intake and non-null tenant, but not to prospect. Two distinct verified emails can match one prospect with no tenant and no historical Checkout, then both reserve/pay while both purchase tenant keys are null. Conversion independently creates two tenants and writes the same prospect's tenant pointer twice. Serialize the prospect claim and add durable one-live-setup-purchase-per-prospect uniqueness; reject conflicting owners before provider effects. Cover concurrent different-owner Go requests, not just multiple tabs using one intake. This finding was identified during the payment refactor and awaits its stable fix/test.

11. **P1 — Sales cleanup mistakes an empty provider response for an unsent action (UPIB-006).** `salesFollowupJobs.failJob` returns failed/timeout attempts to `queued`, clears the lease, and leaves `provider_result_json={}`. Consequently `cleanupPaidProspect`'s empty-result/unlocked/queued predicate can cancel a possibly accepted Smartlead write. Restrict definite unsent cancellation to never-attempted work. Fence attempted, leased and uncertain effects for explicit reconciliation; do not let the ordinary worker later overwrite uncertainty with a successful `prospect_suppressed` no-op. A worker can also hold a pre-conversion prospect snapshot across provider I/O, so the cleanup result must track unresolved in-flight effects rather than assert full cleanup. Preserve the paid account and immutable provider history. Required regression: provider accepts then times out, conversion cleanup runs, and neither duplicate outreach nor erased uncertainty is possible.

12. **P1 — Old abandoned or blocked purchases starve all newer recovery work (UPIB-004/005).** `paidPurchaseEvents.js:59` selects the oldest paid purchases lacking recurring consent with `LIMIT 10` on every run, including permanent expired-term or uncertain-effect failures; `paidPurchaseEvents.js:104` similarly repeatedly selects the oldest pending sessions. Ten such rows permanently prevent subsequent legitimate paid customers from establishing their subscription or reconciling a lost webhook. `paidProvisioning.js:81–83` repeats this pattern with immediately eligible failed rows and `LIMIT 2`, so two persistent build/number failures block later conversion/provisioning. The independent native fixture `/tmp/upib-independent-fairness.mjs` reproduced both purchase-recovery stages with a limit of one: repeated passes visited only the old expired row, while the newer paid row never received a subscription attempt. Implement fair durable scheduling/claiming, bounded backoff or explicit review states so blocked purchases retain evidence without monopolizing the queue; test later eligible work progressing through all three stages.

## Resolved during this review

- Checked-out transaction client: the original `syncPaidSubscription` called `.connect()` on the webhook's already-connected `pg.Client`. The current ownership check uses the caller's client without connecting, committing or releasing it. Independently verified with caller `BEGIN`, sync and `ROLLBACK`. Retain a committed webhook integration regression.
- Pending transition: independently verified refusal before admission while the authorized next-term selection awaits canonical reconciliation, then successful admission with the new plan after synchronization. This prevents the tested old-plan call from poisoning the new window.
- Historical schedule: independently verified a delayed live released schedule with the old subscription cannot change the account's current paid subscription identity.
- SCA: independently verified the first action-required base invoice creates the owed amount and the five-day deadline rather than immediate suspension.
- Unsupported paid adjustments: independently verified rejection creates no adjustment row. Historical uncollected adjustments block paid invoice collection for manual reconciliation; they are not silently discarded.
- Annual retention: the lifecycle author additionally found that old overage grace could otherwise backdate retention when annual prepaid service ended. Independently verified number retention now starts at the actual coverage expiry in that scenario, preserving the full 30-day hold.

- Bound purchase contract: independently verified that an edited identity or missing explicit recurring consent rejects before customer/Checkout creation. Reviewed frozen terms, canonical settled payment, explicit customer-bound payment method, immutable subscription parameters and conversion gating. The initial subscription invoice must be zero and its canonical first period end must match the paid calendar boundary before conversion.
- Prospect ownership: independently raced two verified owner emails for one prospect and observed one customer/Checkout; a direct duplicate from a distinct intake was rejected specifically by `paid_purchases_setup_prospect`.
- Provider uncertainty: independently verified cleanup leaves an already-attempted, empty-response followup row unchanged and ordinary processing does not replay it. Source additionally preserves terminal provider pause/opt-out actions after paid conversion, while canceling never-attempted outreach only.
- Frontend quote gate: source review confirms Go requires a quote token; every editable field invalidates the quote and consent, and verification directs the user to refresh the payment summary. Status polling does not overwrite edited quote state.

- Recovery fairness: independently reran the original starvation diagnostic as `/tmp/upib-independent-fairness-fixed.mjs`; both purchase stages now visit newer work. Independently executed `scripts/validate-paid-work-fairness.mjs`: all seven native cases pass for payment, subscription and provisioning progress, concurrent separate claims, crash rotation and stale completion fencing. Source review confirms claims are committed before I/O, payment truth and immutable request parameters survive manual-review transitions, and failed/abandoned work no longer monopolizes a batch. Native provider doubles establish local scheduling behavior only.
- Terminal Sales actions: independently executed `scripts/validate-paid-followup-cleanup.mjs`; both groups pass, including preserving unsubscribe/pause actions and fencing conversion between a worker claim and provider I/O.

## Historical remaining release acceptance

- Review the final immutable release revision and migration physical-contract fingerprints after the last changes; local source review is not evidence of deployment. Re-run bounded affected checks if this reviewed working snapshot changes.
- Run real isolated Stripe sandbox/test-clock journeys: six catalog prices; setup-only initial charge; explicit recurring consent; no-charge historical payment reuse; original calendar anniversaries; all 36 source/destination plan/interval combinations; cancellation/undo; monthly overage collection throughout initial month plus prepaid year; SCA/failure/recovery; full-period restart without setup/free month; and replay/unknown-effect recovery. Provider doubles cannot satisfy this acceptance.
- Complete explicit per-record cutover mapping for the reported two existing subscriptions, historical live/test Sales sessions, and existing tenants. The current narrative inventory is not the mapping or authorization for provider effects.
- Verify the EveryCall-specific portal configuration, webhook event coverage/signing secrets, live/sandbox isolation, coordinated schema/app/worker/gateway versions and actual canonical deployed revision. Keep `paid_intake_release.enabled` false until closure.
- Preserve existing knowledge review/publication/readiness, daily build allocations, raw captures and tenant corrections. The inspected paid build wrapper delegates to existing machinery and does not itself authorize publication; its real initial-build integration and readiness flow still need final acceptance.


## Final source and schema-only closure — November 13, 2026 UTC

The initial findings and acceptance list above are historical. Separate fresh-context
Astra reviews subsequently examined immutable financial source `97d344a`, the
preserved actual Stripe responses and source-contract comparison, followed by the
bounded migration-only diff `4294120`. No source finding remains open in those
reviewed revisions. This does not approve full canonical rollout without its
remaining owner/configuration/version gates.

Actual sandbox acceptance passed all 36 financial plan transitions, 39 annual-plan
monthly usage invoices, setup-only and no-charge recurring consent, full paid
restart, SCA/settlement, cancellation/undo and all four interval shapes for explicit
Portal card replacement. The provider record distinguishes the earlier financial
matrix from the two-field payment-method delta and targeted final combined proof.
Independent exact-source comparison passed 83 requests, including immutable usage
rating/payment-method branches. See [provider acceptance](unified-paid-intake-provider-acceptance.md).

The final actual canonical invoice regression corrected a provider-shape mismatch:
a full original-calendar renewal may carry a proration flag. The narrow recurring
exception requires a subscription-cycle reason, exactly one full configured line,
matching invoice total, USD, quantity, owned subscription/price and the original
whole window. The captured monthly response passes the actual billing-event and
delayed-binding paths; partial/short/foreign/update-reason/extra/negative/total
mismatches do not grant coverage. The annual adaptation is explicitly synthetic.

Additional independent native evidence covers pre-effect admission fencing after
accepted-response loss, paid-bridge rescheduling without duplicate billing,
unpaid-refusal cancellation access, preservation of concurrent receipts and later
owner card choices, and delayed FIRST binding from complete canonical paid history.
Unknown/unsupported histories enter visible manual review; transient provider
failures retain bounded retries. The 29-scenario intake suite and browser review
flow passed, including no second checkout and no unverified-payment claim. The
exact `97d344a` TypeScript/Next production build and built HTTP boundaries passed;
application bytes remain unchanged in `4294120`.

The schema-only retry received separate exact-source, wrapper, target, SQL,
inventory, production timing and readback approval. The first attempt fully rolled
back on its unchanged 10-second deadline. The reviewed batching preserved all
checks and permitted one retry, which committed in 6,466 ms. Independent readback
verified both receipts, physical contracts, pristine disabled gate, 13 empty
ledgers and unchanged protected financial/Sales history. The [release record](unified-paid-intake-release.md)
contains exact evidence hashes and canonical version observations.

Full canonical app/worker/website/provider activation remains blocked on the
explicit legacy-account decision and coordinated final deployment evidence. No
new live price activation, subscription disposition, portal/webhook/environment
change or customer test charge/refund was authorized by the schema-only approval.
