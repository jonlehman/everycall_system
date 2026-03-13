# EveryCall Monorepo Scaffold

This repo includes runnable service scaffolds for:
- `@everycall/call-gateway` (Telnyx inbound webhook + signature validation)

## Quick start
1. Install dependencies:
   - `nvm use`
   - `corepack enable`
   - `pnpm install`
2. Run services in separate terminals:
   - `pnpm dev:call-gateway`
3. Run smoke test:
   - `pnpm smoke`

## Runtime
- Node.js `24.14.0` or later
- pnpm `10+`

## Env
See `.env.example` for required variables.

## Current behavior
- Telnyx signature is validated when `TELNYX_PUBLIC_KEY` is set.
- AI uses OpenAI when `OPENAI_API_KEY` is set; otherwise deterministic fallback logic.
- Realtime voice uses OpenAI when `OPENAI_API_KEY` is set.

## Key docs
- Architecture: `docs/architecture/001-system-overview.md`
- API contracts: `docs/api/*`
- Event schemas: `docs/events/*`
- ADRs: `docs/adr/*`

## Deployment notes
- Admin web app (Next.js) is deployed on Vercel.
- Call gateway (Telnyx + Realtime) is deployed on Render.

## Prompt config UI
- UI: `/config-ui.html`
- API: `GET/POST /v1/config/agent`
- Storage: PostgreSQL (`agent_configs` table) when `DATABASE_URL` is set.
- Fallback: defaults are returned if `DATABASE_URL` is unset; writes require `DATABASE_URL`.
