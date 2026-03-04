# Local Development Runbook

## Prerequisites
- Node.js 20+
- pnpm 10+

## Setup
1. `pnpm install`
2. Copy `.env.example` values into your environment.

## Start services
- `pnpm dev:call-gateway` (port 3101)

## Health checks
- `GET http://localhost:3101/healthz`

## Smoke test
- `pnpm smoke`

## Live-provider checks
- OpenAI path activates when `OPENAI_API_KEY` is set.
- Telnyx signature verification requires `TELNYX_PUBLIC_KEY` and matching webhook URL/signature.

## Deployment note (Vercel)
- Vercel is suitable for HTTP endpoints (webhooks, portal APIs).
- Telnyx streaming requires a WebSocket endpoint; run that service on infrastructure that supports persistent WebSocket servers.
- Recommended split:
  - `api-gateway` / non-streaming webhooks on Vercel
  - `call-gateway` media stream runtime on a WebSocket-capable host
