# Unified paid intake and billing release evidence

Authority: [UPIB-001–014](../SPECS/unified-paid-intake-and-billing.md). Work began on `work/sales-batch-2026-11-11` at documentation commit `45a1a68`.

Status: implementation and local regressions are committed on the integration review branch. Real Stripe sandbox acceptance subsequently exposed provider behavior that the earlier local fixtures did not establish: initial recurring collection, annual-to-monthly scheduling and hosted-invoice card recovery. Initial collection is corrected in `7405f85`; the remaining financial fixes and their independent Astra review are in progress. Production activation remains blocked by completed provider acceptance, explicit existing-account disposition and canonical runtime/configuration verification. This record does not claim production acceptance.

## Historical provider and database inventory

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

## Release boundary

No production database migration, gate activation, portal/webhook change or canonical application/website promotion has been performed for this implementation. Six replacement live prices have been created inactive and canonically verified; reuse those exact IDs from the cutover preflight rather than creating replacements. Disposable production-environment acceptance functions use only the pinned Stripe sandbox and are never promoted to canonical production. Test payments use synthetic sandbox data. Complete provider acceptance, explicit old-account mapping and coordinated runtime/provider cutover before activating purchases.

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
| UPIB-007 | Shared standard catalog, trusted $100/$1/$0 summary and payment-anniversary enrollment | Billing catalog and marketing validators, browser exact amount/consent, native frozen $1 legacy reuse; real provider anniversary proof remains outstanding |
| UPIB-008 | `paidBillingCalendar.js`, monthly call windows, frozen rating and separately bound `paidUsageInvoices.js` collection | Native January 31/leap boundaries, initial month plus 12 annual usage/invoice windows, actual rating, invoice crash/retry and explicit payment method |
| UPIB-009 | `paidBillingChanges.js`, guarded subscription/schedule synchronization, explicit EveryCall portal, cancellation/undo controls | Native every offered target plan/interval schedule, term admission fence and old schedule isolation; browser change/cancel/undo bodies; real source/destination provider transitions remain outstanding |
| UPIB-010 | Payable invoice debt/episode ledger, immutable five-day grace, owner recovery links and reminder receipts | Native failed/action-required invoices, stale event after settlement, current debt/deadline reminders, retained app/Billing access and fixed anchors |
| UPIB-011 | Pre-answer admission reservations with tenant locks, independent prepaid allowance and overage permission | Native overlapping clients, quota refusal, nonbillable slot release, monthly reset, overage settlement, daily reminder dedupe and no annual-debt number release |
| UPIB-012 | `paidNumberRelease.js`, `paidNumberProvisioning.js`, full-period `paidReinstatement.js` | Native 30-day hold/warning, submitted deletion uncertainty, same-cycle recovery versus full-paid restart, new-number receipt/fence and no repeated setup/build/free month |
| UPIB-013 | Bound read-only staff support sessions, actor audits, money-event review, manual customer-service escalation | Native wrong role/tenant/session/expiry/revocation and audit rollback; refund event leaves entitlement intact; unsupported paid credits/debits fail before ledger writes |
| UPIB-014 | Closed release gate, scoped 0063/0064 runner, retired signup/free recovery paths and strict provider mode | Native migration pin/drift/contention/timeout/rollback tests, built HTTP forged-onboarding refusal/closed gate, live/test Sales identity separation; actual old-account mapping/cutover remains outstanding |

Executable suites: `validate-paid-intake.mjs`, `validate-paid-billing-lifecycle.mjs`, `validate-paid-followup-cleanup.mjs`, `test-unified-paid-billing-migrations.mjs`, `test-paid-intake-browser.cjs`, `test-paid-intake-http.mjs`, `validate-paid-marketing.mjs`, `validate-billing-catalog.mjs`, and `test-sales-contact-delivery.mjs` under `scripts/`. Native suites require an explicitly selected disposable loopback PostgreSQL target. Provider doubles do not constitute Stripe sandbox evidence.

## Review and current limits

See the [separate fresh-context Astra review](unified-paid-intake-independent-review.md) for findings, fixes and independent diagnostics. During review the implementation moved to one durable purchase containing hosted payment/consent and subsequent idempotent recurring enrollment. Conversion requires canonical payment, explicit frozen recurring terms and one verified subscription. Neither a saved card nor a successful browser return grants service.

Paid-account manual credits/debits require manual support review; the former adjustment write fails closed instead of displaying a credit that is omitted from the collected invoice. Existing adjustments and financial/audit history remain. Uncollected historic adjustments block collection for reconciliation.

The migration runner's eight baseline catalog contracts and predecessor receipts were compared with production in a read-only transaction. The fixture now includes the exact 0049 prompt-mode column/check, rather than weakening schema drift checks. Neither new migration is installed in production.

Website changes are prepared on `work/unified-paid-intake-billing-2026-11-12`, leaving production `master` unchanged until coordinated application/provider cutover. The original website checkout remains untouched while the isolated checkout under `/tmp` is reviewed.

