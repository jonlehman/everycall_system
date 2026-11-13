# Unified paid intake: production cutover preflight

Authority: UPIB-014 and the [guarded release runbook](../RUNBOOK.md). This records preparation, not production execution or permission to skip provider acceptance.

## Source and existing production

Fresh remote metadata on November 13, 2026 UTC confirms system production `main` at `17195749a3cd70b421db34c2f4f244d9f153b0e3`, matching the canonical version endpoint recorded in the release evidence. The earlier local `main` at `2678787` was stale. The implementation branch at `64ba23730f0a037a1334f72f1247c28960b64e33` diverges by three work commits and one production commit. Production's additional commit supplies the Sales in-call keypad. The isolated `work/production-cutover-2026-11-13` integration merges that commit, preserving both the keypad and paid intake. Only the additive decision-document insertion required manual conflict resolution.

The isolated checkout is `/tmp/everycall-production-cutover`; the original checkout, unrelated CSV and lock remain untouched. No temporary provider credential probe belongs in this application release. Website source remains the separately reviewed `a2dfd7f0ed10557b4fab607e3be7a2aaaebe1bee`, based on production `05f212c461dd7c50bb45c6b0e2af093728943e9e`.

## Explicit existing-record inventory

A production repeatable-read, read-only transaction saved the private per-record map at `/tmp/upib-release-preflight/inventory.json`; SHA-256 `1fe0d43fd940394f24f03d1c66ac988860361803b9d36fc51b8e40c9bbd09eb7`. It contains all 80 tenant IDs, all 80 billing-account records, two subscription associations and three checkout records, with row fingerprints, frozen amounts, exact existing provider associations and explicit dispositions. It excludes contact identities, payment URLs and credentials. Preserve this evidence privately with the operator's release record before local temporary storage is removed.

| Records | Proposed disposition | Provider/database mutation |
| --- | --- | --- |
| 71 unpaid accounts | Preserve records; no production admission without a verified paid purchase | None |
| 3 unpaid trial accounts | Preserve history; old trial flags confer no admission after cutover | None |
| 3 deactivated accounts | Preserve records; no production admission | None |
| 1 verified live setup account | Reuse the original frozen $1 payment after owner verification and explicit recurring consent; retain publication/readiness gates | No second setup charge; owner flow still required |
| 2 existing recurring accounts | Preserve provider associations and history; reconcile canonical subscription/invoices/periods and choose an explicit service disposition | Unresolved: no cancellation, collection, fabricated consent or replacement subscription |

Each checkout is individually represented: the verified live $1 purchase retains its original amount and pending readiness; the unpaid live $100 checkout must be reconciled before replacement; the test $100 checkout remains isolated from production activation. A missing/expired response is not proof that a provider effect did not happen. Keep all delivery uncertainty and frozen recipients.

This map does **not** close the two recurring-account decision. The application refuses ordinary setup for a tenant with an existing subscription, and the enabled admission gate denies a legacy account lacking a verified `paid_purchase_id`. Therefore enabling the gate without an approved service disposition would disable those accounts while their provider subscriptions could continue billing. Do not infer consent or entitlement from legacy status, and do not synthesize a purchase or mass-cancel to remove this blocker. Owner Billing/help access must remain available.

## Migration pins and bounded execution

The fresh read-only snapshot found every required predecessor receipt through 0062, all eight baseline physical-contract hashes matched, and no 0063/0064-owned relation existed. At 06:42:07 UTC on November 13, production reported PostgreSQL `17.11 (11592b3)` and exposed `transaction_timeout`; the normal session value was `0`, and the runner must set its own local deadline. This is a snapshot; the runner must recheck under its own bounded locks.

| Pin | SHA-256 |
| --- | --- |
| Database target (credential-free normalized host/port/path) | `455767609f536fbe6e3f3cd80358cd9df1711aea9ea149dcfa6f24468fc9059f` |
| `0063_unified_paid_intake.sql` | `fb4c9a6dd7e17ccb57fe5a4152196c12aa88d9261b7bae5920968a22ef0a665d` |
| `0064_paid_billing_lifecycle.sql` | `0773a0ea221c81ca397e2fe2514336d959995403f01d64a983cf76d03aa2086e` |

Execute only the existing `scripts/apply-unified-paid-billing-migrations.mjs` with the exact independently reviewed **final integration commit**, the above SQL and target pins, `EVERYCALL_APPLY_UNIFIED_PAID_BILLING=1`, and real release/inventory evidence references. Source the already trusted production database credential without printing it. Never substitute a dynamic current HEAD for independently approved revision evidence. The runner requires a clean tracked checkout and PostgreSQL transaction deadlines; it atomically installs both migrations, preserves existing financial row payloads, commits both receipts and leaves the gate disabled. It uses a 250ms lock timeout, NOWAIT table fences, 5-second statement limits and a 10-second transaction limit. On contention, drift, collision or failure, investigate rather than widen bounds or use a broad migration runner.

## Gate activation prerequisites

The final reviewed activation artifact must pin the exact deployed system/gateway/worker/website revisions, inventory SHA/reference and canonical Stripe account/mode/configuration evidence. Require all of the following before changing `paid_intake_release`: real isolated Stripe acceptance; six verified new recurring prices and explicit EveryCall portal; canonical webhook event coverage with original query and signing rollover preserved; both schema receipts; explicit closed dispositions for every old record, including both subscriptions; zero unreconciled checkout/subscription effects; retired old invocation versions after their actual maximum duration; independent review of final clean source; and canonical runtime verification. Record the responsible operator and performed transition.

No executable activation SQL is supplied while those prerequisites remain unresolved. The additive migration can keep the gate closed throughout coordinated deployment. Rollback after any new transaction must preserve new payment association handling and uncertainty fences; it must never allow a second setup collection or lose accepted provider effects.

## Integration verification

The merged checkout passed Sales authentication/isolation, telephony, the compiled Sales gateway suite, the real CallerWorkspace controller browser fixture and the 12-key keypad browser fixture (keyboard focus, serial order, error/call-change teardown and responsive bounds). The contracts and Sales gateway TypeScript builds passed. Paid intake passed all 26 native scenarios; paid lifecycle, guarded migration and paid intake/Billing/booking browser suites passed against disposable local PostgreSQL and synthetic providers. Migration tests exercised real server transaction deadlines, exact fingerprints, contention, atomic rollback, protected-row preservation and disabled-gate behavior. These are integration/local regressions, not live Stripe acceptance or deployed-version proof.
