# UPIB-014 schema-only production phase

This is a narrow, independently reviewed exception to the activation procedure's
step 1 ordering: the additive 0063/0064 migration transaction may precede the
owner's legacy-account disposition, after exact-source review and final provider
request/response evidence are accepted. It does not resolve or infer that decision.
The exception permits only the existing guarded migration runner. It does not
permit application, gateway, worker or website promotion, a main-branch push that
triggers deployment, provider/catalog/environment changes, legacy-account actions,
or enabling intake. Those coordinated rollout steps remain blocked.

## Required preflight and evidence

- Record the final clean, pushed 40-character review commit, independent approval,
  real provider acceptance and final source-request comparison references. Record
  the exact final commit in `EVERYCALL_REVIEWED_REVISION`; documentation/tooling
  commits after the financial source review must retain unchanged app/SQL hashes.
- Refresh the read-only production inventory and record its timestamp and private
  artifact hash. Preserve the historical 80-tenant inventory and its original
  reference, both recurring subscriptions and all three Sales Checkout histories,
  including the verified frozen $1 receipt. A fresh count or state change requires
  explanation; it is not permission to map, cancel or adopt an account.
- Use the existing private production environment without printing DATABASE_URL.
  Target fingerprint must be
  `455767609f536fbe6e3f3cd80358cd9df1711aea9ea149dcfa6f24468fc9059f`.
  Pin exact SQL SHA-256 values:
  `0063_unified_paid_intake.sql` =
  `fb4c9a6dd7e17ccb57fe5a4152196c12aa88d9261b7bae5920968a22ef0a665d`;
  `0064_paid_billing_lifecycle.sql` =
  `0773a0ea221c81ca397e2fe2514336d959995403f01d64a983cf76d03aa2086e`.
- Review the private migration wrapper's exact source/target/SQL/inventory pins,
  and provide concrete release and inventory evidence references. It invokes only
  `scripts/apply-unified-paid-billing-migrations.mjs`; no ad hoc migration or gate
  SQL is an alternative. The migration CLI has no dry-run mode: invoking it
  with its required execution flag applies the bounded transaction. Before
  authorization, use syntax/pin checks and read-only preflight only; the activation
  runner's rollback-only default is a different tool. Preserve the redacted runner
  output and its file hash.

## Execution boundary and verification

The existing runner verifies predecessor receipts and physical baseline contracts,
requires PostgreSQL transaction deadlines, takes bounded NOWAIT/advisory locks,
and runs both migrations and receipts in one transaction. Its existing-row
snapshots verify unchanged pre-existing fields on the altered billing tables;
installed-schema verification requires the pristine disabled intake gate. The
transaction deadline is ten seconds, statement deadline five seconds and lock
wait at most 250 milliseconds. Contention or any contract mismatch aborts rather
than waiting for a production maintenance window implicitly.

After the authorized run, independently read back both receipts, installed
physical contracts and exactly one gate row with `enabled=false` and null
activation revision/reference/time. Compare fresh protected local history and
legacy billing/service state with preflight evidence; distinguish unrelated
concurrent application activity rather than claiming a changed row was preserved.
Record unchanged canonical app, gateway, worker and website revisions and that no
Stripe, legacy-account or catalog changes occurred in this phase. Keep private
snapshots mode 0600 and report hashes/counts rather than customer data.

Any failure before commit rolls back schema and receipts together. If the commit
response is lost, reconcile the known target's receipts and physical contracts;
the same reviewed runner validates an already installed, pristine-disabled state
without reapplying migrations. Never issue manual DROP/DELETE or a down migration
to make a retry pass. After successful commit, leave the additive schema and gate
disabled; removal requires a separate reviewed recovery procedure. Stop on a
partial receipt, enabled/non-pristine gate, changed protected history or unknown
commit outcome until reconciled.

Report this phase as **schema installed, intake disabled, canonical rollout still
blocked on explicit legacy disposition and remaining coordinated gates**. This
procedure does not constitute full release completion or authorize the remaining
activation sequence.

## First production attempt and bounded transport correction

The authorized attempt from `97d344a03a640276800aaa2f019e072bb40bafb9`
stopped with PostgreSQL 17 error `25P04` (`transaction_timeout`). No retry followed.
Independent read-only reconciliation proved both receipts absent, all owned
relations and the admission function absent, all nine additive columns absent,
all eight baseline contracts unchanged and every predecessor present. All five
protected table counts/digests matched the fresh preflight exactly: 80 tenants,
90 billing accounts, 133 billing periods, three Sales Checkout rows and one config
row. The gate table was absent. No external relation locks remained. The private
reconciliation artifact SHA-256 is
`bc33ff7dec6b4cbeb81175b2b8afd8f1d685a29ddfc925a559624a5a89e4289e`.
This was a rolled-back attempt, not a completed schema installation.

The catalog verifier previously made five sequential transport requests for each
relation, including eight baseline and sixteen installed contracts. The bounded
correction batches those same ordered catalog projections into one parameterized
statement per relation, retaining the original normalization, exclusions and
stored fingerprints. It does not alter migration SQL, transaction/statement/lock
deadlines, locks, protected-row checks, gate checks or atomic receipts. Native
parity compares all baseline/installed/excluded contracts against the frozen old
reader; a transport-latency fixture exercises the same real transaction deadline.
Actual production latency profiling is read-only and requires independent query
review. A clean separately reviewed revision, fresh evidence/pins and explicit
coordinated retry approval remain prerequisites for another migration attempt.
