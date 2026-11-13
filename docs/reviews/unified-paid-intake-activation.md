# UPIB-014 guarded production activation

The gate remains disabled until real provider acceptance, canonical deployments,
old creator retirement, and explicit legacy subscription decisions are complete.
`scripts/activate-paid-intake-release.mjs` is the only activation entry point in
this release. Preparing this runner does not authorize execution. It makes no
Stripe requests and cannot cancel, replace, charge or adopt a legacy subscription.

The currently implemented owner option is `retain_billing_disable_legacy_service`:
set tenant status inactive, disable service, and retain owner app/Billing/help access
for each legacy subscription account, retaining its
provider billing and local billing history unchanged. This option MUST NOT be
selected on the owner's behalf. A different owner decision requires another
reviewed implementation. An absent answer always fails closed.

## Required evidence bundle

Keep real evidence outside the repository in a mode-0700 release directory with
mode-0600 files. Never record credentials, webhook query strings, payment data or
customer contact details. Each artifact is JSON. Hashes use
`cutoverDigest(JSON.parse(fileContents))`, SHA-256 of compact JSON.stringify
serialization preserving parsed key order, rather than whitespace-sensitive file
hashes. Migration hashes remain SHA-256 of the exact SQL file bytes.

The bundle must preserve the original private file hashes:
`historicalInventorySha256` =
`1fe0d43fd940394f24f03d1c66ac988860361803b9d36fc51b8e40c9bbd09eb7`,
`inactivePriceReceiptsSha256` =
`c7933cb1941564557e66699944cc17ec341609100f0dda1b0aaab2f1b1c4acd4`.
These are historical file-byte hashes, separate from final JSON artifact digests.

The bundle contains `reviewedRevision` (exact clean 40-character app commit),
`reviewedWebsiteRevision` (independently reviewed marketing commit),
`targetFingerprint` (from `upibTargetFingerprint(DATABASE_URL)`),
`actorAdminUserId` (actual administrator), `evidenceReference`,
`originalWebhookUrlSha256`, `originalWebhookEvents`, `migrationSha256` keyed by
0063/0064 filenames, and `artifactPaths` plus `artifactSha256`, both keyed by:

- `inventory`: `observedAt`, `phase: post_migration_post_retirement`, `snapshot`
  from `capturePaidCutoverInventory(pool)`, and one `tenantDispositions` entry
  per tenant. Allowed actions are `retain_no_entitlement`,
  `preserve_paid_setup_owner_consent`, `legacy_subscription_manual_inactive`.
  Legacy subscription tenants must use the last action. Preserve the frozen $1
  setup receipt; this release does not manufacture consent or charge setup again.
- `decisions`: `explicitlyChosen: true`, the exact supported `choice`, actual
  `ownerDecisionReference` and `ownerDecisionQuote`, and `subscriptionActions`
  covering every subscription-bearing account without a paid purchase. Each
  action has `tenant_key`, `stripe_subscription_id`, `service: disabled`,
  `providerBilling: unchanged`. No production decision template supplies defaults.
- `acceptance`: exact `reviewedRevision`, `testLivemode: false`, independent
  review reference, and `checks` with `{status: passed, evidenceReference}` for
  `setup_only_checkout`, `calendar_monthly_annual`, `plan_transitions_36`,
  `monthly_usage_invoices_39`, `cancel_undo`, `payment_method_sca_recovery`,
  `full_paid_restart`, `unknown_effect_recovery`, `initial_build_readiness`.
  A failed annual-to-monthly provider test cannot be marked passed.
- `runtime`: `observedAt`; `app`, inbound `gateway`, and `worker` each with exact
  reviewed `revision`, `healthy: true`, and canonical evidence reference. App
  additionally has `production: true`, `canonicalOrigin: https://app.everycall.io`.
  `website` requires the exact reviewed website revision, `production: true`,
  `healthy: true`, `canonicalOrigin: https://www.everycall.io`,
  `apexRedirectVerified: true`, `disclosuresVerified: true` and evidence reference.
  `gateway` here is the inbound admission service, not the byte-identical Sales
  gateway. `retirement` contains actual `canonicalChangedAt`, actual `completedAt`
  at least 810 seconds later, `oldRevision` 17195749a3cd70b421db34c2f4f244d9f153b0e3,
  `configuredFunctionMaximumSeconds: 300`, `durationEvidenceReference`,
  `oldCanonicalIngressRemoved: true`, `oldWorkerInstancesAbsent: true`.
  Old project production metadata and five explicit old route overrides both
  showed 300 seconds; retain the reviewed private metadata evidence. The 810-second
  wait is required even though the observed old timeout is shorter. Verify old
  worker instances have drained independently; elapsed time is not worker proof.
