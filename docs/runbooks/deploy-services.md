# Deploying Call Gateway

This guide uses Render with the included `render.yaml`.

## Prereqs
- Render account
- Repo access to `everycall_system`
- API keys: OpenAI

## Steps
1. In Render, create a **New Blueprint**.
2. Point it at this repo and select `render.yaml`.
3. Set required env vars for the call gateway:
   - `TELNYX_PUBLIC_KEY`, `TELNYX_API_KEY`, `DATABASE_URL`, `APP_BASE_URL`, `CALL_SUMMARY_TOKEN`, `OPENAI_API_KEY`
4. Deploy the service.
5. Record the URL and set in Vercel env vars:
   - `CALL_GATEWAY_URL`

## Health Checks
- `GET /healthz` should return `{ ok: true }`.
