# Unified paid intake and billing

Status: Owner-approved product decisions, November 12, 2026; implementation and release pending. This document changes requirements only. It does not assert that application code, Stripe, databases, deployed services or customer accounts have been changed.

## Authority and scope

This is the current authority for signup, payment, subscription timing, usage periods, delinquency and reinstatement. It supersedes conflicting provisions in the intake and account-management PRDs; intake onboarding V2, basic intake/navigation, account-management billing implementation and call-based billing specifications; and Sales rep dialer v2. Their historical requirement IDs and text remain intact. Unrelated behavior and safeguards remain in force.

In particular, the former no-card 30-day trial, post-trial free service, seven-day grace, immediate customer cancellation, free/admin trial reactivation, separate Sales direct-payment signup, and subscription-period-sized annual call allowance are superseded. The separate **Activate Billing** section, its signup/activation routes and CTAs are retired; legitimate Billing, payment-method, invoices, cancellation and recovery controls remain. No production account may obtain service through a legacy entry point that bypasses these requirements.

The owner has withdrawn the proposed reinstatement proration: there is no prorated restart or automatic unused-term credit under this specification. Refund requests remain manual. The three questions about annual overage restrictions, reinstatement and appointment booking are resolved below.

## Approved product requirements

### UPIB-001 — One intake and an explicit plan

Website signup, pricing links, public-demo conversion, Sales signup links and assisted signup all enter the same intake. Preserve known owner, business, website, selected plan and attribution through that flow. Ask for a plan and monthly/annual interval if not already selected; show the final selection, $100 due now, first-month allowance, overage rate and later recurring price before **Go**. The main website, pricing and signup-offer surfaces must also disclose that the $100 includes the selected plan's normal first-month call allowance and that additional billable calls incur the displayed overage rate, billed monthly. These disclosures must agree with intake and Checkout; they cannot appear only at final Go. The website remains editable. Free public browser demos remain available without purchase.

Customer self-service setup appointment booking requires verified payment. A Sales rep may arrange an appointment with a prospect before payment through the Sales workflow. This exception does not bypass existing rep ownership, permission, consent, call-phase, phone-test or provider-booking checks and does not create a tenant or authorize service.

### UPIB-002 — Secure prefill and ownership

Sales links carry an opaque, scoped, expiring server-validated reference to the pending intake and its attribution, not trusted client-supplied payment or tenant authority. Re-match the normalized website after edits so that the flow can find existing prospect/demo work. A website match is a lookup hint, never proof of business ownership, tenant membership or purchase ownership. Before binding a purchase or converting/provisioning an existing tenant, verify the intended owner through the existing authenticated owner boundary or an appropriate owner-bound verification token. A rep's ability to send a link is not customer account authentication. Conflicting or ambiguous identity must not expose private data, merge tenants or charge a second setup fee automatically.

### UPIB-003 — Payment before the account

At **Go**, the server checks the purchase ledger. If there is no verified setup purchase, use Stripe-hosted Checkout to collect $100, payment details and consent to the selected recurring subscription, establishing that subscription as part of the purchase. If the intended owner's setup purchase is already verified, reuse it and complete any missing subscription consent/setup without collecting $100 again. Prior payment alone does not establish recurring consent. Intake drafts and pending checkouts are not tenant accounts.

No new production account, full website build, number provisioning or service starts before verified payment. A browser return, query parameter, rep disposition, Checkout creation or unsettled payment is not payment proof. Verify payment identity, amount/currency, mode and purchase/subscription association server-side using signed webhooks and trusted Stripe reconciliation. Initial payment failure grants neither entitlement nor grace.

### UPIB-004 — One purchase and one conversion

Persist the owner/prospect/intake, plan/interval, expected amount, Stripe mode, customer, Checkout, payment and subscription associations, plus separate payment and provisioning states. Use durable uniqueness and idempotency across concurrent Go requests, multiple tabs, webhook retries, worker retries and recovery. Reuse a valid open Checkout for the same purchase. Reconcile expired, canceled or uncertain sessions before replacing them; stale links must offer secure recovery without duplicate charges or subscriptions.

