# Unified paid intake and billing release evidence

Authority: [UPIB-001–014](../SPECS/unified-paid-intake-and-billing.md). Work began on `work/sales-batch-2026-11-11` at documentation commit `45a1a68`.

Status: UPIB-001–014 are implemented and production activation completed on reviewed functional source `9b5d6b45dd8a9181c09c3b8c4434f442bef4174e`; the reviewed website is published. The mixed owner/account disposition, live provider configuration and production verification are recorded in the [production release record](unified-paid-intake-production-2026-11-13.md). See that record for the current gate status.

## Historical provider and database inventory

The observations and status statements in the dated sections below record the state at the time; the production record above supersedes them for current status.

Read-only observations on November 13, 2026 UTC:

- Connected Stripe account `acct_16FSzlFgMKdd4EaW` is named Creative Dynamic Co and contains the three EveryCall products. Other businesses' products and the unrelated default portal also exist in that account and must remain untouched.
- EveryCall products: Starter `prod_UN6NVD4uHUpCCj`, Growth `prod_UN6NWjuvvRk0EM`, Pro `prod_UN6NJxwcNIj30v`. Active ordinary prices are still $49.50/$99.50/$149.50 monthly and $504.90/$1,014.90/$1,524.90 annual. The approved six replacement prices were absent.
- Explicit EveryCall portal: `bpc_1TOPabFgMKdd4EaWds7cfGmz`, nondefault, metadata `app=everycall`, `environment=live`. Cancellation is at period end with no proration. Its price-change scheduling conditions cover decreasing amounts and shortening intervals; that setting alone does not establish all required next-term transitions.
- Canonical webhook: `we_1TOQPjFgMKdd4EaWTv57cXtZ`, enabled, `https://app.everycall.io/api/v1/stripe/webhook`, API version `2026-02-25.clover`. Its existing query configuration was observed but is deliberately omitted here. Preserve it. Subscription, invoice, schedule and Checkout events are enabled; refund/dispute events require the reviewed cutover.
- Two existing EveryCall subscriptions were observed: `creative_dynamic` active with a special $1.50 Pro price/coupon, and `daved` past due on the former Growth price. Both local billing accounts have missing period timestamps. Reconcile their provider schedules and preserve price history; this inventory authorizes no collection, cancellation, credit or price change.
- Database receipts extend through migration 0062. There are 80 tenants: 71 unpaid/disabled, three deactivated, two trialing, one expired trial, one paid awaiting knowledge review, one active and one past due. Historical unpaid/trial states require explicit mapping before activation; they are not evidence of payment.
- Three Sales checkout records exist: one verified live $1 payment from November 10 awaiting knowledge review on `sales_bdf3516f55ec466dbfb428328837be4f`, one unpaid live $100 link, and one isolated test $100 link. Preserve frozen amounts and in-flight reconciliation. The verified $1 purchase still requires the correct owner and recurring consent, without a second setup charge.

## Test and release environment

- Disposable native PostgreSQL 17.12 is available on loopback for schema, recovery and overlapping-transaction tests. It contains synthetic data only.
- The Stripe plugin exposes the live account. A separate existing Sales test Secret was subsequently exercised inside a disposable, account-pinned acceptance function, without revealing the key. Its actual sandbox account is `acct_1T8P942HodUYhbMc`; it has no webhook endpoints. Live charges/refunds remain prohibited as tests.
- Vercel project identity: `everycall_system` (`prj_sG2tAGfy6Jg39jqvJycxX2uvHoTz`) and website `everycall-website` (`prj_gVorFomC9IpyxtwRomuNJp5Lrpiv`), team `team_WP1ULmraMrNqHQ7jl64Usg0d`.
- Vercel plugin environment listing returned 403. The documented CLI fallback succeeded with the existing credentials and confirmed separate Sales test-key/signing-secret variable names; their Secret values are not returned by environment listing. A pinned CLI is installed under `/tmp` for this session only.

## Historical release boundary

