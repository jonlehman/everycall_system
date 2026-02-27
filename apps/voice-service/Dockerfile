FROM node:20-slim AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/voice-service ./apps/voice-service

RUN pnpm install --frozen-lockfile
RUN pnpm -r build

ENV NODE_ENV=production
ENV PORT=3103

CMD ["node", "apps/voice-service/dist/apps/voice-service/src/server.js"]