After verified payment, automatically create one tenant or convert the existing correctly bound provisional/demo tenant in place. Do not create a second tenant because conversion or knowledge work is still pending. Reconcile legacy paid Sales purchases with their frozen amount and payment evidence; do not assume every historical successful payment was $100. Finish owner access, defaults, build initiation and number provisioning through recoverable jobs. A failed job preserves the purchase and resumes the same conversion. Paid owners can see setup progress and billing while production voice waits for readiness.

### UPIB-005 — Paid build initiation and preserved knowledge gates

Verified payment and confirmed intake authorize automatic initial full-build initiation and provisioning. This is a narrow continuation of the approved paid Sales conversion decision, extended to all signup sources; it supersedes manual-only initiation solely for this initial paid build. It does not authorize automatic publication or periodic rebuilds. Frozen REQ-PIPE-003 ("Website rebuilds are manual only.") remains in force for later rebuilds; the initial paid-build exception clarifies the broader manual-initiation wording in document 06 without changing that requirement's text. REQ-PIPE-004 ("Rebuild frequency is limited to one per tenant per day.") and the existing allocation controls remain in force. Preserve daily allocation/lease/idempotency controls, original raw source capture separately from budgeted AI evidence, source authority, tenant-owned corrections and published-build immutability. Payment or a successful crawl alone never grants production voice.

Production voice requires the existing validated knowledge publication and readiness checks, carrier-ready number and required tenant setup. The frozen [knowledge subsystem](../architecture/knowledge-receptionist-subsystem/v1.0/00-spec-index.md), especially documents 05, 06, 07, 10, 11 and 16, and explicit subsequent governance decisions remain authoritative. No frozen requirement ID or artifact schema is rewritten by this document.

### UPIB-006 — Sales conversion cleanup without destroying history

On successful conversion, archive/deactivate the prospect's obsolete demo resources, revoke legacy signup/demo credentials after their replacement/recovery path is established, remove fresh-prospect queue eligibility and cancel unsent sales-outreach work through its normal guarded transitions. If a provisional tenant is converted, retain it as the paid tenant rather than deleting it. Preserve immutable call/payment/recipient snapshots, source captures, attribution, audit history, suppression and required retention.

Do not delete provider delivery records, clear uncertainty fences or replay a possibly sent message to make cleanup succeed. Reconcile in-flight/uncertain provider effects first; token revocation cannot prevent reconciliation of an already completed payment. Explicit paid-customer support calls and agreed callbacks remain permitted under existing consent/DNC/ownership safeguards, without restarting prospect campaigns. Cleanup must be retryable and must not undo payment or disable the converted account.

### UPIB-007 — Prices and the included first month

All amounts are USD. Usage is measured in **calls**, not minutes. Existing billable-call classification remains governed by the [call-based billing specification](call-based-billing.md); the table does not change that classification.

| Plan | Monthly base | Annual base (15% off 12 monthly payments) | Included calls each month | Each additional billable call |
|---|---:|---:|---:|---:|
| Starter | $74.50 | $759.90 | 25 | $3.00 |
| Growth | $124.50 | $1,269.90 | 60 | $2.00 |
| Pro | $174.50 | $1,779.90 | 100 | $1.75 |

The initial $100 includes the first calendar month of the selected plan, with its full normal allowance and ordinary overage charges. That month starts on successful payment, not on build completion, number assignment, forwarding setup or the first call. It is one calendar month, not a fixed 30-day duration or an unpaid product trial. The first recurring monthly base charge is due at that month's end. For annual selection, the annual base charge is due at that month's end and prepays the following 12 months, with yearly renewal thereafter. Initial setup does not also collect the annual base charge. Disclose the normal included-call allowance, per-call overage rate and monthly overage billing on the main website, pricing/offer surfaces and intake as required by UPIB-001.

The previously approved $1 live test remains a deliberately labeled, isolated exception to the standard $100 setup amount; it is a real charge, not a sandbox transaction. Successful verified $1 live signup grants ordinary paid conversion and activation eligibility, subject to the same owner verification, recurring consent and production readiness gates as standard signup. Do not expose it as a public discount. Existing frozen reservations retain their actual verified amounts. The separately configured $100 sandbox checkout remains isolated and must never activate production service, mark real customers paid or create production subscriptions/builds.

### UPIB-008 — Separate monthly usage and base-renewal periods

