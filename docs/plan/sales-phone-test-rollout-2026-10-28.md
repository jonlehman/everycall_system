# Sales phone test release evidence — 2026-10-28

## Scope and approval

The owner explicitly approved a narrow exception to `docs/RUNBOOK.md:82`: apply migration `0057` with existing services running, verify the schema, then promote the reviewed application. Phone testing must remain off until the separate Sales gateway can be deployed with verified ingress fencing and old-process retirement. This approval does not replace the general maintenance procedure or authorize an unfenced Sales deployment.

The owner separately confirmed the existing production Neon endpoint and database. Credentials remain in the Git-ignored `.env.production.local`; no credentials are recorded here.

Confirmed host/database fingerprint (SHA-256 of hostname plus URL pathname): `aa74f06b94a291f7f7a2cca70c33f107cee93b641f42b45baffa2cb2ec761d01`.

## Migration evidence

- Production receipts `0050`–`0056` were present; only `0057_sales_phone_test_mode.sql` was missing.
- Preflight found zero active Sales calls, pending incoming calls, pending checkout deliveries, reserving bookings, or running async jobs. These checks were snapshots, not an ingress fence.
- A transient, independently reviewed adapter used the existing fingerprint-guarded migration implementation. It verified transaction-local lock timeout of 5 seconds and statement timeout of 60 seconds before permitting migration statements. The schema and receipt remained in the same transaction.
- Only `0057_sales_phone_test_mode.sql` committed, at **2026-10-28 21:16:02 UTC**. Physical schema readiness and the committed receipt were verified.
- All **243** prospect phone records matched the pre-migration aggregate snapshot. Test mode remained **false**, with **zero** phone backups.

## Application promotion and verification

- Promoted reviewed commit `5748e8c57f8c93432090a45b0efd69d22081127f`, deployment `dpl_4AjuLZFqEcbQb3HK3YDetQbSe3bU`; the `app.everycall.io` alias was verified against that deployment.
- Admin and Sales login pages returned HTTP 200. Their session endpoints returned HTTP 200 with `authenticated: false`, without schema errors. Actual credential login and provider calls were not exercised.
- Independent primary-agent checks confirmed both session endpoints remained healthy and the new `/api/v1/admin/sales/phone-test-mode` endpoint returned HTTP 401 to an unauthenticated request.
- No error/fatal runtime log groups appeared in the short observation window after migration. This is not a long-running health certification.

## Remaining gate

The inbound gateway and worker were already running `5748e8c`. The separate, manually deployed Sales gateway remained on `e35b0cad100091fac298a04f81f85d4600e879a1` and was not changed by this release.

**Do not enable phone testing until the Sales gateway deployment is safely completed and its exact revision and single-instance state are verified.** No prospect phone substitution, provider calls, or messages were performed during this migration and promotion.

If application recovery is needed, retain migration `0057` and keep test mode off; do not improvise a down migration. Review compatibility before rolling back any release after test calls have been created.
