FROM node:20-slim AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/call-gateway ./apps/call-gateway

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @everycall/call-gateway build

ENV NODE_ENV=production
ENV PORT=3101

CMD ["node", "apps/call-gateway/dist/server.js"]