Production migrations 0063/0064 are installed under the separately reviewed [schema-only exception](unified-paid-intake-schema-only.md). No gate activation, portal/webhook change or canonical application/website promotion has occurred. Six replacement live prices were staged inactive and canonically verified; reuse those exact IDs from the cutover preflight. All 126 owned synthetic Stripe fixtures and 15 isolated probe deployments were cleaned up; those functions were never promoted to canonical production. No real customer charge or refund was used as a test. Explicit old-account disposition and coordinated runtime/provider cutover remain required before activating purchases.

## Implementation and regression trace

The approved requirement text remains unchanged. Source and tests below implement the replacement; the independent review and provider acceptance gates still determine readiness.

| Requirement | Implementation | Meaningful regression evidence |
|---|---|---|
| UPIB-001 | Shared intake, owner-gated quote, selected plan/interval, marketing disclosures; paid server-side setup booking | Intake/marketing browser fixture, cross-repository marketing validator, native booking ownership/slot conflicts and Sales prepayment-booking fixture |
| UPIB-002 | `paidIntake.js`: scoped expiring Sales references, email/owner boundary, editable identity rematch and quote token | Native tampered/replayed owner tokens, wrong-owner/ambiguous identity, stale quote before provider effect, conflicting prospect reservations; browser cross-page attribution and edited website |
| UPIB-003 | `paidPurchaseContract.js`, `paidPurchaseEvents.js`: frozen explicit consent, canonical settled Checkout, durable recurring enrollment before conversion | Native unpaid/fake/wrong-mode/amount/identity rejection, collected method/consent checks, initial setup-only collection and no-charge legacy consent |
| UPIB-004 | 0063 purchase uniqueness, frozen provider requests, reconciliation fences and `paidProvisioning.js` leases | Native concurrent Go, accepted-response timeout, webhook replay, worker crash/resume, expired-reference recovery and one owner/tenant/subscription |
| UPIB-005 | Paid initial-build wrapper in `knowledgeReceptionistBuilds.js`, existing allocation/publication/readiness gates | Native once-only initial build and failed provisioning recovery; existing knowledge governance, source-preservation and 163-requirement inventory suites |
| UPIB-006 | Recoverable Sales cleanup and preserved delivery/financial identities | Native provisional conversion/cleanup and attempted-delivery fences, existing paid callback/ownership protections and Sales delivery uncertainty fixtures |
| UPIB-007 | Shared standard catalog, trusted $100/$1/$0 summary and payment-anniversary enrollment | Billing catalog and marketing validators, browser exact amount/consent, native frozen $1 legacy reuse; provider anniversary proof completed; see production record |
| UPIB-008 | `paidBillingCalendar.js`, monthly call windows, frozen rating and separately bound `paidUsageInvoices.js` collection | Native January 31/leap boundaries, initial month plus 12 annual usage/invoice windows, actual rating, invoice crash/retry and explicit payment method |
| UPIB-009 | `paidBillingChanges.js`, guarded subscription/schedule synchronization, explicit EveryCall portal, cancellation/undo controls | Native every offered target plan/interval schedule, term admission fence and old schedule isolation; browser change/cancel/undo bodies; provider transition matrix completed; see production record |
| UPIB-010 | Payable invoice debt/episode ledger, immutable five-day grace, owner recovery links and reminder receipts | Native failed/action-required invoices, stale event after settlement, current debt/deadline reminders, retained app/Billing access and fixed anchors |
| UPIB-011 | Pre-answer admission reservations with tenant locks, independent prepaid allowance and overage permission | Native overlapping clients, quota refusal, nonbillable slot release, monthly reset, overage settlement, daily reminder dedupe and no annual-debt number release |
| UPIB-012 | `paidNumberRelease.js`, `paidNumberProvisioning.js`, full-period `paidReinstatement.js` | Native 30-day hold/warning, submitted deletion uncertainty, same-cycle recovery versus full-paid restart, new-number receipt/fence and no repeated setup/build/free month |
| UPIB-013 | Bound read-only staff support sessions, actor audits, money-event review, manual customer-service escalation | Native wrong role/tenant/session/expiry/revocation and audit rollback; refund event leaves entitlement intact; unsupported paid credits/debits fail before ledger writes |
| UPIB-014 | Guarded release gate, scoped 0063/0064/0065 runners, retired signup/free recovery paths and strict provider mode | Native migration pin/drift/contention/timeout/rollback tests, built HTTP forged-onboarding refusal/closed gate, live/test Sales identity separation; mixed owner/account disposition and gate status: see production record |

