FROM node:24.14.0-bookworm-slim AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/sales-call-gateway ./apps/sales-call-gateway

RUN pnpm install --frozen-lockfile
RUN pnpm -r build

ENV NODE_ENV=production
ENV PORT=3102

CMD ["node", "apps/sales-call-gateway/dist/apps/sales-call-gateway/src/server.js"]
