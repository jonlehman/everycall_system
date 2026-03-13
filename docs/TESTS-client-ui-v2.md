# Client UI V2 Test Matrix

Use this for staging signoff and release validation for Client UI v2.

## Quick Run Commands
- API suite:
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:client-ui:v2:api`
- E2E suite:
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:client-ui:v2:e2e`
- Dry run (no network calls):
  - `CLIENT_UI_TEST_DRY_RUN=1 corepack pnpm test:client-ui:v2:api`
  - `CLIENT_UI_TEST_DRY_RUN=1 corepack pnpm test:client-ui:v2:e2e`

## 1. Core UX Contract Tests

### Screen Structure
Verify each of the six screens includes:
- Title/header region
- Status feedback area
- One dominant CTA
- Main content region
- Save/error feedback (where applicable)

### UI States
For each screen verify:
- Loading state is visible and non-blocking.
- Empty state is informative and actionable.
- Error state shows retry path.
- Permission-denied state appears for unauthorized actions.

## 2. Workflow Tests

### First Login Workflow (Owner)
1. Login as owner.
2. Land on Overview.
3. Complete setup checklist links (Settings -> Knowledge -> Routing).
4. Return to Overview and confirm completion indicators.

### Daily Operations Workflow (Staff/Manager)
1. Open Overview and select urgent/callback item.
2. Move to Calls Inbox and apply filters.
3. Open call detail and transcript.
4. Edit call status/urgency/summary and save internal notes inline.

### Configuration Workflow (Owner/Manager)
1. Edit and save Knowledge.
2. Edit and save routing.
3. Edit and save settings.
4. Manage team user status.

## 3. Role Permission Tests
Validate role matrix behavior:
- Staff cannot edit knowledge/routing/settings/team roles.
- Manager limitations enforced as specified.
- Owner has full tenant-level controls.
- Unauthorized writes return safe errors and no mutation.

## 4. API Contract Tests
For each endpoint:
- Success response shape is stable.
- Error response includes code and message.
- Tenant scoping enforced.
- Pagination/filter params behave as documented.

Endpoints:
- `/api/v1/overview`
- `/api/v1/calls`
- `/api/v1/dashboard/calls`
- `/api/v1/knowledge`
- `/api/v1/routing`
- `/api/v1/settings`
- `/api/v1/tenant/users`

## 5. Session and Security Tests
1. Expire session and verify redirect to login.
2. Re-login returns user to intended client screen.
3. Cross-tenant access attempts are denied.

## 6. Performance Checks (Manual/Observed)
- Overview render <= 2.0s target.
- Save actions <= 1.5s median target.
- No major layout shift on page load.

## 7. Release Signoff
- Core workflows pass for owner, manager, staff.
- No P0/P1 UX defects.
- Observability dashboards show expected events.