Executable suites: `validate-paid-intake.mjs`, `validate-paid-billing-lifecycle.mjs`, `validate-paid-followup-cleanup.mjs`, `test-unified-paid-billing-migrations.mjs`, `test-paid-intake-browser.cjs`, `test-paid-intake-http.mjs`, `validate-paid-marketing.mjs`, `validate-billing-catalog.mjs`, and `test-sales-contact-delivery.mjs` under `scripts/`. Native suites require an explicitly selected disposable loopback PostgreSQL target. Provider doubles do not constitute Stripe sandbox evidence.

## Review and current limits

See the [separate fresh-context Astra review](unified-paid-intake-independent-review.md) for findings, fixes and independent diagnostics. During review the implementation moved to one durable purchase containing hosted payment/consent and subsequent idempotent recurring enrollment. Conversion requires canonical payment, explicit frozen recurring terms and one verified subscription. Neither a saved card nor a successful browser return grants service.

Paid-account manual credits/debits require manual support review; the former adjustment write fails closed instead of displaying a credit that is omitted from the collected invoice. Existing adjustments and financial/audit history remain. Uncollected historic adjustments block collection for reconciliation.

The migration runner's eight baseline catalog contracts and predecessor receipts match production, including the exact 0049 prompt-mode column/check. Both new migrations are now installed. See the schema-only result below for their reviewed source, bounded execution, receipts and preservation evidence.

Website changes are prepared on `work/unified-paid-intake-billing-2026-11-12`, leaving production `master` unchanged until coordinated application/provider cutover. The original website checkout remains untouched while the isolated checkout under `/tmp` is reviewed.

## Executed local validation — November 13, 2026 UTC

- Final combined batch: all eleven suites passed: paid intake (26 scenarios), paid work fairness (seven scenarios), paid billing lifecycle, paid followup cleanup, guarded migrations, Sales contact delivery, Sales paid activation/publication/opt-out, Sales Smartlead, production recovery, Sales auth and tenant passwords. Native concurrency fixtures use disposable PostgreSQL 17.12 schemas and provider doubles.
- Browser regression passed: owner login/verification recovery, Go requiring a refreshed bound quote and explicit consent, $100/$1/$0 disclosures, stored attribution, editable website, annual monthly allowance, next-term change/cancel/undo, full-paid restart and uncertain appointment recovery. Synthetic APIs establish UI contracts, not provider acceptance.
- Final Next.js 16.1.6 Webpack production build passed with the disposable database target. Contracts and inbound gateway TypeScript checks passed. The initial sandboxed Turbopack build stalled and was stopped; the successful verification used Webpack.
- The freshly built application passed actual HTTP/public/private/paywall checks with a disposable schema and zero tenant/intake/purchase side effects behind the closed gate.
- Billing catalog and cross-repository marketing validation passed for all six prices and fifteen public HTML/JS files. Knowledge governance, raw-source preservation and the frozen inventory passed; all 163 original requirements remain.
- Independent Astra native diagnostics verified transaction rollback, next-term admission fencing, old schedule isolation, fixed SCA grace, manual-adjustment refusal, prepaid retention, prospect purchase uniqueness, consent/quote binding, uncertain Sales effects and recovery fairness. See the separate review for the finding log and closure evidence.

## Completed provider acceptance and source linkage

The original absence of a readable sandbox key was resolved using private disposable functions that consumed the existing Sales test Secret. They checked test-key mode and the exact sandbox account before every scenario, accepted only fixed operations with authenticated expiring continuations, imported no application/database code and had no cron jobs. All 15 probe deployments and their share access were removed after testing; their credential-bearing HTTP wrappers stayed outside the application release. Final cleanup verified unchanged canonical/cron targets and no project-wide automation bypass.