Maintain independent base-subscription term boundaries and monthly usage windows. Every plan receives a fresh allowance on its payment-anniversary monthly boundary, including annual subscriptions. Use calendar-month anniversary handling consistent with the persisted provider schedule, including short months, and persist explicit start/end timestamps; retries, grace and card updates cannot move them. Tests must cover January 31 and leap-year transitions without drifting the original anniversary rule. No annual pooled quota and no carryover of unused monthly calls are introduced.

Close and freeze each monthly usage window, then invoice that month's overages once, including the initial included month and all 12 months of a prepaid annual term. Annual overages must not wait for the next annual base invoice. Use separate invoices or another verified monthly collection mechanism; never rely on an unattached invoice item being collected at annual renewal. Replay/reconciliation cannot bill a call or period twice. Plan and rate snapshots govern each window; never retroactively re-rate closed calls.

### UPIB-009 — Renewal changes, cancellation and billing management

Plan and interval changes take effect at the next base-subscription term boundary. For an annual prepaid term, that is its annual renewal, not the next monthly usage reset. Cancellation takes effect at the current paid-term end; service continues through that term, subject to the delinquency restrictions below. Canceling within the initial included month ends service at that month's end. Do not offer immediate self-service cancellation or automatically refund cancellation. Removing a scheduled cancellation before its effective end preserves the same term and number.

Keep owner-authorized Billing access, payment-method updates, invoices and cancellation/recovery available. Bind portal creation to the explicit EveryCall configuration; fail closed when it is absent or mismatched rather than using the Stripe account's unrelated default. Configure and verify next-term behavior for every offered plan/interval change, not only the subset the portal happens to schedule by default.

### UPIB-010 — Fixed five-day grace and full suspension

The first failed payable invoice starts a five-day grace deadline. Retrying that invoice, additional failed invoices during the same unresolved delinquency, changing a card or updating a subscription cannot restart the deadline. Persist the original failure and deadline, and reconcile out-of-order provider events against settled invoice state. Send an immediate payment-failure email containing the amount owed, a secure owner-scoped payment/recovery link and the fixed grace deadline. Reminder emails must retain that same deadline, use the current reconciled amount owed and a valid secure payment link, and accurately describe the account's current restriction; retries and reminders must not imply that grace has restarted. Clearing the overdue balance clears the delinquency; a newly failed invoice after a fully resolved episode may start a new episode.

For unpaid base service, service continues during grace and is fully suspended after the deadline if still unpaid. Login, billing, payment recovery and help remain available. Grace never shifts subscription or usage-cycle dates. Recovery of a retained, uncanceled subscription resumes its original anchors after verified settlement; it does not charge again for base service already paid. Initial setup-payment failures never enter grace.

### UPIB-011 — Annual prepaid service with overdue overages

For an annual customer whose base term is already paid, an overage failure does not revoke prepaid included service. Apply the same fixed five-day grace. After it expires, disable further overage permission until the account is current, while preserving any unused included calls in the current monthly window. Once that included billable-call allowance is exhausted, **do not answer additional calls**. Enforce the restriction before answering, with concurrency-safe usage/admission accounting and reconciliation for nonbillable calls; an answered apology or paid answering leg is not an acceptable substitute for refusing admission.

At the next monthly boundary, restore the full included allowance even if old overage debt remains. Answer calls up to that allowance, then again stop answering additional calls. Verified settlement of overage debt immediately restores overage permission. It does not restart the annual term/monthly usage window, charge base again, order a replacement number or create a new subscription.

Send daily overdue-overage email reminders, deduplicated per recipient/day, not per call. This annual restricted state is distinct from full suspension for unpaid base service. Do not release the number merely because overage debt remains while prepaid included service is still owed; that would defeat the approved monthly allowance. This protection does not extend an expired/unpaid annual base term.

### UPIB-012 — Number retention, ended service and reinstatement

For a fully suspended account following failed renewal, hold the number for 30 days **after** the five-day grace expires. Send a release warning five days before release. This is not a 30-day extension of answering service. The hold does not start merely because a prepaid annual account is restricted to included calls under UPIB-011. Cancellation and number-management jobs must distinguish scheduled term end, actual full suspension, actual ended service and an irreversibly submitted release; retention is not evidence of entitlement or an active subscription.

Recovery before actual cancellation retains the original billing anchors and, if still recoverable, the number. An already submitted provider deletion must be reconciled before claiming the number has been retained or restoring voice; do not race deletion with provisioning or silently replace the number.

