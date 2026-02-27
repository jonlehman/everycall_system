FROM node:20-slim AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/ai-orchestrator ./apps/ai-orchestrator

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @everycall/ai-orchestrator build

ENV NODE_ENV=production
ENV PORT=3102

CMD ["node", "apps/ai-orchestrator/dist/server.js"]
