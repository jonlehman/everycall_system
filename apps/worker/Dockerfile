FROM node:24.14.0-bookworm-slim AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY pages/api/_lib ./pages/api/_lib
COPY lib ./lib

RUN pnpm install --frozen-lockfile
RUN pnpm -r build

ENV NODE_ENV=production

CMD ["node", "apps/worker/src/worker.js"]