Actual provider tests have established hosted standard/annual setup-only Checkout, full paid annual restart Checkout, the corrected zero-extra initial invoice and calendar renewal behavior, all 39 annual-plan monthly overage invoices with idempotent replay, SCA recovery without moving dates, and cancellation/undo. All 36 financial plan transitions passed exact full prices at the switch and following renewal, without partial base amounts or anniversary drift. Preserve these as the pre-payment-method-delta matrix; do not relabel them as exact requests from later source. Mechanical comparison establishes the narrowly changed schedule payment-method fields, with separate real Portal replacement proofs across monthly→monthly, monthly→annual, annual→annual and full-prepaid annual→monthly transitions, followed by the next base and usage collection. The combined annual→monthly bridge, further reschedule, Portal replacement, two full Growth renewals and a closed Growth usage window also passed without a duplicate bridge charge.

The actual hosted no-charge consent journey reused an earlier captured setup payment, completed a setup-mode Checkout and owned off-session SetupIntent, and created a subscription with a zero initial base invoice. Canonical inventory contained only the original setup invoice and the zero subscription invoice: no second setup collection. The included month retained the original payment time rather than the later consent time. Native expired-term tests retain the historical $1 amount/date and require review, without another setup charge, a restarted included month or automatic arrears.

Paying a hosted invoice and replacing the owner's recurring payment method are separate actions. The tested hosted form had an unchecked save option; Pay-only evidence proves one-time settlement, not recurring replacement consent. UPIB does not authorize promoting every invoice payer's method to the customer's global default. Preserve existing defaults; any initialization is restricted to a new dedicated purchase customer before Portal exposure, durably frozen and recoverable. Reused/null customers can still enroll with the explicitly consented subscription method. Before a scheduled change, divergent or missing defaults require explicit owner Portal confirmation without blocking cancellation. See the current decisions and runbook for the exact reviewed contract.

Independent current-source native QA additionally passed the 29-case intake suite, customer-default ownership/uncertain-response cases, paid-bridge cancellation/reschedule/replay cases, and delayed first-binding coverage. The latter recovers only complete canonical fully paid original-calendar history, preserving anchors and audited invoice receipts; gaps, debt, unsupported changes and uncertainty require review before tenant/build/number effects. Browser QA verifies that review is visible even before payment verification, never claims an unverified payment and blocks another checkout. The subsequent independent strict source-request and usage-linkage comparisons passed all 83 cases on clean reviewed source, including the unchanged financial application bytes in `4294120`.

Live catalog activation, the explicit EveryCall portal and webhook update, application/inbound/worker cutover, website promotion, old-version retirement and atomic purchase gate remain unperformed. The historical $1 payment and frozen amounts are preserved. The two existing real subscriptions need the owner's explicit disposition; no response is inferred from elapsed time. See [cutover preflight](unified-paid-intake-cutover-preflight.md) and the [guarded activation procedure](unified-paid-intake-activation.md) for exact identities, immutable evidence and refusal conditions.

## Push and deployment observations

- System implementation committed and pushed as `750ae371ebf1d2614924c61c2c7a1254c463f58f` on `work/sales-batch-2026-11-11`. Marketing committed and pushed as `a2dfd7f0ed10557b4fab607e3be7a2aaaebe1bee` on `work/unified-paid-intake-billing-2026-11-12`. The unrelated CSV and lock file remain untracked and untouched.
- Before pushing, authenticated Vercel project metadata confirmed production branches `main` for the app and `master` for the website. Neither branch was changed. Website production metadata remained at `05f212c461dd7c50bb45c6b0e2af093728943e9e`.
- After pushing, `https://app.everycall.io/api/version` returned HTTP 200, `vercelEnv=production`, commit `17195749a3cd70b421db34c2f4f244d9f153b0e3`, independently confirming canonical production was unchanged.
- Git created app preview `dpl_FGCoNQUE7ejTVruLwanVg8CoMVfV` for the implementation commit; Vercel reported READY with no production target. This is build/deployment evidence only, not payment or production acceptance. Website preview `dpl_7HervwKZBFhZ4KsYCnTKBka1JFw7` was reported BLOCKED with no production target; the queried tool response did not establish a cause.
- The user explicitly confirmed Render's My Workspace (`tea-d6gfq215pdvs73d23kag`). Request-scoped service inspection subsequently verified inbound, worker and Sales gateway at the existing production revision `1719574`; no Render deployment has been triggered for this release. The final inbound/worker must match the reviewed application revision. Sales gateway inputs are unchanged by this release, so its compatible existing revision is recorded separately. Do not infer runtime versions from a Git push.


