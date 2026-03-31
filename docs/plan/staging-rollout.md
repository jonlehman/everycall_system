# Staging Rollout Plan

## Scope
Deploy full stack (web + services) to staging for integrated testing.

## Steps
1. Deploy latest `main` to Vercel staging.
2. Deploy Render services (call-gateway) to staging.
3. Set staging env vars:
   - `DATABASE_URL`
   - `OPENAI_API_KEY`
   - `TELNYX_API_KEY`
   - `TELNYX_PUBLIC_KEY`
   - `TELNYX_VOICE_CONNECTION_ID`
   - `INTERNAL_SERVICE_SECRET`
   - `INTEGRATION_SECRET_ENCRYPTION_KEY`
   - `APP_BASE_URL`
4. Set staging service URLs:
   - `CALL_GATEWAY_URL`
5. Run smoke test against staging URLs.
6. Run regression checklist.
7. Validate SMS opt‑in/out on staging.
8. Validate inbound voice webhook with Telnyx test call.

## Exit Criteria
- Smoke test passes.
- Regression checklist passes.
- No blocking errors in logs.
