# Unified paid intake: actual Stripe sandbox acceptance

The isolated provider run `upib_609dfdd83248380d` used existing test credentials for sandbox `acct_1T8P942HodUYhbMc`, Stripe SDK 20.4.1 and API `2026-02-25.clover`. Every action enforced an expiring bearer, signed fixture continuation, test-key/account/mode checks, synthetic resource ownership and safe webhook preflight (no sandbox endpoints). No live charge/refund, application database write, email, SMS or call was used. Independently reviewed function-only deployments had no aliases, promotion or application imports. Production target, crons and protection were checked unchanged after each stage.

[The evidence bundle](unified-paid-intake-provider-evidence/manifest.json) contains sanitized canonical provider IDs, dates, amounts, line identities and request comparisons. Hosted URLs, access secrets and signed continuations remain outside the repository.

## Results and exact scope

- All 36 source/target plan and billing-interval combinations passed full target amount, original-anniversary term and following-renewal checks. This matrix used the final calendar/paid-bridge contract **before** the later payment-default inheritance correction; it is not relabeled as a final-method matrix.
- All 36 old/new frozen schedule requests differ only in the reviewed payment fields: clearing the schedule default method and omitting the current phase override. Four additional actual Portal replacements after scheduling covered monthly→monthly, monthly→annual, annual→annual and annual→monthly. Each collected the correct next base, following base and usage charge on the replacement card.
- A combined final-contract journey covered annual→monthly during the included month, canonical production-key bridge receipt, another plan change during that paid bridge, omission of its already-billed item, actual Portal replacement, two full Growth monthly renewals and the $6 usage charge for a wholly Growth window.
- Initial enrollment paid no additional base invoice. January 31 monthly renewals clamped February and returned to March 31, including leap February. Annual setup charged its full annual amount after the included month; full annual restart deferred the next annual charge for the prepaid year.
- Three annual plans each paid 13 monthly overage invoices (39 total), including the setup month and 12 prepaid annual months. Replays reused the invoice. One earlier clock-selector collision is retained as failed harness evidence; the fresh ordinary-calendar retry passed.
- Hosted $100 monthly/annual intake and a full annual restart completed with explicit terms and saved-method consent. A separate $0 setup-mode Checkout reused an actually captured $100 receipt, collected new explicit consent and preserved the original payment timestamp. Its only paid invoice remained the original $100; the new subscription invoice was $0.
- Decline and authentication-required bridge invoices remained open until actual hosted recovery. Settlement restored paid state without resetting the anniversary. Monthly/annual cancellation and undo preserved the paid term; cancellation during the paid bridge was also checked.

The hosted invoice form had an unchecked `savePaymentMethod` checkbox labeled “Save payment details to EveryCall for future purchases.” Tests that clicked Pay without selecting it establish debt settlement, not owner authorization to replace the recurring default. The explicit default-replacement proof uses the Portal. No blanket invoice-paid→customer-default synchronization was introduced. Dedicated synthetic Portal configurations were used; production must retain its explicit EveryCall configuration, not the unrelated account default.

## Provider discoveries retained in evidence

The original same-second anchor-only enrollment charged a base immediately. Explicit `trial_end` fixed that while keeping the original calendar anchor. Annual→monthly duration/anchor variants prorated and drifted to March 29; the reviewed paid bridge collected the full amount and returned to March 31. Copying an already-billed bridge item during rescheduling caused a delayed duplicate; validated omission removed it. Scheduled stale payment overrides restored an old card; seeded/aligned customer defaults with cleared schedule overrides preserved explicit Portal replacements. These failed experiments were not converted into passing results or hidden by weakening assertions.

The last unchanged-subscription list-response check found that Stripe marks the first full monthly `subscription_cycle` line as `proration=true` despite its exact full price and original Feb 28→Mar 31 coverage; the following full renewal is `false`. The canonical response is preserved unchanged. Source acceptance must validate the full cycle, price, amount, quantity and original window rather than rejecting that flag alone; partial or unrelated lines remain ineligible.

Production-key metadata and canonical line parents, recurring phase items, schedule/customer/subscription bindings, price identities and invoice reasons are preserved in the final combined bridge evidence. These supplement the offline financial comparator, which normalizes synthetic metadata namespaces.

## Reproduction and source linkage

Provider request-body baseline revision: `6a1ea89ccdb0bb36d19b19e7518ae190136fe169`. The subsequent narrowly reviewed canonical first-cycle validation correction changes response acceptance, not outgoing financial requests; it is not attributed to that older revision. Final clean-HEAD comparison and the actual-response native regression establish the final revision. Native captures are included under `unified-paid-intake-provider-evidence/source-captures/`; each records actual frozen outgoing requests and source-file hashes. The offline comparator executes the reviewed helper with a Stripe double and compares 83 requests: 36 enrollments, 36 plan transitions, included-month and in-bridge changes, five Checkout variants, two customer-default initializations and two usage payment-method branches.

The usage comparison checks exact invoice/item/finalize mechanism, amount, method and invoice binding. Its native fixture independently preserves a historical $9 amount after the current plan rate changes; the provider helper’s current-price calculation is not evidence of historical rating correctness. Only synthetic identity metadata and the synthetic adjective in the usage description are normalized. Checkout consent/disclosure text and callback paths remain exact.

Run from the repository root (no Stripe credentials or network required):

```sh
node scripts/test-stripe-sandbox-acceptance.mjs
node scripts/compare-stripe-sandbox-contracts.mjs \
  --probe scripts/lib/stripe-sandbox-acceptance.mjs \
  --captures docs/reviews/unified-paid-intake-provider-evidence/source-captures \
  --schedule-method-strategy clear_settings \
  --baseline-captures docs/reviews/unified-paid-intake-provider-evidence/baseline-source-captures \
  --source-root . \
  --out /tmp/unified-paid-intake-source-comparison.json
```

The strict command also requires a clean worktree and verifies every captured source hash before recording the exact final HEAD. A documentation/tooling-only follow-up commit does not change the financial source hashes. Provider stages are isolated acceptance environments and must never be promoted.

## Cleanup

All 126 known synthetic customer fixtures have successful cleanup receipts, including their test clocks/subscriptions and dedicated Portal configurations. The six shared recurring prices and product were archived. All 15 known isolated probe deployments were removed and the final one-hour deployment share was revoked. Canonical production target, crons and SSO protection remained unchanged; project automation bypass count is zero. Provider financial records are retained as test-mode audit history.

The separately staged marketing website candidate was deliberately retained for production promotion. Its optional deployment-share inspection was rejected by automatic approval review, which cited the earlier CLI automation-bypass incident and requested a native deployment-specific alternative. That inspection was not retried through another route; revocation of the website share is not claimed here. The share was reported to expire after 23 hours.