- `provider`: fresh live canonical readbacks from acct_16FSzlFgMKdd4EaW,
  `observedAt`, `stripeContext`, `livemode: true`, `unknownEffects: 0`,
  `canonicalReadbackEvidenceReference`. Include the six previously staged price
  objects after authorized activation, the explicit EveryCall portal configuration,
  and webhook readback. Store URL hash only, plus signing configuration evidence
  reference. The runner pins staged IDs, products, full monthly/annual amounts,
  intervals, mode, lookup keys, disabled portal plan changes, period-end cancellation,
  card/invoice access, required event union and unchanged canonical webhook URL.
  `openCheckouts` must report `everycallOpenCount: 0`,
  `unclassifiedPotentialEverycallCount: 0`, `hasMore: false`. This must include
  unledgered old subscription-mode sessions, not only Sales DB rows.
  `legacySubscriptions` contains canonical `id`, `customer`, `priceId`, `livemode`.
  `legacyCheckouts` contains each live Sales row's `checkoutId`, `sessionId`,
  `livemode`, `mode`, `currency`, `amountCents`, `status`, `paymentStatus` and,
  for paid rows, `paymentIntentStatus`, `amountReceived`, `chargePaid`,
  `chargeCaptured`. Unpaid rows must be canonically expired with no
  `paymentIntentId`/`subscriptionId`. Preserve uncertain sessions for reconciliation;
  never claim them expired merely because the local row has expired.

Inventory, provider and runtime artifacts must be at most ten minutes old at
activation. Inventory and provider observations must follow completed retirement.
Refresh and independently review changed artifacts; never bypass freshness.
The synthetic native test demonstrates the schema but is not production evidence.

## Execution sequence

1. Close provider defects and independent review against the exact source revision.
   Record explicit owner decisions. Preserve all historical frozen amounts.
2. Apply the separately reviewed 0063/0064 migration runner with the gate disabled.
   Keep its receipts and target/SQL/source pins. Stage and verify the exact merged
   app, promote canonical admission, then advance inbound gateway and worker to
   the same source. Verify their exact revisions and health.
3. Record canonical cutover time, retire old ingress and worker instances, wait
   at least 810 seconds, then repeat remote open Checkout and known receipt
   reconciliation. Only expire positively identified unpaid obsolete EveryCall
   sessions under separately coordinated authorization. Leave unrelated businesses
   alone. Close every unknown provider effect before proceeding.
4. Under coordinated authorization activate only the six staged prices, update
   only EveryCall's explicit portal, and extend the existing webhook events.
   Preserve its URL/query and signing secret. Collect fresh canonical readbacks.
   The runner changes database bindings atomically with the gate; ensure runtime
   fallback environment bindings are also the reviewed values before activation.
5. Promote the reviewed website while the intake gate remains disabled; verify
   its canonical www origin, apex redirect and paid pricing/disclosures. Only then
   capture the final database snapshot, assemble the five artifacts and bundle,
   independently review their hashes, and supply their exact references to the
   release reviewer. Keep the old original inventory and inactive-price receipts
   as separately retained historical evidence.
6. In the clean reviewed checkout, with DATABASE_URL supplied through the existing
   private environment, run:

   ```sh
   node scripts/activate-paid-intake-release.mjs /private/release/bundle.json
   ```

   Required environment: `EVERYCALL_REVIEWED_REVISION` and independently reviewed
   `EVERYCALL_CUTOVER_BUNDLE_SHA256`. Default is rollback-only validation. Inspect
   its result. Only after coordinated authorization repeat with
   `EVERYCALL_ACTIVATE_PAID_INTAKE_RELEASE=1`.

The bounded transaction locks relevant local tables, verifies installed physical
contracts and migration receipts, compares every inventoried row and old catalog,
checks actual administrator identity, then atomically changes catalog bindings,
explicit legacy service dispositions, release gate and audit. Any failure rolls
back all changes. Billing accounts, paid history and provider subscriptions are
untouched. A retry of the identical applied bundle checks the existing audit and
bindings rather than applying another release. Never repair an activation failure
with ad hoc gate SQL. Reconcile the reported evidence or source defect first.