## Executed local validation — November 13, 2026 UTC

- Final combined batch: all eleven suites passed: paid intake (26 scenarios), paid work fairness (seven scenarios), paid billing lifecycle, paid followup cleanup, guarded migrations, Sales contact delivery, Sales paid activation/publication/opt-out, Sales Smartlead, production recovery, Sales auth and tenant passwords. Native concurrency fixtures use disposable PostgreSQL 17.12 schemas and provider doubles.
- Browser regression passed: owner login/verification recovery, Go requiring a refreshed bound quote and explicit consent, $100/$1/$0 disclosures, stored attribution, editable website, annual monthly allowance, next-term change/cancel/undo, full-paid restart and uncertain appointment recovery. Synthetic APIs establish UI contracts, not provider acceptance.
- Final Next.js 16.1.6 Webpack production build passed with the disposable database target. Contracts and inbound gateway TypeScript checks passed. The initial sandboxed Turbopack build stalled and was stopped; the successful verification used Webpack.
- The freshly built application passed actual HTTP/public/private/paywall checks with a disposable schema and zero tenant/intake/purchase side effects behind the closed gate.
- Billing catalog and cross-repository marketing validation passed for all six prices and fifteen public HTML/JS files. Knowledge governance, raw-source preservation and the frozen inventory passed; all 163 original requirements remain.
- Independent Astra native diagnostics verified transaction rollback, next-term admission fencing, old schedule isolation, fixed SCA grace, manual-adjustment refusal, prepaid retention, prospect purchase uniqueness, consent/quote binding, uncertain Sales effects and recovery fairness. See the separate review for the finding log and closure evidence.

## Provider acceptance in progress

The original absence of a readable sandbox key is resolved by a private disposable function that consumes the existing Sales test Secret. It checks test-key mode and the exact sandbox account before every scenario, accepts only fixed test operations with authenticated expiring continuations, imports no application/database code, and has no cron jobs. Deployment-specific expiring share access is private; project-wide protection bypass is absent. The canonical application and cron targets remain unchanged. Remove the acceptance deployments/share access after testing; their HTTP wrapper and credentials must never enter the application release.

Actual provider tests have established hosted standard/annual setup-only Checkout, full paid annual restart Checkout, the corrected zero-extra initial invoice and calendar renewal behavior, all 39 annual-plan monthly overage invoices with idempotent replay, SCA recovery without moving dates, cancellation/undo, and portal card replacement followed by usage collection. These results are scenario evidence, not completion of the acceptance matrix. A focused paid-bridge experiment now collects the full monthly base on the original anniversary after an annual term, then renews on the correct following anniversary; the reviewed application implementation and all 36 plan transitions remain required. Hosted-invoice payment alone did not reliably update the future default card in the first tested configurations; that defect remains open until a corrected contract proves the next base and usage payments.

The live catalog activation, explicit EveryCall portal and webhook update, additive migrations, application/inbound/worker cutover, website promotion, old-version retirement and atomic purchase gate remain unperformed. The historical $1 payment and frozen amounts are preserved. The two existing real subscriptions need the owner's explicit disposition; no response is inferred from elapsed time. See [cutover preflight](unified-paid-intake-cutover-preflight.md) and the [guarded activation procedure](unified-paid-intake-activation.md) for exact identities, immutable evidence and refusal conditions.

## Push and deployment observations

- System implementation committed and pushed as `750ae371ebf1d2614924c61c2c7a1254c463f58f` on `work/sales-batch-2026-11-11`. Marketing committed and pushed as `a2dfd7f0ed10557b4fab607e3be7a2aaaebe1bee` on `work/unified-paid-intake-billing-2026-11-12`. The unrelated CSV and lock file remain untracked and untouched.
- Before pushing, authenticated Vercel project metadata confirmed production branches `main` for the app and `master` for the website. Neither branch was changed. Website production metadata remained at `05f212c461dd7c50bb45c6b0e2af093728943e9e`.
- After pushing, `https://app.everycall.io/api/version` returned HTTP 200, `vercelEnv=production`, commit `17195749a3cd70b421db34c2f4f244d9f153b0e3`, independently confirming canonical production was unchanged.
- Git created app preview `dpl_FGCoNQUE7ejTVruLwanVg8CoMVfV` for the implementation commit; Vercel reported READY with no production target. This is build/deployment evidence only, not payment or production acceptance. Website preview `dpl_7HervwKZBFhZ4KsYCnTKBka1JFw7` was reported BLOCKED with no production target; the queried tool response did not establish a cause.
- The user explicitly confirmed Render's My Workspace (`tea-d6gfq215pdvs73d23kag`). Request-scoped service inspection subsequently verified inbound, worker and Sales gateway at the existing production revision `1719574`; no Render deployment has been triggered for this release. The final inbound/worker must match the reviewed application revision. Sales gateway inputs are unchanged by this release, so its compatible existing revision is recorded separately. Do not infer runtime versions from a Git push.
