# Client UI V2 Monitoring Window (7 Days)

## Status
- In progress
- Start date: 2026-03-03
- Owner: Dev A
- Automated daily run: `.github/workflows/client-ui-v2-monitoring.yml` (16:15 UTC + manual dispatch)

## Goal
Validate Client UI v2 stability and usability after production rollout.

## Scope
- `app/client/*` pages
- Client-facing APIs:
  - `/api/v1/overview`
  - `/api/v1/calls`
  - `/api/v1/knowledge`
  - `/api/v1/routing`
  - `/api/v1/settings`
  - `/api/v1/tenant/users`

## Daily Checks
1. Availability
- Confirm app is reachable.
- Confirm `/api/version` commit matches expected release.

2. Error monitoring
- Review 5xx rates for client UI pages and API endpoints.
- Flag any repeated endpoint-specific errors.

3. Workflow health
- Verify setup checklist page loads and links function.
- Verify overview/calls/knowledge/routing/settings/team load and save paths.

4. Auth/session
- Confirm session expiry and re-auth path still works.
- Confirm no cross-tenant access anomalies are reported.

## Targets
- Page/API 5xx error rate: < 1%
- Successful save path rate (faq/routing/settings/team actions): > 99%
- No P0/P1 incidents

## Escalation Triggers
- Any sustained 5xx spike above 1% for > 15 minutes.
- Any repeat data-loss/save-failure issue.
- Any role/permission bypass issue.

## Day 0 Baseline (2026-03-03)
- Client UI v2 API suite (`test:client-ui:v2:api`) passed on production.
- Client UI v2 E2E suite (`test:client-ui:v2:e2e`) passed on production.
- Production commit validated at `ce4aea2` and follow-up checklist commit `dcb4f5e`.

## Observation Log

### 2026-03-03 (Day 0 Pass)
- Production commit confirmed:
  - `38ccac05ed3eef833618480818da18f4bcd08e3a`
- Validation commands:
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:client-ui:v2:api`
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:client-ui:v2:e2e`
- Result:
  - API suite: pass
  - E2E suite: pass
- Incident check:
  - No P0/P1 issues observed during this pass.

### 2026-03-03 (Day 0 Follow-up Pass)
- Production commit confirmed:
  - `bb5e8854514c39b4066d93d02dce09256a610902`
- Validation commands:
  - `curl -sS https://app.everycall.io/api/version`
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:client-ui:v2:api`
  - `APP_BASE_URL=https://app.everycall.io corepack pnpm test:client-ui:v2:e2e`
- Result:
  - API suite: pass
  - E2E suite: pass
- Incident check:
  - No P0/P1 issues observed during this follow-up pass.

## Day 7 Exit Criteria
1. No unresolved P0/P1 issues.
2. Error targets met.
3. Regression checklist remains passing.
4. CU14 marked done in task board.