## Verified schema-only production result — November 13, 2026 UTC

The first guarded attempt at `97d344a` returned PostgreSQL `25P04`. Independent
read-only reconciliation proved full rollback: no new receipts, objects, function,
nine added columns or gate; all baseline contracts and protected history matched.
That failure did not authorize increasing the deadline or removing a check.

The separately reviewed `4294120` batches each relation's five catalog reads into
one parameterized statement with identical ordered JSON, normalization, exclusions
and stored fingerprints. Native QA passed 32 old/new comparisons, the original
migration drift/contention/rollback suite and a real server-deadline latency control.
A production read-only profile matched all eight baseline contracts and reduced
40 catalog reads at 3,810 ms to eight at 800 ms. The 10-second transaction,
5-second statement, 250-ms lock bound, NOWAIT/advisory fences and atomic receipts
were retained.

One approved retry committed both migrations in **6,466 ms**. The result is bound
to source `4294120ff4a54c793248e7c42062b77be4774464`, the unchanged SQL hashes and
production target fingerprint in the schema-only procedure. Independent readback
at `2026-11-13T09:43:45.869Z` verified both receipts, eight baseline contracts,
51 expected owned names, 13 empty new ledgers and exactly one pristine gate with
`enabled=false` and all activation fields null. All five protected history
counts/digests, selected financial records and Sales checkout history matched.
The 80 tenants, 90 billing accounts, two subscription associations and three Sales
checkouts were preserved, including ten historical orphan accounts. Ten additional accounts for known current tenants appeared between the historical
and preflight inventories, before the first migration attempt,
with null customer/subscription bindings and retained product/price IDs. This
matches the preexisting worker initialization path; that attribution is an
inference. The records were not deleted or treated as proof of payment.

Private immutable evidence SHA-256 values:

- Successful migration result: `611bece4a8770932903e7ac509b1291cb0287030c075bd7efd11e2d322195c8d`.
- Independent post-readback: `952e81510edff241c6f852d202a204423d98ce3cad0ab9df1ef4fb0bf1c2a927`.
- Accepted retry release evidence: `8c847cc6beafc38b8ece01a427e6c37297795ffb02b101a10a59681c4b7dc238`.
- Rolled-back first-attempt reconciliation: `bc33ff7dec6b4cbeb81175b2b8afd8f1d685a29ddfc925a559624a5a89e4289e`.

These snapshots remain private under `/tmp/upib-release-preflight`; retain them
with the operator's release record. No credentials, bearer links or customer
contact data are committed here.

Post-schema public checks returned HTTP 200 and the unchanged app revision
`17195749a3cd70b421db34c2f4f244d9f153b0e3`; the public pricing bytes still match
website `05f212c461dd7c50bb45c6b0e2af093728943e9e`. Request-scoped Render reads in
the owner-confirmed workspace verified all three services live on `1719574`.
Website candidate `a2dfd7f0ed10557b4fab607e3be7a2aaaebe1bee` remains staged without
public aliases. Its temporary share inspection was rejected by automated approval
review over a reported project-wide bypass risk; revocation is not claimed and
the share is left to expire. Project-wide automation bypass remained absent in
the final probe cleanup check.

Full rollout still needs the owner's explicit treatment of the two real legacy
subscriptions. No answer is inferred from the production request or elapsed time.
The final reviewed activation revision must be pinned consistently across its
acceptance bundle and canonical app/inbound/worker deployments; historical
migration evidence remains bound to `4294120`.
