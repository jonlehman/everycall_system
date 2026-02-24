# EveryCall Monorepo Scaffold

This repo includes runnable service scaffolds for:
- `@everycall/call-gateway` (Twilio inbound webhook + signature validation)
- `@everycall/ai-orchestrator` (OpenAI decision engine + fallback)
- `@everycall/voice-service` (ElevenLabs TTS adapter + fallback)

## Quick start
1. Install dependencies:
   - `pnpm install`
2. Run services in separate terminals:
   - `pnpm dev:call-gateway`
   - `pnpm dev:ai-orchestrator`
   - `pnpm dev:voice-service`
3. Run smoke test:
   - `pnpm smoke`

## Env
See `.env.example` for required variables.

## Current behavior
- Twilio signature is validated when `TWILIO_AUTH_TOKEN` is set.
- AI uses OpenAI when `OPENAI_API_KEY` is set; otherwise deterministic fallback logic.
- Voice uses ElevenLabs when `ELEVENLABS_API_KEY` is set; otherwise deterministic fallback audio.

## Key docs
- Architecture: `docs/architecture/001-system-overview.md`
- API contracts: `docs/api/*`
- Event schemas: `docs/events/*`
- ADRs: `docs/adr/*`

## Prompt config UI
- UI: `/config-ui.html`
- API: `GET/POST /v1/config/agent`
- Note: current config storage is in-memory per runtime instance (suitable for initial testing only).
