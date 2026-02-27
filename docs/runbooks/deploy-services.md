# Deploying Call Gateway, AI Orchestrator, and Voice Service

This guide uses Render with the included `render.yaml`.

## Prereqs
- Render account
- Repo access to `everycall_system`
- API keys: OpenAI, ElevenLabs

## Steps
1. In Render, create a **New Blueprint**.
2. Point it at this repo and select `render.yaml`.
3. Set required env vars for each service:
   - Call Gateway: `TELNYX_PUBLIC_KEY`, `DATABASE_URL`
   - AI Orchestrator: `OPENAI_API_KEY`, `OPENAI_MODEL`
   - Voice Service: `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`
4. Deploy all three services.
5. Record URLs and set in Vercel env vars:
   - `CALL_GATEWAY_URL`
   - `AI_ORCHESTRATOR_URL`
   - `VOICE_SERVICE_URL`

## Health Checks
- `GET /healthz` on each service should return `{ ok: true }`.