After true cancellation/ended service, reinstatement requires completed payment of the selected full new period and resolution of outstanding debt before service resumes. The new billing cycle starts on that successful payment date. There is no prorating, repeat $100 setup charge or second included/free month. Provision a **new** number and display a prominent changed-number banner with the required forwarding action. A request, unpaid Checkout or admin status edit cannot restore service. This new-number/new-cycle rule must not be applied to routine grace recovery or annual overage settlement. Existing data is retained under its existing retention rules; this decision authorizes no record deletion.

### UPIB-013 — Support and manual money decisions

Provide an audited, authorized **Open Customer Account** support session for staff: explicit tenant scope, actor attribution, bounded lifetime, clear support-session indication and termination, using the existing staff/tenant authorization boundary. Do not share customer passwords or let a support URL authorize arbitrary tenant access. Billing-changing actions retain their own authorization and audit requirements.

Customers request refunds or dispute assistance at **customerservice@everycall.io**. Refunds/disputes require manual review; cancellation grants no automatic refund. A partial refund must not abruptly revoke service. Persist/reconcile relevant refund/dispute events for review without inventing automatic entitlement decisions. This specification does not introduce a tax policy or a new global data-retention policy.

### UPIB-014 — Cutover, old accounts and test separation

The owner reports that existing accounts are tests/inactive; there is no grandfathered public price plan. Inventory and explicitly map existing records, subscriptions, open checkouts and verified purchases before release. That statement does not authorize deletion, duplicate collection, mass cancellation or ignoring real provider effects. Preserve the $1 live-test authorization and frozen historical amounts while replacing the ordinary signup path.

Create six new recurring prices for the table in UPIB-007 during an authorized release. Stripe prices are immutable: retain historic IDs on existing financial records, switch intended new sales/portal allowlists to the new IDs, and retire old prices from new purchases only through the reviewed cutover. Reconcile live and sandbox catalogs separately. No provider/catalog write is authorized merely by this documentation update.

## Current implementation and regression map

This is a gap inventory, not release evidence. The inspected local source was `2678787` on `work/sales-batch-2026-11-11`; the observed canonical production source was `1719574`. They differ, so local observations do not establish production behavior. Test cases below are **required future tests**, not tests added or passed by this document change.

