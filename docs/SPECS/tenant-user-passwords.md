# System User Password Editing

Status: Implemented, 2026-11-09. Scope: Account Settings → System Users (`/client/account/users`), separate from platform users at `/admin/users`.

## Requirements

- **TENANT-PASSWORD-001:** Existing account owners/admins and platform managers can select a tenant user and explicitly set a new password. Preserve the user ID, email, role, status, tenant membership, alerts and transfer settings. Do not create or modify platform/Sales accounts through this action.
- **TENANT-PASSWORD-002:** Accept exact passwords of at least eight characters and at most 72 UTF-8 bytes; hash with the existing bcrypt cost 10. Never read back, log or include the password/hash in responses or audit details. The existing client login must accept the new password and reject the old one.
- **TENANT-PASSWORD-003:** Permit the setter only for active users, including active users without an initial password. Keep activation/invitation separate. Inactive rows explain the existing Enable Access or invitation prerequisite, with the existing active-user limit unchanged.
- **TENANT-PASSWORD-004:** Revalidate the live manager principal/session inside the mutation transaction. Reject expired/revoked sessions, Sales credentials, non-managers and targets outside the resolved tenant without changing credentials. Preserve independent platform principal IDs and credentials even when numeric IDs collide.
- **TENANT-PASSWORD-005:** Commit the password, affected tenant-session revocation, tenant credential-token revocation and secret-free audit together. Roll back all changes if auditing fails. Fence in-flight password-based login, reset issuance and reset redemption against intervening password changes. Preserve platform and other-tenant sessions/tokens. Historical unscoped tokens are removed only for unambiguous tenant identities; ambiguous tokens remain unusable by the existing reset endpoint.
- **TENANT-PASSWORD-006:** Provide separate password/confirmation fields, mismatch and length validation, pending-state protection, clear error/success feedback and draft preservation on failure. Clear secrets on success/cancel/selection changes. A successful self-reset clears the cookie and replaces management controls with a sign-in link.

## Implementation

`POST /api/v1/tenant/users` with `{ action: "password", id, password }` uses the existing billing and owner/admin gates, then `pages/api/_lib/tenantPasswords.js` locks/revalidates the actor and tenant-scoped target. Per-tenant serialization prevents reciprocal manager resets from taking user locks in opposite order; platform actors also use the established platform mutation lock. The endpoint rejects unrelated profile fields. GET supplies the password-management capability, without credentials, for hiding the new action from non-managers.

The client uses a separate Set Password form, so unsaved profile edits cannot silently change identity or membership. The transaction returns only `ok` and `reauthenticate`; self-reset comparison includes the principal namespace. No emails or SMS are sent. Existing onboarding sessions remain supported; password-based tenant login now supplies the verified credential snapshot. Scoped and legacy reset redemption recheck token validity after acquiring the affected user lock.

## Regression evidence

- `scripts/validate-tenant-user-password.mjs`: disposable migration-backed PGlite, real user/login/reset handlers, exact password preservation, first password, role/tenant/namespace isolation, expired/revoked managers, credential revocation, audit rollback, and stale request snapshots. Set `TENANT_PASSWORD_TEST_DATABASE_URL` to an isolated loopback PostgreSQL database for genuine overlapping transactions (manager mutation with old login, reset issuance, scoped/legacy reset redemption).
- `scripts/test-tenant-user-password-browser.mjs`: real Account Users page and data grid with synthetic fetch fixtures; selection, masked fields, confirmation/length validation, error preservation, pending-state protection, cancellation, exact payload, active-access prerequisite, success clearing, hidden non-manager action and self sign-in. Desktop/mobile screenshots use dummy passwords.
- Existing `scripts/validate-admin-user-edit.mjs` protects platform/Sales auth and legacy reset behavior when shared auth primitives change. No fixture sends provider messages or changes production credentials.
