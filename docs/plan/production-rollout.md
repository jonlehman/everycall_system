# Production Rollout Checklist

## Pre‑Deploy
- Confirm staging checklist passed.
- Back up production database.
- Confirm all env vars in production:
  - `DATABASE_URL`
  - `OPENAI_API_KEY`
  - `TELNYX_API_KEY`
  - `TELNYX_PUBLIC_KEY`
  - `TELNYX_VOICE_CONNECTION_ID`
  - `CALL_SUMMARY_TOKEN`
  - `APP_BASE_URL`
  - `CALL_GATEWAY_URL`
  - `AI_ORCHESTRATOR_URL`
  - `VOICE_SERVICE_URL`
- Confirm shared SMS number in System Config.

## Deploy
- Deploy `main` to Vercel production.
- Deploy Render services.
- Verify `/healthz` on all services.

## Post‑Deploy
- Run smoke test against production URLs.
- Run regression checklist.
- Place a live test call into Telnyx number.
- Verify call summary SMS to opted‑in user.
- Monitor logs for 30 minutes.