| Requirement | Current implementation / gap to address | Required regression |
|---|---|---|
| UPIB-001 | `app/intake/page.jsx`, signup/pricing/demo links and Sales checkout actions do not yet share the required paid intake. | Every entry converges; main website/pricing/offer and intake show matching first-month allowance, overage rate and monthly collection disclosure; missing plan required; prefill editable; free demo stays free; self-service booking denied unpaid and rep exception allowed with all other guards. |
| UPIB-002 | `pages/api/v1/tenants/onboard.js` and Sales prospect/link identity require a shared ownership contract. | Website rematch cannot claim another tenant; tampered/expired/wrong-owner links fail; attribution survives safe edits; ambiguous identity reveals no private data. |
| UPIB-003 | Public onboarding creates a trial tenant before payment; Sales uses a one-time payment without the required recurring subscription. | No tenant/build/number on failed or fake payment; correct setup amount and recurring consent; paid purchase reused without second setup charge; strict mode/identity/amount checks. |
| UPIB-004 | `pages/api/v1/billing/checkout.js` can create duplicate open sessions; Sales expired-link recovery is missing. `pages/api/_lib/salesActivation.js` stops at `awaiting_knowledge_review` with app access disabled. | Parallel requests and duplicate/out-of-order webhooks yield one purchase/subscription/tenant; expired/uncertain link recovery reconciles first; each worker crash resumes same conversion and shows paid-owner progress. |
| UPIB-005 | Sales activation queues a build; production knowledge governance already requires explicit validated publication. | Payment starts only one initial build; allocation/retry controls preserved; no production answering before all readiness gates; raw evidence and tenant corrections unchanged. |
| UPIB-006 | Sales queues, tokens, demos and follow-ups need an atomic/repairable conversion cleanup boundary. | Converted tenant remains; old tokens denied; unsent outreach stopped; uncertain deliveries fenced; immutable history retained; permitted paid support callback still works. |
| UPIB-007 | `pages/api/_lib/billing.js` and live catalog still reflect prior pricing. | All six prices/discounts and three call allowances/rates; first charge $100 only; first recurring charge one calendar month later; $1 live success grants ordinary paid conversion subject to normal readiness; sandbox never activates production. |
| UPIB-008 | Call-period derivation currently follows subscription period boundaries, producing an annual allowance window. | 13 monthly windows across included month plus prepaid year; separate monthly overage collection; short-month/leap-year anchors; idempotent close/invoice; no retrospective re-rating. |
| UPIB-009 | Billing checkout/portal/subscription schedule handling requires strict portal binding and complete next-term coverage. | Missing/wrong portal config fails; every plan/interval change schedules at proper term; cancel keeps service through paid end; undo cancellation retains anchors/number. |
| UPIB-010 | `pages/api/_lib/billingLifecycle.js` and lifecycle cron retain older grace/trial behavior. | Initial failure email and reminders contain reconciled amount owed, secure owner-scoped payment link and the same fixed five-day deadline; reminder restriction copy matches current state; retries/new failed invoice/card change cannot extend it; successful reconciliation clears only settled debt; full suspension keeps login/billing; no anchor drift. |
| UPIB-011 | Billing lifecycle and inbound call admission need independent prepaid allowance and overage permission. | During grace normal admission; after grace unused included calls remain; limit rejects before answer under concurrency; next monthly reset restores included service; debt settlement restores overages without base charge/anchor change; daily email dedupe; no number release. |
| UPIB-012 | `pages/api/v1/billing/reactivate.js` and admin/lifecycle recovery can grant a free seven-day period. Number release already has irreversible-effect reconciliation requirements. | Suspend at grace end, retain 30 more days, warn five before release; retained recovery preserves anchor; deletion race fails safe; ended restart collects full period/debt, no setup/free month/proration, new number/banner/forwarding action. |
| UPIB-013 | Staff/customer access and refund/dispute handling need the defined support/review surfaces. | Wrong tenant/role/expired support session denied; actor audit preserved; no password sharing; partial refund/dispute routed for review without automatic service cutoff. |
| UPIB-014 | Existing trial/admin activation surfaces and old Stripe catalog remain reachable; no runtime migration is delivered here. | Legacy signup/activation paths cannot bypass paywall; existing verified payment is not charged twice; old invoice price IDs remain; new catalog allowlist exact; sandbox/live mismatch fails closed. |

Extend the existing billing catalog, Sales checkout/auth/controller, production recovery, onboarding, usage and gateway suites with these scenarios. Use disposable data and stubbed/sandbox providers for automation. An actual provider canary is a separately authorized release action, not an implicit consequence of testing.

## Implementation and release sequence

1. Design/review the purchase-intake schema and idempotency constraints, owner verification, independent usage/base/grace/admission state and webhook reconciliation. Independently review critical code/schema changes against these requirements before deployment. No ambiguous website merge or migration guess is acceptable.
2. Implement common intake and recoverable payment/conversion with publication gates, then Sales cleanup, billing/support navigation and booking policy. Retire all legacy bypass paths together with their guarded replacements.
3. Implement monthly usage close/overage collection, fixed grace, annual included-call admission, reminders, number retention and paid reinstatement. Complete the regression map, including cross-worker/provider failure and concurrency cases.
4. Prepare an auditable cutover inventory and sandbox evidence. Verify six new prices, the explicit EveryCall portal, all offered next-term transitions, lifecycle/refund/dispute event coverage, signing secrets and recovery behavior. Existing read-only observations found old monthly prices $49.50/$99.50/$149.50 and annual prices $504.90/$1,014.90/$1,524.90; target prices were absent. The active EveryCall portal was nondefault and allowed the old six prices; the default portal belonged to unrelated tiers. Lifecycle webhook coverage existed; refund/dispute coverage was absent. Re-read these settings at release rather than assuming they remain current. Preserve the canonical webhook's existing query configuration without exposing it or treating it as application routing input.
5. Release reviewed migrations/code/catalog changes in a coordinated sequence with rollback boundaries that retain payment associations, amount-aware webhook handling and provider uncertainty fences. Verify the exact deployed revision on the canonical domain separately from local HEAD, plus worker and gateway versions. Record actual validation and any unperformed live acceptance. Documentation approval alone is not implementation or deployment evidence.

The scope deliberately does not settle unrelated tax, global retention or abandoned-unpaid-draft retention policy. None of those topics changes the approved payment, access or recovery rules above.
